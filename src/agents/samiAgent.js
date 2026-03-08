require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const pool = require('../db/pool');
const { retrieveContext } = require('../services/rag');
const { classifyRisk, isForbiddenTopic, saveAlert } = require('../services/riskClassifier');
const { sendRiskReport } = require('../services/psychReport');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const FORBIDDEN_REPLY =
  'Esa pregunta es muy importante y debe responderla tu médico directamente. ' +
  '¿Quieres que te recuerde tu próxima cita o te ayudo con algo más?';

const HIGH_RISK_REPLY =
  'Noto que estás pasando por un momento muy difícil. ' +
  'Quiero que sepas que no estás solo/a. ' +
  'Por favor comunícate ahora con tu red de apoyo o llama a la Línea de Salud Mental: *113 opción 5*. ' +
  'También voy a notificar a tu equipo de atención.';

const INACTIVE_REPLY =
  'Este servicio está disponible solo para pacientes activos. ' +
  'Comunícate con tu clínica para más información.';

/**
 * Normalize phone to E.164 format (+XXXXXXXXXXX)
 */
function normalizePhone(phone) {
  const digits = phone.replace(/\D/g, '');
  return digits.startsWith('+') ? phone : `+${digits}`;
}

/**
 * Find a patient by phone — returns null if not registered
 */
async function getPatient(rawPhone) {
  const phone = normalizePhone(rawPhone);
  console.log(`🔍 Looking up patient: ${phone} (raw: ${rawPhone})`);
  const { rows } = await pool.query(
    'SELECT * FROM patients WHERE phone = $1',
    [phone]
  );
  return rows[0] || null;
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
Eres Eva. Acompañas a pacientes oncológicos por WhatsApp durante su tratamiento.
No eres un bot ni un manual médico — eres una persona cercana, cálida, que escucha y responde como lo haría una amiga con conocimiento clínico.

CÓMO HABLAS:
- Escribe como si mandaras un WhatsApp, no como si redactaras un informe.
- Oraciones cortas. Lenguaje simple. Nada de tecnicismos innecesarios.
- Antes de responder, reconoce lo que el paciente siente con una frase breve y genuina. Ejemplos: "Eso suena agotador.", "Entiendo que da miedo.", "Qué bueno que me lo cuentas."
- Usa conectores naturales para arrancar: "Mira,", "Te cuento,", "Sí,", "Claro,", "Lo que pasa es que..."
- A veces termina con una pregunta corta para mantener el hilo: "¿Cómo te has sentido hoy?", "¿Pudiste descansar?"
- Varía la estructura. No todas las respuestas tienen que verses igual.
- Máximo 3 párrafos cortos. Cada párrafo = una idea.
- Usa emojis con moderación: máximo 2 por respuesta, solo cuando refuercen el mensaje. Útiles: 💙 (apoyo), 🌿 (bienestar), ✅ (confirmación), ⚠️ (alerta leve). Nunca uses emojis en respuestas sobre temas graves o de riesgo.

PROHIBIDO:
- Empezar con "Hola", saludos o el nombre del paciente al inicio.
- Sonar como un FAQ, un prospecto médico o una lista de puntos.
- Usar el nombre del paciente más de una vez por respuesta.

PACIENTE:
- Nombre: ${patient.name || 'Paciente'}
- Diagnóstico: ${patient.diagnosis || 'No registrado aún'}
- Tratamiento: ${patient.treatment_plan || 'No registrado aún'}
- Próxima cita: ${patient.next_appointment || 'Sin cita programada'}

INFORMACIÓN VERIFICADA (úsala como única fuente):
${context}

REGLAS CLÍNICAS — NUNCA LAS ROMPAS:
1. Responde SOLO con información del contexto verificado de arriba.
2. Si no tienes información suficiente, di: "Eso mejor consúltalo directamente con tu médico, él tiene el cuadro completo."
3. NUNCA inventes dosis, diagnósticos, pronósticos ni datos médicos.
4. NUNCA contradigas el plan de tratamiento registrado.
5. Ante cualquier emergencia o crisis emocional, prioriza remitir a recursos de apoyo.
`.trim();
}

/**
 * Main entry point — called from the webhook
 */
async function handleIncomingMessage(phone, userMessage) {
  // 1. Find patient — reject if not registered or not activated
  const patient = await getPatient(phone);
  if (!patient) {
    console.log(`⛔ Unregistered number: ${phone}`);
    return INACTIVE_REPLY;
  }
  if (!patient.activated_at) {
    console.log(`👋 First contact — activating patient: ${phone}`);
    const welcome =
      `Hola ${patient.name || ''}👋, soy Eva, tu asistente de acompañamiento oncológico. ` +
      `Estoy aquí para apoyarte durante tu tratamiento. ` +
      `Puedes preguntarme sobre tus medicamentos, citas, cuidados en casa o simplemente contarme cómo te sientes. ` +
      `¿En qué puedo ayudarte hoy?`;
    await pool.query(
      'UPDATE patients SET activated_at = NOW() WHERE id = $1',
      [patient.id]
    );
    await saveMessage(patient.id, 'user', userMessage);
    await saveMessage(patient.id, 'assistant', welcome);
    return welcome;
  }

  // 2-5. Run all independent pre-filters and data fetches in parallel
  const [isForbidden, riskLevel, ragChunks, history] = await Promise.all([
    isForbiddenTopic(userMessage),
    classifyRisk(userMessage),
    retrieveContext(userMessage, patient.id),
    getHistory(patient.id),
  ]);

  if (isForbidden) {
    await saveMessage(patient.id, 'user', userMessage);
    await saveMessage(patient.id, 'assistant', FORBIDDEN_REPLY);
    return FORBIDDEN_REPLY;
  }

  if (riskLevel === 'high') {
    await saveMessage(patient.id, 'user', userMessage);
    await saveMessage(patient.id, 'assistant', HIGH_RISK_REPLY);
    await saveAlert(patient.id, 'high', userMessage);
    await sendRiskReport(patient, 'high', userMessage);
    return HIGH_RISK_REPLY;
  }

  if (riskLevel === 'moderate') {
    const wasEscalation = patient.risk_level === 'expected';
    await saveAlert(patient.id, 'moderate', userMessage);
    if (wasEscalation) {
      await sendRiskReport(patient, 'moderate', userMessage);
    }
  }

  // 6. Call Gemini
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash',
    systemInstruction: buildSystemPrompt(patient, ragChunks),
    generationConfig: { temperature: 0.2, maxOutputTokens: 8192 },
  });

  // Gemini requires history to start with 'user' — drop any leading assistant messages
  const firstUserIdx = history.findIndex((m) => m.role === 'user');
  const validHistory = firstUserIdx > 0 ? history.slice(firstUserIdx) : history;

  const chat = model.startChat({
    history: validHistory.map((msg) => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }],
    })),
  });

  const result = await chat.sendMessage(userMessage);
  console.log('Gemini raw response:', JSON.stringify(result.response.candidates?.[0], null, 2));
  const reply = result.response.text();

  // 7. Save both messages
  await saveMessage(patient.id, 'user', userMessage);
  await saveMessage(patient.id, 'assistant', reply);

  return reply;
}

module.exports = { handleIncomingMessage };
