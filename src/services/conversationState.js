const pool = require('../db/pool');

const TTL = {
  emotional_support:   60,
  grounding_breathing: 60,
  grounding_54321:     60,
  adherence_check:     86400,
  evaluation:          172800,
  daily_followup:      14400,
};

/**
 * Get current conversation state for a patient.
 * Returns idle state if expired or not found.
 */
async function getState(patientId) {
  const { rows } = await pool.query(
    `SELECT flow, step, context, expires_at FROM conversation_states
     WHERE patient_id = $1`,
    [patientId]
  );
  if (!rows[0]) return { flow: 'idle', step: 0, context: {} };
  const row = rows[0];
  if (row.expires_at && new Date(row.expires_at) < new Date()) {
    await clearState(patientId);
    return { flow: 'idle', step: 0, context: {} };
  }
  return { flow: row.flow, step: row.step, context: row.context || {} };
}

/**
 * Set conversation state with automatic TTL.
 */
async function setState(patientId, flow, step, context = {}, ttlSeconds = null) {
  const ttl = ttlSeconds ?? TTL[flow] ?? 3600;
  const expiresAt = new Date(Date.now() + ttl * 1000);
  await pool.query(
    `INSERT INTO conversation_states (patient_id, flow, step, context, expires_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (patient_id) DO UPDATE
       SET flow = EXCLUDED.flow, step = EXCLUDED.step, context = EXCLUDED.context,
           expires_at = EXCLUDED.expires_at, updated_at = NOW()`,
    [patientId, flow, step, JSON.stringify(context), expiresAt]
  );
}

/**
 * Reset state to idle.
 */
async function clearState(patientId) {
  await pool.query(
    `INSERT INTO conversation_states (patient_id, flow, step, context, expires_at, updated_at)
     VALUES ($1, 'idle', 0, '{}', NULL, NOW())
     ON CONFLICT (patient_id) DO UPDATE
       SET flow = 'idle', step = 0, context = '{}', expires_at = NULL, updated_at = NOW()`,
    [patientId]
  );
}

/**
 * Read emergency line config from environment variables.
 */
function getEmergencyLines() {
  return {
    mentalHealth: process.env.EMERGENCY_LINE_MENTAL_HEALTH || '113 opción 5',
    clinic:       process.env.EMERGENCY_LINE_CLINIC || 'tu clínica',
    psychLink:    process.env.PSYCHOLOGY_WHATSAPP_LINK || null,
  };
}

module.exports = { getState, setState, clearState, getEmergencyLines };
