const pool = require('../db/pool');

// Keywords that trigger immediate high-risk alert
const HIGH_RISK_KEYWORDS = [
  'maltrato', 'mala praxis', 'negligencia', 'me lastimaron',
  'quiero morirme', 'no quiero vivir', 'suicidio', 'hacerme daño',
  'me golpearon', 'abuso',
];

// Keywords that suggest moderate risk
const MODERATE_RISK_KEYWORDS = [
  'mucho dolor', 'no puedo más', 'abandonar tratamiento',
  'no quiero ir', 'me siento muy mal', 'no duermo', 'angustia',
  'desesperada', 'desesperado', 'no sirve de nada',
];

// Topics the bot must NEVER answer (redirect to doctor)
const FORBIDDEN_TOPICS = [
  'cambiar dosis', 'cambiar medicamento', 'suspender tratamiento',
  'dejar de tomar', 'cuánto tiempo me queda', 'pronóstico',
  'tiempo de vida', 'me voy a curar', 'tengo otro diagnóstico',
];

function classifyRisk(message) {
  const lower = message.toLowerCase();

  if (HIGH_RISK_KEYWORDS.some((kw) => lower.includes(kw))) return 'high';
  if (MODERATE_RISK_KEYWORDS.some((kw) => lower.includes(kw))) return 'moderate';
  return 'expected';
}

function isForbiddenTopic(message) {
  const lower = message.toLowerCase();
  return FORBIDDEN_TOPICS.some((topic) => lower.includes(topic));
}

async function saveAlert(patientId, level, description) {
  await pool.query(
    `INSERT INTO alerts (patient_id, level, description)
     VALUES ($1, $2, $3)`,
    [patientId, level, description]
  );

  // Update patient risk level
  await pool.query(
    `UPDATE patients SET risk_level = $1, updated_at = NOW() WHERE id = $2`,
    [level, patientId]
  );

  console.log(`🚨 Alert [${level}] saved for patient ${patientId}`);
}

module.exports = { classifyRisk, isForbiddenTopic, saveAlert };
