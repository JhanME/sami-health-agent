require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const kapsoWebhook = require('./webhooks/kapso');
const adminRoutes = require('./routes/admin');

const app = express();

app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'sami-admin-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000 }, // 8 horas
}));
app.use(express.static(path.join(__dirname, 'public')));

// Health check
app.get('/', (req, res) => res.json({ status: 'Sami is running 🤖' }));

// Kapso webhook
app.use('/webhook/kapso', kapsoWebhook);

// Admin panel API
app.use('/admin', adminRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 EvaCare+ running on port ${PORT}`);
});
