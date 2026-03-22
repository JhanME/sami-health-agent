const { GoogleGenerativeAI } = require('@google/generative-ai');
const pool = require('../db/pool');
const { getState, setState, clearState } = require('./conversationState');
const { saveAlert } = require('./riskClassifier');
const { sendMessage } = require('./kapso');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const flash = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

// ── Step 0: Inicio ──────────────────────────────────────────────────────────

function buildGreeting(patient) {
  const name = patient.name?.split(' ')[0] || '';
  return `Hola ${name} 👋 Quiero saber cómo estás hoy. Cuéntame, ¿cómo te has sentido?`;
}

// ── Step 1: Evaluación general ──────────────────────────────────────────────

const EVAL_PROMPT = 'Gracias por contarme. En una escala del 1 al 5, donde 1 es muy mal y 5 es excelente, ¿cómo calificarías tu día hoy?';
const EVAL_RETRY = 'Por favor responde con un número del 1 al 5.';

function parseScore(text) {
  const match = text.match(/[1-5]/);
  return match ? parseInt(match[0], 10) : null;
}

// ── Step 2: Síntomas ────────────────────────────────────────────────────────

const SYMPTOMS_PROMPT = '¿Has tenido algún síntoma hoy? (náuseas, dolor, fatiga, mareos u otro malestar)';

async function extractSymptoms(text) {
  const prompt = `El paciente oncológico reportó lo siguiente sobre síntomas: "${text}"

Si el paciente dice que no tiene síntomas o se siente bien, responde: []
Si reporta síntomas, extrae una lista JSON de strings con los síntomas mencionados.
Responde SOLO con el array JSON, sin explicaciones. Ejemplo: ["náuseas", "fatiga"]`;

  try {
    const r = await flash.generateContent(prompt);
    const raw = r.response.text().trim();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return text.toLowerCase().includes('no') ? [] : [text.trim()];
  }
}

// ── Step 3: Adherencia ──────────────────────────────────────────────────────

function buildAdherenceQuestion(patient) {
  const meds = patient.medications;
  if (Array.isArray(meds) && meds.length > 0) {
    const names = meds.map(m => m.name || m).join(', ');
    return `¿Pudiste tomar tu medicación hoy? (${names})`;
  }
  return '¿Pudiste tomar tu medicación hoy?';
}

async function classifyAdherence(text) {
  const prompt = `El paciente respondió sobre si tomó su medicación: "${text}"
Clasifica: taken (sí tomó), not_taken (no tomó), partial (tomó parcialmente).
Responde SOLO con: taken, not_taken o partial`;

  try {
    const r = await flash.generateContent(prompt);
    const label = r.response.text().trim().toLowerCase();
    if (['taken', 'not_taken', 'partial'].includes(label)) return label;
    return text.toLowerCase().match(/sí|si|yes|tomé|tome/) ? 'taken' : 'not_taken';
  } catch {
    return text.toLowerCase().match(/sí|si|yes|tomé|tome/) ? 'taken' : 'not_taken';
  }
}

// ── Step 4: Detección de alerta ─────────────────────────────────────────────

async function checkAlertPattern(patientId) {
  const { rows } = await pool.query(
    `SELECT general_score, symptoms, initiated_at::date AS day
     FROM daily_checkins
     WHERE patient_id = $1
       AND initiated_at > NOW() - INTERVAL '7 days'
       AND completed = TRUE
     ORDER BY initiated_at DESC
     LIMIT 5`,
    [patientId]
  );

  if (rows.length < 2) return { triggered: false, persistent: false };

  const last3 = rows.slice(0, 3);
  const lowScoreDays = last3.filter(r => r.general_score && r.general_score <= 2).length;
  const symptomDays = last3.filter(r => Array.isArray(r.symptoms) && r.symptoms.length > 0).length;

  const triggered = lowScoreDays >= 2 || symptomDays >= 2;
  const persistent = rows.length >= 3 && (
    rows.slice(0, 3).every(r => (r.general_score && r.general_score <= 2) || (Array.isArray(r.symptoms) && r.symptoms.length > 0))
  );

  return { triggered, persistent, lowScoreDays, symptomDays };
}

async function buildAlertMessage() {
  const prompt = `Eres Eva, acompañante oncológica por WhatsApp. El paciente ha reportado malestar en los últimos días.
Genera un mensaje breve (2 oraciones) reconociendo su malestar y diciéndole que estás monitoreando su estado. Tono cálido, cercano. Usa el emoji 💙`;

  try {
    const r = await flash.generateContent(prompt);
    return r.response.text().trim();
  } catch {
    return 'He notado que has reportado malestar en los últimos días. Estaré monitoreando tu estado 💙';
  }
}

// ── Step 5: Cierre ──────────────────────────────────────────────────────────

const CLOSING_MSG = 'Gracias por completar tu registro diario. Esto ayuda a mejorar tu seguimiento.\n\n¿Hay algo más que quieras contarme hoy? Estoy aquí para escucharte 💙';

function isBriefResponse(text) {
  const brief = /^(no|nada|gracias|todo bien|estoy bien|eso es todo|nop|nel|ta bien|ok|okay|está bien)[\s.!]*$/i;
  return brief.test(text.trim());
}

// ── Save checkin to DB ──────────────────────────────────────────────────────

async function saveDailyCheckin(patientId, ctx) {
  await pool.query(
    `INSERT INTO daily_checkins (patient_id, general_score, symptoms, medication_taken, raw_responses, alert_flag, completed, completed_at)
     VALUES ($1, $2, $3, $4, $5, $6, TRUE, NOW())`,
    [
      patientId,
      ctx.generalScore || null,
      JSON.stringify(ctx.symptoms || []),
      ctx.medicationTaken ?? null,
      JSON.stringify(ctx.rawResponses || {}),
      ctx.alertFlag || false,
    ]
  );
}

// ── Main flow: advance ──────────────────────────────────────────────────────

async function advanceDailyFollowup(patient, message, state) {
  const ctx = state.context;
  const step = state.step;

  // Step 0: patient responded to greeting → save and ask for score
  if (step === 0) {
    ctx.rawResponses = { inicio: message };
    await setState(patient.id, 'daily_followup', 1, ctx);
    return EVAL_PROMPT;
  }

  // Step 1: parse 1-5 score
  if (step === 1) {
    const score = parseScore(message);
    if (score === null) {
      if (ctx.evalRetried) {
        // Accept as-is, default to 3
        ctx.generalScore = 3;
        ctx.rawResponses.evaluacion = message;
        await setState(patient.id, 'daily_followup', 2, ctx);
        return SYMPTOMS_PROMPT;
      }
      ctx.evalRetried = true;
      await setState(patient.id, 'daily_followup', 1, ctx);
      return EVAL_RETRY;
    }
    ctx.generalScore = score;
    ctx.rawResponses.evaluacion = message;
    await setState(patient.id, 'daily_followup', 2, ctx);
    return SYMPTOMS_PROMPT;
  }

  // Step 2: symptoms
  if (step === 2) {
    const symptoms = await extractSymptoms(message);
    ctx.symptoms = symptoms;
    ctx.rawResponses.sintomas = message;
    await setState(patient.id, 'daily_followup', 3, ctx);
    return buildAdherenceQuestion(patient);
  }

  // Step 3: medication adherence
  if (step === 3) {
    const adherence = await classifyAdherence(message);
    ctx.medicationTaken = adherence === 'taken';
    ctx.rawResponses.adherencia = message;

    // Check alert pattern (step 4)
    const alert = await checkAlertPattern(patient.id);

    // Also factor in current session
    const currentLow = (ctx.generalScore && ctx.generalScore <= 2) || (ctx.symptoms && ctx.symptoms.length > 0);

    if (alert.triggered || (alert.triggered === false && currentLow && ctx.generalScore <= 2)) {
      ctx.alertFlag = true;

      if (alert.persistent) {
        await saveAlert(patient.id, 'moderate', `Malestar persistente en seguimiento diario: score=${ctx.generalScore}, síntomas=${(ctx.symptoms || []).join(', ')}`);
      }

      const alertMsg = await buildAlertMessage();
      await saveDailyCheckin(patient.id, ctx);
      await setState(patient.id, 'daily_followup', 5, ctx);
      return `${alertMsg}\n\n${CLOSING_MSG}`;
    }

    // No alert → skip to closing
    await saveDailyCheckin(patient.id, ctx);
    await setState(patient.id, 'daily_followup', 5, ctx);

    const adherenceAck = adherence === 'taken'
      ? 'Perfecto 👍 queda registrado.'
      : adherence === 'partial'
        ? 'Gracias por contarme. Recuerda que es importante seguir tu tratamiento lo más posible.'
        : 'Gracias por ser honesto/a. Si hay algún problema con tu medicación, es importante que lo comentes con tu médico.';

    return `${adherenceAck}\n\n${CLOSING_MSG}`;
  }

  // Step 5: closing response
  if (step === 5) {
    ctx.rawResponses.cierre = message;
    await clearState(patient.id);

    if (isBriefResponse(message)) {
      return 'Cuídate mucho. Aquí estaré mañana para saber cómo sigues 💙';
    }

    // Substantial response → return null so samiAgent re-routes
    // (e.g. emotional flow, risk gates already ran upstream)
    return null;
  }

  // Fallback: clear and return null to let normal pipeline handle
  await clearState(patient.id);
  return null;
}

// ── Cron trigger: initiate daily followups ───────────────────────────────────

async function triggerDailyFollowups() {
  const currentHour = new Date().getHours();

  const { rows: patients } = await pool.query(
    `SELECT * FROM patients
     WHERE activated_at IS NOT NULL
       AND (last_followup_at IS NULL OR last_followup_at < CURRENT_DATE)
       AND followup_hour = $1`,
    [currentHour]
  );

  let sent = 0;
  let skipped = 0;

  for (const patient of patients) {
    const state = await getState(patient.id);
    if (state.flow !== 'idle') {
      skipped++;
      continue;
    }

    const greeting = buildGreeting(patient);

    // Set state BEFORE sending to avoid race condition with incoming messages
    await setState(patient.id, 'daily_followup', 0, { rawResponses: {} });

    try {
      await sendMessage(patient.phone, greeting);
      // Save to message history
      await pool.query(
        `INSERT INTO messages (patient_id, role, content) VALUES ($1, 'assistant', $2)`,
        [patient.id, greeting]
      );
      await pool.query(
        `UPDATE patients SET last_followup_at = CURRENT_DATE WHERE id = $1`,
        [patient.id]
      );
      sent++;
    } catch (err) {
      console.error(`❌ Failed to send daily followup to ${patient.phone}:`, err.message);
      await clearState(patient.id);
    }

    // Delay between patients to avoid rate limits
    if (patients.indexOf(patient) < patients.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  if (sent > 0 || skipped > 0) {
    console.log(`📋 Daily followup: sent=${sent}, skipped=${skipped} (active flow), total=${patients.length}`);
  }
}

module.exports = { advanceDailyFollowup, triggerDailyFollowups };
