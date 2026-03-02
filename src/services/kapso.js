const { WhatsAppClient } = require('@kapso/whatsapp-cloud-api');

const client = new WhatsAppClient({
  baseUrl: 'https://api.kapso.ai/meta/whatsapp',
  kapsoApiKey: process.env.KAPSO_API_KEY,
});

/**
 * Send a text message to a WhatsApp number via Kapso
 */
async function sendMessage(to, text) {
  try {
    await client.messages.sendText({
      phoneNumberId: process.env.KAPSO_PHONE_NUMBER_ID,
      to,
      body: text,
      typingIndicator: { type: 'text' },
    });
    console.log(`📤 [${to}] Message sent`);
  } catch (err) {
    console.error('❌ Kapso send error:', err.response?.data || err.message);
    throw err;
  }
}

async function markRead(messageId) {
  try {
    await client.messages.markRead({
      phoneNumberId: process.env.KAPSO_PHONE_NUMBER_ID,
      messageId,
    });
  } catch (err) {
    console.error('❌ markRead error:', err.message);
  }
}

async function sendTyping(messageId) {
  try {
    await client.messages.markRead({
      phoneNumberId: process.env.KAPSO_PHONE_NUMBER_ID,
      messageId,
      typingIndicator: { type: 'text' },
    });
  } catch {
    // Non-critical
  }
}

module.exports = { sendMessage, markRead, sendTyping };
