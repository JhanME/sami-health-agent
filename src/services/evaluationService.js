const { GoogleGenerativeAI } = require('@google/generative-ai');
const pool = require('../db/pool');
const { setState, clearState } = require('./conversationState');
const { saveAlert } = require('./riskClassifier');
const { sendRiskReport } = require('./psychReport');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const flash = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

// ── Evaluation definitions ────────────────────────────────────────────────────

const EVALUATIONS = {
  gad2: {
    questions: [
      'En las últimas 2 semanas, ¿con qué frecuencia te has sentido nerviosa/o, ansiosa/o o muy al límite?\n\n0 = Nunca  1 = Varios días  2 = Más de la mitad de los días  3 = Casi todos los días\n\nResponde con el número.',
      'En las últimas 2 semanas, ¿con qué frecuencia no has podido parar de preocuparte o controlar el preocuparte?\n\n0 = Nunca  1 = Varios días  2 = Más de la mitad de los días  3 = Casi todos los días\n\nResponde con el número.',
    ],
    scale: [0, 3],
    threshold: 3,
    cadenceDays: 14,
  },
  phq2: {
    intro: 'Quiero preguntarte un par de cosas para entender cómo te has estado sintiendo estas últimas dos semanas.\nNo es un examen ni un diagnóstico, solo me ayuda a acompañarte mejor.',
    questions: [
      'En estas últimas dos semanas, ¿has sentido que te costaba disfrutar cosas que normalmente te gustan o que te interesan?\n\na) Nunca\nb) Algunos días\nc) Más de la mitad de los días\nd) Casi todos los días',
      'Y en estas últimas semanas, ¿te has sentido triste, desanimada/o o sin esperanza?\n\na) Nunca\nb) Algunos días\nc) Más de la mitad de los días\nd) Casi todos los días',
    ],
    scale: [0, 3],
    threshold: 3,
    cadenceDays: 14,
    conversational: true,
  },
  tipi: {
    questions: [
      'Voy a hacerte algunas preguntas sobre tu personalidad. Responde del 1 al 7, donde 1 = Muy en desacuerdo y 7 = Muy de acuerdo.\n\n¿Me describes como alguien extrovertida/o, entusiasta?',
      '¿Me describes como alguien crítica/o, conflictiva/o? (1=muy en desacuerdo, 7=muy de acuerdo)',
      '¿Me describes como alguien confiable, autodisciplinada/o? (1=muy en desacuerdo, 7=muy de acuerdo)',
      '¿Me describes como alguien ansiosa/o, que se molesta fácilmente? (1=muy en desacuerdo, 7=muy de acuerdo)',
      '¿Me describes como alguien abierta/o a nuevas experiencias, compleja/o? (1=muy en desacuerdo, 7=muy de acuerdo)',
      '¿Me describes como alguien reservada/o, callada/o? (1=muy en desacuerdo, 7=muy de acuerdo)',
      '¿Me describes como alguien empática/o, de buen corazón? (1=muy en desacuerdo, 7=muy de acuerdo)',
      '¿Me describes como alguien desorganizada/o, descuidada/o? (1=muy en desacuerdo, 7=muy de acuerdo)',
      '¿Me describes como alguien tranquila/o, emocionalmente estable? (1=muy en desacuerdo, 7=muy de acuerdo)',
      '¿Me describes como alguien convencional, sin mucha creatividad? (1=muy en desacuerdo, 7=muy de acuerdo)',
    ],
    scale: [1, 7],
    threshold: null,
    cadenceDays: 30,
  },
  qol: {
    questions: [
      '¿Cómo describirías tu nivel de *dolor* en los últimos 7 días?\n\n1 = Sin dolor  10 = Dolor muy intenso\n\nResponde con el número.',
      '¿Cuánto *cansancio o fatiga* has tenido en los últimos 7 días?\n\n1 = Nada  10 = Agotamiento extremo\n\nResponde con el número.',
      '¿Cómo está tu *bienestar emocional* general esta semana?\n\n1 = Muy mal  5 = Muy bien\n\nResponde con el número.',
      '¿Cómo ha sido tu *calidad de sueño* en los últimos 7 días?\n\n1 = Muy mala  5 = Excelente\n\nResponde con el número.',
    ],
    scale: [1, 10],
    threshold: null,
    cadenceDays: 7,
  },
};

// ── Check if an evaluation is due ────────────────────────────────────────────

async function getEvaluationDue(patient, currentState) {
  // Don't interrupt emotional flows
  if (
    currentState &&
    ['emotional_support', 'grounding_breathing', 'grounding_54321'].includes(currentState.flow)
  ) {
    return null;
  }

  const lastEval = patient.last_evaluation_at || {};
  const now = new Date();

  const order = ['qol', 'gad2', 'phq2', 'tipi'];
  for (const type of order) {
    const lastDate = lastEval[type] ? new Date(lastEval[type]) : null;
    const cadence = EVALUATIONS[type].cadenceDays;
    const daysSince = lastDate
      ? (now - lastDate) / (1000 * 60 * 60 * 24)
      : Infinity;
    if (daysSince >= cadence) return type;
  }
  return null;
}

// ── Parse conversational answer (a/b/c/d or text) ────────────────────────────

async function parseConversationalAnswer(message) {
  const text = message.trim().toLowerCase();
  if (/^a\b|nunca/i.test(text)) return 0;
  if (/^b\b|algunos/i.test(text)) return 1;
  if (/^c\b|m[aá]s de la mitad|mitad/i.test(text)) return 2;
  if (/^d\b|casi todos|todos los d[ií]as/i.test(text)) return 3;

  // Fallback: Gemini
  try {
    const prompt = `El paciente respondió a una escala de frecuencia con: "${message}"
Las opciones son: a) Nunca (0), b) Algunos días (1), c) Más de la mitad de los días (2), d) Casi todos los días (3).
¿Cuál eligió? Responde SOLO con el número: 0, 1, 2 o 3`;
    const r = await flash.generateContent(prompt);
    const n = parseInt(r.response.text().trim(), 10);
    return (!isNaN(n) && n >= 0 && n <= 3) ? n : null;
  } catch {
    return null;
  }
}

// ── PHQ-2 score-based feedback ───────────────────────────────────────────────

const PHQ2_FEEDBACK = {
  low: 'Parece que estas últimas semanas no han sido muy difíciles para ti. Aun así, todos tenemos días malos y siempre está bien hablar de lo que sentimos. 💙',
  mid: 'Se nota que has tenido algunos momentos pesados últimamente. Podemos ver juntos formas de cuidarte un poco más y sentirte mejor. 💙',
  high: 'Siento que estas semanas han sido muy difíciles para ti. Podría ayudarte mucho hablar con alguien de confianza o un profesional de salud mental.\n\nTambién podemos hacer un pequeño ejercicio juntos para calmar tu mente y tu cuerpo ahora mismo.\n\n¿Qué te gustaría hacer?\n\na) Seguir hablando\nb) Ejercicio de respiración\nc) Ejercicio 5-4-3-2-1\nd) Líneas de emergencia',
};

function getPhq2Feedback(score) {
  if (score <= 1) return { message: PHQ2_FEEDBACK.low, offerExercise: false };
  if (score <= 3) return { message: PHQ2_FEEDBACK.mid, offerExercise: false };
  return { message: PHQ2_FEEDBACK.high, offerExercise: true };
}

// ── Parse a numeric answer ────────────────────────────────────────────────────

async function parseNumericAnswer(message, min, max) {
  const direct = parseInt(message.trim(), 10);
  if (!isNaN(direct) && direct >= min && direct <= max) return direct;

  const prompt = `El paciente respondió a una escala numérica (${min}-${max}) con: "${message}". Extrae el número que quiso decir. Responde SOLO con el número, sin texto.`;
  try {
    const r = await flash.generateContent(prompt);
    const n = parseInt(r.response.text().trim(), 10);
    return !isNaN(n) && n >= min && n <= max ? n : null;
  } catch {
    return null;
  }
}

// ── Score evaluation ──────────────────────────────────────────────────────────

function scoreEvaluation(type, answers) {
  if (type === 'gad2' || type === 'phq2') {
    const score = answers.reduce((s, a) => s + (a || 0), 0);
    return { score, screenedPositive: score >= EVALUATIONS[type].threshold };
  }

  if (type === 'tipi') {
    // Big Five subscores (items are 1-indexed)
    // Reverse-keyed items: 2, 4, 6, 8, 10
    const r = (v, max = 7) => max + 1 - v;
    const subscores = {
      extraversion:    (answers[0] + r(answers[5])) / 2,
      agreeableness:   (r(answers[1]) + answers[6]) / 2,
      conscientiousness: (answers[2] + r(answers[7])) / 2,
      neuroticism:     (answers[3] + r(answers[8])) / 2,
      openness:        (answers[4] + r(answers[9])) / 2,
    };
    const avgScore = Object.values(subscores).reduce((s, v) => s + v, 0) / 5;
    return { score: Math.round(avgScore * 10) / 10, screenedPositive: false, subscores };
  }

  if (type === 'qol') {
    // answers: [pain(1-10), fatigue(1-10), wellbeing(1-5), sleep(1-5)]
    // Normalize all to 0-100: pain/fatigue are reverse (lower = better)
    const painNorm    = ((10 - answers[0]) / 9) * 100;
    const fatigueNorm = ((10 - answers[1]) / 9) * 100;
    const wellNorm    = ((answers[2] - 1) / 4) * 100;
    const sleepNorm   = ((answers[3] - 1) / 4) * 100;
    const score = Math.round((painNorm + fatigueNorm + wellNorm + sleepNorm) / 4);
    return { score, screenedPositive: score < 40 };
  }

  return { score: null, screenedPositive: false };
}

// ── Build empathetic closing message ─────────────────────────────────────────

async function buildClosingMessage(type, score, screenedPositive, patient) {
  const typeNames = { gad2: 'ansiedad', phq2: 'estado de ánimo', tipi: 'personalidad', qol: 'calidad de vida' };
  const typeName = typeNames[type] || type;

  const prompt = `Eres Eva, acompañante oncológica. El paciente ${patient.name || ''} acaba de completar una breve evaluación de ${typeName}.

Resultado: puntuación ${score}${screenedPositive ? ', con señales que merecen atención' : ', dentro de lo esperado'}.

Escribe un cierre empático de 2-3 oraciones:
- Si screened_positive=true: reconoce el esfuerzo, valida sus sentimientos, menciona que el equipo de atención estará al tanto.
- Si screened_positive=false: felicita brevemente y anima a seguir cuidándose.

Tono cálido, natural, como un mensaje de WhatsApp. Sin mencionar puntuaciones numéricas al paciente.`;

  try {
    const r = await flash.generateContent(prompt);
    return r.response.text().trim();
  } catch {
    return screenedPositive
      ? 'Gracias por responder con honestidad. Lo que sientes es válido y tu equipo de atención sabrá cómo apoyarte. 💙'
      : '¡Gracias por tomarte el tiempo! Sigue cuidándote así de bien. 💙';
  }
}

// ── Start evaluation ──────────────────────────────────────────────────────────

async function startEvaluation(patient, type) {
  const def = EVALUATIONS[type];
  let intro;
  if (def.intro) {
    intro = `${def.intro}\n\n${def.questions[0]}`;
  } else if (type === 'tipi') {
    intro = `Quiero hacerte unas preguntas rápidas sobre cómo eres tú en general. Son solo ${def.questions.length} preguntas y no hay respuestas correctas o incorrectas. ¿Empezamos?\n\n${def.questions[0]}`;
  } else {
    intro = `Tengo unas preguntas cortas sobre cómo te has sentido. Solo son ${def.questions.length}. ¿Te parece bien?\n\n${def.questions[0]}`;
  }

  await setState(patient.id, 'evaluation', 0, { type, answers: [] });
  return intro;
}

// ── Advance evaluation ────────────────────────────────────────────────────────

async function advanceEvaluation(patient, message, state) {
  const { type, answers } = state.context;
  const def = EVALUATIONS[type];
  const [scaleMin, scaleMax] = def.scale;

  // Check if patient wants to skip/cancel the evaluation
  if (/no quiero|no me siento|no tengo ganas|no puedo|dejarlo|saltar|skip|cancelar|después|despues|luego|ahora no/i.test(message.trim())) {
    await clearState(patient.id);
    return 'Está bien, no te preocupes. Lo dejamos para otro momento. Estoy aquí para lo que necesites 💙';
  }

  // Parse the answer — conversational or numeric
  const value = def.conversational
    ? await parseConversationalAnswer(message)
    : await parseNumericAnswer(message, scaleMin, scaleMax);

  if (value === null) {
    return def.conversational
      ? 'No pude entender tu respuesta. Puedes responder con la letra (a, b, c, d) o con las palabras (nunca, algunos días, etc.).'
      : `No pude entender tu respuesta. Por favor responde con un número del ${scaleMin} al ${scaleMax}.`;
  }

  const updatedAnswers = [...answers, value];
  const nextQuestionIdx = updatedAnswers.length;

  if (nextQuestionIdx < def.questions.length) {
    await setState(patient.id, 'evaluation', nextQuestionIdx, { type, answers: updatedAnswers });
    return def.questions[nextQuestionIdx];
  }

  // Evaluation complete
  const { score, screenedPositive, subscores } = scoreEvaluation(type, updatedAnswers);

  // Save result
  await pool.query(
    `INSERT INTO evaluation_results (patient_id, type, answers, score, screened_positive)
     VALUES ($1, $2, $3, $4, $5)`,
    [patient.id, type, JSON.stringify(updatedAnswers), score, screenedPositive]
  );

  // Update last_evaluation_at
  const lastEval = patient.last_evaluation_at || {};
  lastEval[type] = new Date().toISOString().split('T')[0];
  await pool.query(
    `UPDATE patients SET last_evaluation_at = $1 WHERE id = $2`,
    [JSON.stringify(lastEval), patient.id]
  );

  // Alert if screened positive
  if (screenedPositive) {
    await saveAlert(
      patient.id,
      'moderate',
      `Evaluación ${type.toUpperCase()} con resultado positivo (score: ${score})`
    );
    await sendRiskReport(patient, 'moderate', `Evaluación ${type.toUpperCase()} positiva — score ${score}`);
  }

  // PHQ-2: use specific feedback with optional exercise offer
  if (type === 'phq2') {
    const { message: feedback, offerExercise } = getPhq2Feedback(score);
    if (offerExercise) {
      // Transition to emotional_support step 5 (options) instead of closing
      await setState(patient.id, 'emotional_support', 5, { fromPhq2: true });
    } else {
      await clearState(patient.id);
    }
    return feedback;
  }

  await clearState(patient.id);

  const closing = await buildClosingMessage(type, score, screenedPositive, patient);
  return closing;
}

module.exports = { getEvaluationDue, startEvaluation, advanceEvaluation };
