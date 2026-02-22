const express = require('express');
const router = express.Router();
const { handleIncomingMessage } = require('../agents/samiAgent');
const { sendMessage } = require('../services/kapso');

/**
 * POST /webhook/kapso
 * Kapso sends every incoming WhatsApp message here
 */
router.post('/', async (req, res) => {
  // Acknowledge immediately so Kapso doesn't retry
  res.sendStatus(200);

  try {
    const { from, message, type } = req.body;

    // Only handle text messages for now
    if (type !== 'text' || !message?.text) return;

    const phone = from;
    const text = message.text.trim();

    console.log(`📩 [${phone}] ${text}`);

    const reply = await handleIncomingMessage(phone, text);

    await sendMessage(phone, reply);
  } catch (err) {
    console.error('❌ Webhook error:', err);
  }
});

module.exports = router;
