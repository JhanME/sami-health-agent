const { GoogleGenerativeAI } = require('@google/generative-ai');
const { setState, clearState, getEmergencyLines } = require('./conversationState');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const flash = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

// ── Protocolo terapéutico (7 fases) ──────────────────────────────────────────
//
//  start  → step 1 : Reconocer la emoción            (Gemini)
//  step 1 → step 2 : Validar sin juzgar + preguntar  (Gemini)
//  step 2 → step 3 : Explorar impacto específico      (Gemini)
//  step 3 → step 4 : Identificar necesidad del usuario(Gemini — pregunta qué necesita)
//  step 4 → step 5 : Ofrecer opciones según necesidad (Gemini + opciones a/b/c/d)
//  step 5 → grounding o step 6
//  step 6 → step 7 : Check-in post-herramienta        (Gemini)
//  step 7 → cierre : Cierre suave + refuerzo autonomía(Gemini)

const BASE_RULES = `REGLAS DE ESCRITURA (obligatorias):
- NUNCA empieces con "Hola", saludos ni el nombre del paciente
- NUNCA repitas el nombre más de una vez por respuesta
- Escribe como WhatsApp: oraciones cortas, lenguaje natural
- Máximo 3 oraciones por turno
- Tono cálido, cercano, sin tecnicismos ni formalismos

PROHIBIDO (muy importante):
- NO uses frases genéricas como "es válido", "entiendo", "estoy aquí contigo" de forma repetitiva
- NO repitas la misma estructura de respuesta en turnos consecutivos
- NO seas solo validante sin aportar algo concreto: si el paciente dice que algo no le ayuda, cambia de enfoque
- Cada turno debe agregar algo NUEVO: una perspectiva, una pregunta diferente, una propuesta concreta
- Si el paciente expresa frustración con la conversación, reconócelo honestamente y ofrece algo diferente`;

// ── Grounding: Respiración (5 pasos fijos) ───────────────────────────────────

const BREATHING_STEPS = [
  '💙 Vamos a hacer un ejercicio de respiración. Es muy sencillo, solo sigue mis indicaciones.\n\nCuando estés listo/a, escríbeme algo y empezamos.',
  'Inhala lentamente contando hasta 4...\n\n1... 2... 3... 4...\n\nMantén el aire.',
  'Mantén el aire 4 segundos más...\n\n1... 2... 3... 4...\n\nCasi terminamos.',
  'Exhala suave contando hasta 6...\n\n1... 2... 3... 4... 5... 6...\n\nMuy bien. 🌿',
  '¿Cómo te sientes ahora? Puedes contarme con total confianza.',
];

// ── Grounding: 5-4-3-2-1 (6 pasos fijos) ─────────────────────────────────────

const GROUNDING_STEPS = [
  '💙 Vamos con el ejercicio 5-4-3-2-1. Te ayuda a conectarte con el presente y calmar la mente.\n\nCuando estés listo/a, dime algo para empezar.',
  'Mira a tu alrededor y menciona 5 cosas que puedes VER ahora mismo.\n\n(Lo que tengas cerca, no tiene que ser especial.)',
  'Muy bien. Ahora 4 cosas que puedes ESCUCHAR en este momento.\n\n(Sonidos del ambiente, tu respiración, lo que sea.)',
  'Bien. Ahora 3 cosas que puedes TOCAR o sentir físicamente.\n\n(La silla, tu ropa, el celular...)',
  'Casi. 2 cosas que puedes OLER ahora mismo.\n\n(Si no hueles nada, piensa en tu olor favorito.)',
  '1 cosa que puedes SABOREAR o el sabor que tienes en la boca.\n\nPerfecto, lo hiciste muy bien. 🌿 ¿Cómo te sientes?',
];

// ── Funciones Gemini por paso ─────────────────────────────────────────────────

// Paso 1 — Reconocer la emoción + invitar a seguir
async function generateStep1Recognition(patient, message) {
  const prompt = `Eres Eva, acompañante oncológica. ${patient.name || 'El paciente'} escribió: "${message}"

${BASE_RULES}
- Reconoce la emoción con calidez genuina en 1-2 oraciones. Sé específica con lo que dijo, no genérica.
- OBLIGATORIO: termina con una frase corta que invite a seguir hablando. Ejemplos: "Cuéntame más.", "¿Qué está pasando?", "Te escucho."
- La respuesta SIEMPRE debe terminar invitando al paciente a escribir más`;
  try {
    const r = await flash.generateContent(prompt);
    return r.response.text().trim();
  } catch {
    return 'Eso que sientes importa mucho. Cuéntame más, te escucho.';
  }
}

// Paso 2 — Validar sin juzgar + primera pregunta abierta
async function generateStep2Validation(patient, context) {
  const prompt = `Eres Eva. El paciente ${patient.name || ''} expresó: "${context.originalMessage}"

${BASE_RULES}
- Valida su emoción sin juzgar en 1-2 oraciones
- OBLIGATORIO: termina con UNA pregunta abierta que invite a seguir hablando
- La pregunta debe ser específica a lo que dijo, no genérica
- Ejemplos: "¿Qué es lo que más te pesa de todo esto?", "¿Desde cuándo te sientes así?", "¿Hay algo en particular que lo esté provocando?"
- La respuesta SIEMPRE debe terminar en signo de interrogación (?)
- NO ofrezcas soluciones todavía`;
  try {
    const r = await flash.generateContent(prompt);
    const text = r.response.text().trim();
    // Ensure response ends with a question
    if (!text.endsWith('?')) {
      return text + '\n\n¿Quieres contarme un poco más sobre lo que estás sintiendo?';
    }
    return text;
  } catch {
    return 'Lo que sientes es completamente válido. ¿Qué es lo que más te pesa de todo esto?';
  }
}

// Paso 3 — Explorar el impacto específico
async function generateStep3Exploration(patient, context, lastMessage) {
  const prompt = `Eres Eva. Contexto de la conversación:
- Emoción inicial: "${context.originalMessage}"
- Paciente explicó: "${lastMessage}"

${BASE_RULES}
- Responde a lo ESPECÍFICO que dijo, no con una frase genérica. Máximo 2 oraciones antes de la pregunta.
- Si mencionó algo concreto (tratamiento, dolor, una persona), engánchate de eso
- OBLIGATORIO: termina con UNA pregunta específica que demuestre que escuchaste: "¿Y después de la quimio qué haces?", "¿Alguien te acompaña en esos momentos?", "¿Qué es lo que más te agota de todo esto?"
- NO repitas "entiendo" ni "es válido" — usa reacciones específicas: "Uff, eso suena pesado", "Claro, con esa carga cualquiera se sentiría así"
- La respuesta SIEMPRE debe terminar en signo de interrogación (?)`;
  try {
    const r = await flash.generateContent(prompt);
    return r.response.text().trim();
  } catch {
    return '¿Cuánto tiempo llevas sintiéndote así? Me ayuda entenderte mejor.';
  }
}

// Paso 4 — Identificar qué necesita el paciente
async function generateStep4NeedIdentification(patient, context, lastMessage) {
  const prompt = `Eres Eva. El paciente lleva un rato compartiendo cómo se siente:
- Emoción inicial: "${context.originalMessage}"
- Contexto: "${context.whyMessage || ''}"
- Último mensaje: "${lastMessage}"

${BASE_RULES}
- Responde con algo CONCRETO sobre lo que compartió (no genérico), máximo 2 oraciones
- OBLIGATORIO: termina con una pregunta que le pregunte qué le ayudaría AHORA MISMO
- Ejemplos naturales:
  "¿Quieres seguir contándome o prefieres que hagamos algo juntos para bajar un poco la tensión?"
  "¿Necesitas sacarlo todo o te gustaría probar algo para sentirte un poco mejor ahora?"
- NO suenes como un formulario. Adapta la pregunta a lo que el paciente ha dicho
- La respuesta SIEMPRE debe terminar en signo de interrogación (?)`;
  try {
    const r = await flash.generateContent(prompt);
    return r.response.text().trim();
  } catch {
    return '¿Qué te ayudaría más ahora: seguir hablando o probar algo para sentirte un poco mejor?';
  }
}

// Paso 5 — Ofrecer opciones según la necesidad identificada
async function generateStep5Options(patient, context, needMessage) {
  const prompt = `Eres Eva. El paciente respondió sobre lo que necesita: "${needMessage}"

${BASE_RULES}
- Reconoce su respuesta en 1 oración
- Presenta estas opciones de forma natural, SIN asteriscos ni negritas, solo texto plano:

a) Seguir hablando contigo
b) Ejercicio de respiración
c) Ejercicio 5-4-3-2-1
d) Líneas de emergencia

- Termina con algo como "¿Cuál te llama más?" o "¿Qué prefieres?"
- Las opciones deben ir en líneas separadas con la letra y un paréntesis`;
  try {
    const r = await flash.generateContent(prompt);
    return r.response.text().trim();
  } catch {
    return `¿Qué te gustaría hacer ahora?\n\na) Seguir hablando\nb) Ejercicio de respiración\nc) Ejercicio 5-4-3-2-1\nd) Líneas de emergencia`;
  }
}

// Paso 6 — Check-in después de herramienta o conversación
async function generateStep6CheckIn(patient, context) {
  const prompt = `Eres Eva. ${patient.name || 'El paciente'} acaba de pasar por un momento de apoyo emocional.

${BASE_RULES}
- Pregunta con calidez cómo se siente ahora
- 1-2 oraciones, sin presionar`;
  try {
    const r = await flash.generateContent(prompt);
    return r.response.text().trim();
  } catch {
    return '¿Cómo te sientes ahora? 💙';
  }
}

// Paso 7 — Cierre suave o continuar si el paciente sigue compartiendo
async function generateStep7Closing(patient, lastMessage) {
  const lines = getEmergencyLines();
  const prompt = `Eres Eva. Después de un momento de apoyo emocional, el paciente dice: "${lastMessage}"

${BASE_RULES}

PRIORIDAD — lee bien el mensaje antes de decidir qué hacer:

1. Si el paciente está compartiendo algo nuevo (una historia, una persona, un sentimiento, algo de su día):
   → NO cierres la conversación. Responde con curiosidad genuina y haz UNA pregunta sobre lo que está contando. Sigue el hilo de lo que comparte.

2. Si el paciente se despide, dice que está bien o da señales claras de querer terminar:
   → Cierre cálido de 2 oraciones. Recuérdale que puede escribirte cuando quiera.

3. Si sigue con distress alto o menciona que está muy mal:
   → Cierre empático + ofrece recursos (texto plano, sin asteriscos):
     Línea salud mental: ${lines.mentalHealth}
     Clínica: ${lines.clinic}
     ${lines.psychLink ? `Psicología (WhatsApp): ${lines.psychLink}` : ''}

Tono natural, cercano, en español.`;
  try {
    const r = await flash.generateContent(prompt);
    return r.response.text().trim();
  } catch {
    const l = getEmergencyLines();
    return `Gracias por compartir esto conmigo. Recuerda que puedes escribirme cuando lo necesites. 💙\n\nSi necesitas hablar con alguien ahora: Línea de Salud Mental ${l.mentalHealth}.`;
  }
}

// ── Parseo de opción ──────────────────────────────────────────────────────────

function parseOption(message) {
  const text = message.trim().toLowerCase();
  if (/^a\b|seguir|hablar|conversar|desahogar/.test(text)) return 'a';
  if (/^b\b|respiraci[oó]n|respira/.test(text)) return 'b';
  if (/^c\b|5.?4.?3.?2.?1|grounding|tierra|enraiz/.test(text)) return 'c';
  if (/^d\b|emergencia|l[ií]nea|ayuda urgente/.test(text)) return 'd';
  return null;
}

// ── API pública ───────────────────────────────────────────────────────────────

async function startEmotionalFlow(patient, message) {
  const opening = await generateStep1Recognition(patient, message);
  await setState(patient.id, 'emotional_support', 1, { originalMessage: message });
  return opening;
}

async function advanceEmotionalFlow(patient, message, state) {
  const { step, context } = state;

  if (step === 1) {
    const reply = await generateStep2Validation(patient, context);
    await setState(patient.id, 'emotional_support', 2, context);
    return reply;
  }

  if (step === 2) {
    const reply = await generateStep3Exploration(patient, context, message);
    await setState(patient.id, 'emotional_support', 3, { ...context, whyMessage: message });
    return reply;
  }

  if (step === 3) {
    const reply = await generateStep4NeedIdentification(patient, context, message);
    await setState(patient.id, 'emotional_support', 4, { ...context, impactMessage: message });
    return reply;
  }

  if (step === 4) {
    const reply = await generateStep5Options(patient, context, message);
    await setState(patient.id, 'emotional_support', 5, { ...context, needMessage: message });
    return reply;
  }

  if (step === 5) {
    const option = parseOption(message);

    // Handle "which do you recommend?" or similar questions about the options
    if (/cu[aá]l.*recomien|cu[aá]l.*mejor|cu[aá]l.*sirve|qu[eé].*recomien|no s[eé] cu[aá]l/i.test(message)) {
      return 'Si necesitas desahogarte, la opción a) es buena. Si quieres algo más práctico para sentirte mejor ahora mismo, te recomiendo b) el ejercicio de respiración, es rápido y ayuda bastante.\n\n¿Cuál prefieres?';
    }

    if (option === 'a') {
      await setState(patient.id, 'emotional_support', 6, context);
      return await generateStep6CheckIn(patient, context);
    }
    if (option === 'b') return await startBreathing(patient);
    if (option === 'c') return await start54321(patient);
    if (option === 'd') {
      const lines = getEmergencyLines();
      await clearState(patient.id);
      let reply = `Aquí tienes los contactos de apoyo:\n\n📞 Línea de Salud Mental: ${lines.mentalHealth}\n📞 Clínica: ${lines.clinic}`;
      if (lines.psychLink) reply += `\n💬 Psicología (WhatsApp para cita): ${lines.psychLink}`;
      reply += '\n\nNo estás solo/a. Escríbeme cuando quieras. 💙';
      return reply;
    }
    return 'Puedes responder con la letra:\n\na) Seguir hablando\nb) Ejercicio de respiración\nc) Ejercicio 5-4-3-2-1\nd) Líneas de emergencia';
  }

  if (step === 6) {
    const reply = await generateStep7Closing(patient, message);
    await clearState(patient.id);
    return reply;
  }

  await clearState(patient.id);
  return await generateStep6CheckIn(patient, context || {});
}

async function startBreathing(patient) {
  await setState(patient.id, 'grounding_breathing', 0, {});
  return BREATHING_STEPS[0];
}

async function advanceBreathing(patient, message, state) {
  const nextStep = state.step + 1;
  if (nextStep < BREATHING_STEPS.length) {
    await setState(patient.id, 'grounding_breathing', nextStep, {});
    return BREATHING_STEPS[nextStep];
  }
  await setState(patient.id, 'emotional_support', 6, {});
  return await generateStep6CheckIn(patient, {});
}

async function start54321(patient) {
  await setState(patient.id, 'grounding_54321', 0, {});
  return GROUNDING_STEPS[0];
}

async function advance54321(patient, message, state) {
  const nextStep = state.step + 1;
  if (nextStep < GROUNDING_STEPS.length) {
    await setState(patient.id, 'grounding_54321', nextStep, {});
    return GROUNDING_STEPS[nextStep];
  }
  await setState(patient.id, 'emotional_support', 6, {});
  return await generateStep6CheckIn(patient, {});
}

module.exports = {
  startEmotionalFlow,
  advanceEmotionalFlow,
  startBreathing,
  advanceBreathing,
  start54321,
  advance54321,
};
