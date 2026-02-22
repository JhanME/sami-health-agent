const axios = require('axios');

const KAPSO_API_URL = 'https://api.kapso.ai/v1';

/**
 * Send a text message to a WhatsApp number via Kapso
 */
async function sendMessage(to, text) {
  try {
    await axios.post(
      `${KAPSO_API_URL}/messages`,
      {
        to,
        type: 'text',
        text: { body: text },
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.KAPSO_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );
    console.log(`📤 [${to}] Message sent`);
  } catch (err) {
    console.error('❌ Kapso send error:', err.response?.data || err.message);
    throw err;
  }
}

module.exports = { sendMessage };
