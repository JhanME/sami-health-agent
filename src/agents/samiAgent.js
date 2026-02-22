require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const pool = require('../db/pool');
const { retrieveContext } = require('../services/rag');
const { classifyRisk, isForbiddenTopic, saveAlert } = require('../services/riskClassifier');

const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const FORBIDDEN_REPLY =
  'Esa pregunta es muy importante y debe responderla tu médico directamente. ' +
  '¿Quieres que te recuerde tu próxima cita o te ayudo con algo más?';

const HIGH_RISK_REPLY =
  'Noto que estás pasando por un momento muy difícil. ' +
  'Quiero que sepas que no estás solo/a. ' +
  'Por favor comunícate ahora con tu red de apoyo o llama a la Línea de Salud Mental: *113 opción 5*. ' +
  'También voy a notificar a tu equipo de atención.';

/**
 * Get or create a patient by phone number
 */
async function getOrCreatePatient(phone) {
  const existing = await pool.query(
    'SELECT * FROM patients WHERE phone = $1',
    [phone]
  );
  if (existing.rows.length > 0) return existing.rows[0];

  // New patient — create with minimal data
  const created = await pool.query(
    `INSERT INTO patients (phone) VALUES ($1) RETURNING *`,
    [phone]
  );
  return created.rows[0];
}

/**
 * Get last N messages for conversation history
 */
async function getHistory(patientId, limit = 10) {
  const result = await pool.query(
    `SELECT role, content FROM messages
     WHERE patient_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [patientId, limit]
  );
  return result.rows.reverse(); // chronological order
}

/**
 * Save a message to history
 */
async function saveMessage(patientId, role, content) {
  await pool.query(
    `INSERT INTO messages (patient_id, role, content) VALUES ($1, $2, $3)`,
    [patientId, role, content]
  );
}

/**
 * Build the system prompt with RAG context
 */
function buildSystemPrompt(patient, ragChunks) {
  const context = ragChunks.length
    ? ragChunks.map((c) => `[${c.source}]: ${c.content}`).join('\n\n')
    : 'No hay información adicional disponible aún.';

  return `
Eres Sami, un asistente de acompañamiento post-atención médica especializado en pacientes oncológicos.
Tu tono es empático, cálido, claro y nunca alarmista.
Respondes en español. Tus respuestas son concisas (máximo 3 párrafos cortos).

DATOS DEL PACIENTE:
- Nombre: ${patient.name || 'Paciente'}
- Diagnóstico: ${patient.diagnosis || 'No registrado aún'}
- Tratamiento: ${patient.treatment_plan || 'No registrado aún'}
- Próxima cita: ${patient.next_appointment || 'Sin cita programada'}

INFORMACIÓN VERIFICADA (úsala como única fuente):
${context}

REGLAS CRÍTICAS — NUNCA LAS ROMPAS:
1. Responde SOLO con información del contexto verificado de arriba.
2. Si no tienes información suficiente, di: "No tengo esa información. Te recomiendo consultarlo directamente con tu médico."
3. NUNCA inventes dosis, diagnósticos, pronósticos ni datos médicos.
4. NUNCA contradigas el plan de tratamiento registrado.
5. Ante cualquier emergencia o crisis emocional, prioriza remitir a recursos de apoyo.
`.trim();
}

/**
 * Main entry point — called from the webhook
 */
async function handleIncomingMessage(phone, userMessage) {
  // 1. Get or create patient
  const patient = await getOrCreatePatient(phone);

  // 2. Check forbidden topics first (no LLM call needed)
  if (isForbiddenTopic(userMessage)) {
    await saveMessage(patient.id, 'user', userMessage);
    await saveMessage(patient.id, 'assistant', FORBIDDEN_REPLY);
    return FORBIDDEN_REPLY;
  }

  // 3. Classify risk before calling Claude
  const riskLevel = classifyRisk(userMessage);

  if (riskLevel === 'high') {
    await saveMessage(patient.id, 'user', userMessage);
    await saveMessage(patient.id, 'assistant', HIGH_RISK_REPLY);
    await saveAlert(patient.id, 'high', userMessage);
    return HIGH_RISK_REPLY;
  }

  if (riskLevel === 'moderate') {
    await saveAlert(patient.id, 'moderate', userMessage);
  }

  // 4. Retrieve RAG context
  const ragChunks = await retrieveContext(userMessage, patient.id);

  // 5. Build conversation history
  const history = await getHistory(patient.id);

  // 6. Call Claude
  const response = await claude.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 500,
    temperature: 0.2,
    system: buildSystemPrompt(patient, ragChunks),
    messages: [
      ...history,
      { role: 'user', content: userMessage },
    ],
  });

  const reply = response.content[0].text;

  // 7. Save both messages
  await saveMessage(patient.id, 'user', userMessage);
  await saveMessage(patient.id, 'assistant', reply);

  return reply;
}

module.exports = { handleIncomingMessage };
