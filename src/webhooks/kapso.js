const express = require('express');
const router = express.Router();
const { handleIncomingMessage } = require('../agents/samiAgent');
const { sendMessage, markRead, sendTyping } = require('../services/kapso');

/**
 * POST /webhook/kapso
 * Kapso sends every incoming WhatsApp message here
 */
router.post('/', async (req, res) => {
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

      console.log(`📩 [${phone}] ${text}`);

      // Mark as read + show typing indicator immediately
      await markRead(item.message.id);
      await sendTyping(item.message.id);

      // Keep typing indicator alive every 3s while processing
      const typingInterval = setInterval(() => sendTyping(item.message.id), 3000);

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
  } catch (err) {
    console.error('❌ Webhook error:', err);
  }
});

module.exports = router;
