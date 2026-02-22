require('dotenv').config();
const express = require('express');
const kapsoWebhook = require('./webhooks/kapso');

const app = express();

app.use(express.json());

// Health check
app.get('/', (req, res) => res.json({ status: 'Sami is running 🤖' }));

// Kapso webhook
app.use('/webhook/kapso', kapsoWebhook);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Sami running on port ${PORT}`);
});
