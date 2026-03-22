const { GoogleGenerativeAI } = require('@google/generative-ai');
const pool = require('../db/pool');
const { setState, clearState } = require('./conversationState');
const { saveAlert } = require('./riskClassifier');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const flash = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

// ── Question templates (fallback) ────────────────────────────────────────────

const TEMPLATES = {
  medication: [
    '¿Pudiste tomar tus medicamentos hoy como indica tu tratamiento?',
    '¿Cómo va el tema de los medicamentos hoy? ¿Los tomaste todos?',
    'Solo para asegurarme, ¿tomaste tus medicamentos hoy?',
    'Una pregunta rápida: ¿tus medicamentos de hoy, todo bien?',
    '¿Has podido seguir con tu medicación hoy?',
  ],
  appointment_pre: [
    '¿Recuerdas que mañana tienes una cita médica? ¿Está todo listo?',
    '¡Ojo que tienes cita mañana! ¿Necesitas que te recuerde algo antes de ir?',
    'Solo paso a avisarte que tienes una cita muy pronto. ¿Cómo estás?',
    'Mañana es tu cita. ¿Tienes todo preparado?',
    '¿Sabías que tienes cita pronto? ¿Hay algo en lo que te pueda ayudar antes?',
  ],
  appointment_post: [
    '¿Cómo te fue en tu cita de ayer? ¿Pudiste asistir?',
    'Pasé a preguntarte cómo estuvo tu cita. ¿Todo bien?',
    '¿Fuiste a tu cita? ¿Cómo resultó?',
    '¿Cómo te fue con los médicos? Me gustaría saber cómo estás.',
    'Ya que pasó tu cita, ¿cómo estás? ¿Qué te dijeron?',
  ],
  symptom: [
    '¿Cómo te has sentido físicamente estos últimos días? ¿Algún síntoma nuevo o molestia?',
    'Una pregunta rápida: ¿has notado algún cambio en cómo te sientes físicamente?',
    '¿Tienes algún síntoma o malestar que quieras contarme hoy?',
    'Me gustaría saber cómo está tu cuerpo. ¿Algo que me quieras contar?',
    '¿Cómo describes tu bienestar físico hoy? ¿Hay algo que te preocupe?',
  ],
};

// ── Determine which adherence check is due ───────────────────────────────────

async function getAdherenceCheckDue(patient) {
  const now = new Date();

  // 1. Medication: no record in last 24h
  const { rows: medRows } = await pool.query(
    `SELECT id FROM adherence_records
     WHERE patient_id = $1 AND record_type = 'medication'
       AND reported_at > NOW() - INTERVAL '24 hours'
     LIMIT 1`,
    [patient.id]
  );
  if (medRows.length === 0) {
    return { type: 'medication', appointmentId: null };
  }

  // 2. Appointment pre-check: appointment in next 24h with reminded = FALSE
  const { rows: preRows } = await pool.query(
    `SELECT id FROM appointments
     WHERE patient_id = $1
       AND scheduled_at BETWEEN NOW() AND NOW() + INTERVAL '24 hours'
       AND reminded = FALSE
     ORDER BY scheduled_at ASC
     LIMIT 1`,
    [patient.id]
  );
  if (preRows.length > 0) {
    return { type: 'appointment_pre', appointmentId: preRows[0].id };
  }

  // 3. Appointment post-check: appointment in last 48h, reminded = TRUE, no post record
  const { rows: postRows } = await pool.query(
    `SELECT a.id FROM appointments a
     WHERE a.patient_id = $1
       AND a.scheduled_at BETWEEN NOW() - INTERVAL '48 hours' AND NOW()
       AND a.reminded = TRUE
       AND NOT EXISTS (
         SELECT 1 FROM adherence_records ar
         WHERE ar.patient_id = $1
           AND ar.record_type = 'appointment_post'
           AND ar.appointment_id = a.id
       )
     ORDER BY a.scheduled_at DESC
     LIMIT 1`,
    [patient.id]
  );
  if (postRows.length > 0) {
    return { type: 'appointment_post', appointmentId: postRows[0].id };
  }

  // 4. Symptom: no symptom record in last 7 days
  const { rows: symptomRows } = await pool.query(
    `SELECT id FROM adherence_records
     WHERE patient_id = $1 AND record_type = 'symptom'
       AND reported_at > NOW() - INTERVAL '7 days'
     LIMIT 1`,
    [patient.id]
  );
  if (symptomRows.length === 0) {
    return { type: 'symptom', appointmentId: null };
  }

  return null;
}

// ── Build a varied question using Gemini (fallback to templates) ─────────────

async function buildVariedQuestion(type, recentQuestions = []) {
  const templates = TEMPLATES[type] || TEMPLATES.medication;
  const fallback = templates[Math.floor(Math.random() * templates.length)];

  if (recentQuestions.length === 0) return fallback;

  const prompt = `Genera UNA pregunta en español para preguntar a un paciente oncológico sobre: ${type === 'medication' ? 'si tomó sus medicamentos hoy' : type === 'appointment_pre' ? 'recordarle una cita próxima' : type === 'appointment_post' ? 'cómo le fue en su cita reciente' : 'síntomas físicos recientes'}.

Las preguntas recientes ya usadas (no repitas ni parafrasees estas):
${recentQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n')}

Escribe solo la pregunta, sin explicaciones. Tono cálido y cercano.`;

  try {
    const r = await flash.generateContent(prompt);
    const q = r.response.text().trim();
    return q || fallback;
  } catch {
    return fallback;
  }
}

// ── Start adherence check ────────────────────────────────────────────────────

async function startAdherenceCheck(patient, type, appointmentId) {
  // Get last 3 questions of this type to avoid repetition
  const { rows } = await pool.query(
    `SELECT data->>'question_text' AS q FROM adherence_records
     WHERE patient_id = $1 AND record_type = $2
     ORDER BY reported_at DESC LIMIT 3`,
    [patient.id, type]
  );
  const recentQuestions = rows.map(r => r.q).filter(Boolean);
  const question = await buildVariedQuestion(type, recentQuestions);

  await setState(patient.id, 'adherence_check', 1, { type, appointmentId, question });

  // Mark appointment as reminded for pre-check
  if (type === 'appointment_pre' && appointmentId) {
    await pool.query(
      `UPDATE appointments SET reminded = TRUE WHERE id = $1`,
      [appointmentId]
    );
  }

  return question;
}

// ── Advance adherence check ──────────────────────────────────────────────────

async function advanceAdherenceCheck(patient, message, state) {
  const { type, appointmentId, question } = state.context;

  // Evaluate response with Gemini
  const evalPrompt = `El paciente respondió a la pregunta de adherencia sobre "${type}". Respuesta: "${message}"

Clasifica el estado en: green (todo bien), yellow (duda o riesgo leve), red (problema claro o abandono)
Responde SOLO con: green, yellow o red`;

  let status = 'green';
  try {
    const r = await flash.generateContent(evalPrompt);
    const label = r.response.text().trim().toLowerCase();
    if (['green', 'yellow', 'red'].includes(label)) status = label;
  } catch { /* keep green */ }

  // Save adherence record
  await pool.query(
    `INSERT INTO adherence_records (patient_id, record_type, appointment_id, data, status)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      patient.id,
      type,
      appointmentId || null,
      JSON.stringify({ question_text: question, response: message }),
      status,
    ]
  );

  if (status === 'red') {
    await saveAlert(patient.id, 'moderate', `Problema de adherencia (${type}): ${message}`);
  }

  await clearState(patient.id);

  // Build closing message
  const closingPrompt = `Eres Eva. El paciente respondió sobre adherencia al tratamiento (tipo: ${type}) con: "${message}". Estado evaluado: ${status}.

${status === 'red' ? 'Hay un problema. Responde con empatía, valida lo que dice y sugiere suavemente contactar a su médico.' : status === 'yellow' ? 'Hay algo a vigilar. Responde con empatía y encorájale a continuar con su tratamiento.' : 'Todo parece bien. Responde brevemente con calidez.'}

Máximo 2 oraciones. Tono natural de WhatsApp.`;

  try {
    const r = await flash.generateContent(closingPrompt);
    return r.response.text().trim();
  } catch {
    return status === 'red'
      ? 'Gracias por contarme. Es importante que lo comentes con tu médico pronto. 💙'
      : '¡Gracias! Seguimos en contacto. 💙';
  }
}

module.exports = { getAdherenceCheckDue, startAdherenceCheck, advanceAdherenceCheck };
