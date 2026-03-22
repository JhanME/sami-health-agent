const { GoogleGenerativeAI } = require('@google/generative-ai');
const pool = require('../db/pool');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const flash = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

/**
 * Classify risk level using Gemini Flash
 * Returns 'high' | 'moderate' | 'expected'
 */
async function classifyRisk(message) {
  const prompt = `Eres un clasificador de riesgo clínico para una IA de acompañamiento oncológico.
Clasifica el siguiente mensaje del paciente en una de estas categorías:
- HIGH: indica intención de autolesión, suicidio, abuso, maltrato, mala praxis o emergencia inmediata
- MODERATE: indica dolor intenso, angustia emocional severa, intención de abandonar el tratamiento, insomnio grave
- EXPECTED: mensaje normal o consulta habitual sin señales de riesgo

Responde ÚNICAMENTE con una de estas palabras: HIGH, MODERATE, EXPECTED

Mensaje: "${message}"`;

  try {
    const result = await flash.generateContent(prompt);
    const label = result.response.text().trim().toUpperCase();
    if (label === 'HIGH') return 'high';
    if (label === 'MODERATE') return 'moderate';
    return 'expected';
  } catch (err) {
    console.error('Risk classifier error:', err.message);
    return 'expected'; // safe fallback
  }
}

/**
 * Detect if message asks about topics that must be answered by the doctor
 */
async function isForbiddenTopic(message) {
  const prompt = `Eres un filtro de seguridad para una IA de acompañamiento oncológico.
Responde SI solo si el mensaje pide explícitamente una de estas acciones:
- CAMBIAR, AUMENTAR, REDUCIR o SUSPENDER una dosis o medicamento
- DEJAR o ABANDONAR el tratamiento actual
- Saber el PRONÓSTICO, tiempo de vida o probabilidad de curación
- Obtener un NUEVO DIAGNÓSTICO médico

Responde NO en cualquier otro caso, incluyendo:
- Preguntar QUÉ medicamentos tiene registrados
- Preguntar CUÁNDO es su próxima cita
- Preguntar sobre efectos secundarios conocidos
- Preguntar sobre cuidados en casa o alimentación
- Cualquier consulta emocional o de apoyo

Responde ÚNICAMENTE con: SI o NO

Mensaje: "${message}"`;

  try {
    const result = await flash.generateContent(prompt);
    return result.response.text().trim().toUpperCase() === 'SI';
  } catch (err) {
    console.error('Forbidden topic filter error:', err.message);
    return false; // safe fallback — let the main model handle it
  }
}

async function saveAlert(patientId, level, description) {
  await pool.query(
    `INSERT INTO alerts (patient_id, level, description)
     VALUES ($1, $2, $3)`,
    [patientId, level, description]
  );

  await pool.query(
    `UPDATE patients SET risk_level = $1, updated_at = NOW() WHERE id = $2`,
    [level, patientId]
  );

  console.log(`🚨 Alert [${level}] saved for patient ${patientId}`);
}

module.exports = { classifyRisk, isForbiddenTopic, saveAlert };
