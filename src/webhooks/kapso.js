const express = require('express');
const router = express.Router();
const { handleIncomingMessage } = require('../agents/samiAgent');
const { sendMessage, markRead, sendTyping } = require('../services/kapso');

// Per-patient queue: serializes concurrent messages from the same phone number.
const queues = new Map();

function enqueue(phone, fn) {
  const prev = queues.get(phone) ?? Promise.resolve();
  const current = prev.then(fn, fn);
  queues.set(phone, current.finally(() => {
    if (queues.get(phone) === current) queues.delete(phone);
  }));
}

// Buffer: groups rapid-fire messages from the same patient before processing.
// Waits BUFFER_MS after the last message before flushing.
const BUFFER_MS = 5000;
const buffers = new Map(); // phone → { messages: [{messageId, text}], timer }

async function processMessage(phone, messageId, text) {
  await sendTyping(messageId);

  // Keep typing indicator alive every 3s while processing
  const typingInterval = setInterval(() => sendTyping(messageId), 3000);

  try {
    const reply = await handleIncomingMessage(phone, text);
    if (reply) {
      const paragraphs = reply.split(/\n\n+/).map(p => p.trim()).filter(p => p.length > 0);
      for (let i = 0; i < paragraphs.length; i++) {
        await sendMessage(phone, paragraphs[i]);
        if (i < paragraphs.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    }
  } finally {
    clearInterval(typingInterval);
  }
}

/**
 * POST /webhook/kapso
 * Kapso sends every incoming WhatsApp message here
 */
router.post('/', (req, res) => {
  // Acknowledge immediately so Kapso doesn't retry
  res.sendStatus(200);

  try {
    const { type, data } = req.body;

    if (type !== 'whatsapp.message.received') return;

    const items = Array.isArray(data) ? data : [data];

    for (const item of items) {
      if (item.message?.type !== 'text') continue;

      const phone = item.conversation.phone_number;
      const text = item.message.text.body.trim();
      const messageId = item.message.id;

      console.log(`📩 [${phone}] ${text}`);

      // Buffer disabled — process each message immediately
      markRead(messageId);
      enqueue(phone, () => processMessage(phone, messageId, text).catch(err => {
        console.error(`❌ processMessage error [${phone}]:`, err);
      }));
    }
  } catch (err) {
    console.error('❌ Webhook error:', err);
  }
});

module.exports = router;
