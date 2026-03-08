const { GoogleGenerativeAI } = require('@google/generative-ai');
const pool = require('../db/pool');
const { sendMessage } = require('./kapso');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * Ask Gemini Flash to summarize the patient's emotional state
 * based on recent alerts and the trigger message.
 */
async function generateReport(patient, recentAlerts, triggerMessage) {
  const alertsList = recentAlerts.length > 0
    ? recentAlerts.map(a => `- [${a.level}] ${a.description || '(sin descripción)'} (${new Date(a.created_at).toLocaleDateString('es-PE')})`).join('\n')
    : '- Sin alertas previas en los últimos 7 días';

  const prompt =
    'Eres un asistente clínico. Resume en 3 oraciones el estado emocional de un paciente oncológico ' +
    'basándote en las siguientes alertas recientes y el mensaje que disparó la alerta actual. ' +
    'Sé objetivo y clínico. No uses el nombre del paciente.\n\n' +
    `Alertas recientes (últimos 7 días):\n${alertsList}\n\n` +
    `Mensaje actual: "${triggerMessage}"`;

  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    const result = await model.generateContent(prompt);
    return result.response.text().trim();
  } catch (err) {
    console.error('❌ psychReport generateReport error:', err.message);
    return 'No se pudo generar un resumen automático del estado emocional.';
  }
}

/**
 * Build the WhatsApp message text to send to contacts.
 */
function buildReportMessage(patient, summary, level, triggerMessage) {
  const levelLabel = level === 'high' ? 'riesgo alto' : 'escalada emocional';
  return (
    `⚠️ Alerta Eva — ${patient.name || 'Paciente'}\n\n` +
    `Se detectó una señal de ${levelLabel}.\n\n` +
    `${summary}\n\n` +
    `Mensaje que activó la alerta:\n"${triggerMessage}"\n\n` +
    `Se recomienda contactar al paciente a la brevedad.`
  );
}

/**
 * Main entry point: generate and dispatch report to emergency contacts + oncologist.
 */
async function sendRiskReport(patient, level, triggerMessage) {
  try {
    // Fetch last 5 alerts from the last 7 days
    const { rows: recentAlerts } = await pool.query(
      `SELECT * FROM alerts
       WHERE patient_id = $1
         AND created_at >= NOW() - INTERVAL '7 days'
       ORDER BY created_at DESC
       LIMIT 5`,
      [patient.id]
    );

    const summary = await generateReport(patient, recentAlerts, triggerMessage);
    const message = buildReportMessage(patient, summary, level, triggerMessage);

    const recipients = [];

    // Add emergency contacts
    const contacts = Array.isArray(patient.emergency_contacts) ? patient.emergency_contacts : [];
    for (const contact of contacts) {
      if (contact.phone) recipients.push(contact.phone);
    }

    // Add oncologist phone if present
    if (patient.oncologist_phone) {
      recipients.push(patient.oncologist_phone);
    }

    if (recipients.length === 0) {
      console.log(`⚠️ psychReport: No recipients configured for patient ${patient.id}`);
      return;
    }

    for (const phone of recipients) {
      try {
        await sendMessage(phone, message);
      } catch (err) {
        console.error(`❌ psychReport: Failed to send to ${phone}:`, err.message);
      }
    }

    console.log(`📋 Risk report [${level}] sent to ${recipients.length} recipient(s) for patient ${patient.id}`);
  } catch (err) {
    console.error('❌ psychReport sendRiskReport error:', err.message);
  }
}

module.exports = { sendRiskReport };
