const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const flash = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

/**
 * Classify the intent/type of an incoming message.
 * If there is an active flow, 'flow_response' takes precedence.
 *
 * Returns: 'flow_response' | 'emotional_expression' | 'informative_question' | 'daily_conversation'
 */
async function classifyMessageType(message, currentState) {
  if (currentState && currentState.flow && currentState.flow !== 'idle') {
    return 'flow_response';
  }

  const prompt = `Clasifica el siguiente mensaje de un paciente oncológico en UNA de estas categorías:
- emotional_expression: expresa emociones, sentimientos, miedos, tristeza, angustia o bienestar emocional
- informative_question: pregunta sobre medicamentos, citas, tratamiento, síntomas físicos, dieta o información clínica
- daily_conversation: saludo, conversación casual, agradecimiento o mensaje sin carga emocional ni consulta médica

Responde ÚNICAMENTE con una de estas palabras: emotional_expression, informative_question, daily_conversation

Mensaje: "${message}"`;

  try {
    const result = await flash.generateContent(prompt);
    const label = result.response.text().trim().toLowerCase();
    const valid = ['emotional_expression', 'informative_question', 'daily_conversation'];
    return valid.includes(label) ? label : 'daily_conversation';
  } catch (err) {
    console.error('Message classifier error:', err.message);
    return 'daily_conversation';
  }
}

module.exports = { classifyMessageType };
