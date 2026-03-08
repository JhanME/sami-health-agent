const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { indexChunk } = require('../services/rag');
const { sendMessage } = require('../services/kapso');

const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';

// ── Auth ──────────────────────────────────────────────────────────────────────

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USER && password === ADMIN_PASSWORD) {
    req.session.authenticated = true;
    res.json({ success: true });
  } else {
    res.status(401).json({ error: 'Credenciales incorrectas' });
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

router.get('/auth', (req, res) => {
  if (req.session && req.session.authenticated) return res.json({ ok: true });
  res.status(401).json({ ok: false });
});

function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) return next();
  res.status(401).json({ error: 'No autenticado' });
}

// Todas las rutas de aquí en adelante requieren sesión activa
router.use(requireAuth);

// Build a narrative text for the ficha_clinica chunk
function buildFichaClinica(patient) {
  const meds = Array.isArray(patient.medications) ? patient.medications : [];
  const medsText = meds.length > 0
    ? meds.map(m => `${m.name || ''} ${m.dose || ''} ${m.frequency || ''}`.trim()).join(', ')
    : 'ninguno';
  const contacts = Array.isArray(patient.emergency_contacts) ? patient.emergency_contacts : [];
  const contactsText = contacts.length > 0
    ? contacts.map(c => `${c.name} (${c.parentesco}) — ${c.phone}`).join(', ')
    : 'no registrados';
  return [
    `Perfil clínico de ${patient.name || 'paciente'} (DNI: ${patient.dni || 'no registrado'}, teléfono: ${patient.phone}):`,
    `Diagnóstico: ${patient.diagnosis || 'no especificado'}`,
    `Plan de tratamiento: ${patient.treatment_plan || 'no especificado'}`,
    `Oncólogo: ${patient.oncologist || 'no especificado'}`,
    `Teléfono oncólogo: ${patient.oncologist_phone || 'no registrado'}`,
    `Plan nutricional: ${patient.nutrition_plan || 'no especificado'}`,
    `Próxima cita registrada: ${patient.next_appointment || 'no agendada'}`,
    `Medicamentos: ${medsText}`,
    `Contactos de emergencia: ${contactsText}`,
  ].join('\n');
}

// Delete all citas chunks for a patient and reindex future appointments
async function reindexCitas(patientId) {
  await pool.query(
    `DELETE FROM knowledge_chunks WHERE patient_id = $1 AND source = 'citas'`,
    [patientId]
  );
  const { rows } = await pool.query(
    `SELECT * FROM appointments WHERE patient_id = $1 AND scheduled_at > NOW() ORDER BY scheduled_at ASC`,
    [patientId]
  );
  for (const apt of rows) {
    const date = new Date(apt.scheduled_at).toLocaleDateString('es-PE', { dateStyle: 'long' });
    const text = [
      `Cita médica: ${apt.type || 'consulta'} el ${date}`,
      apt.location ? `en ${apt.location}` : '',
      apt.notes ? `Notas: ${apt.notes}` : '',
    ].filter(Boolean).join('. ');
    await indexChunk(text, 'citas', patientId);
  }
}

// ── Patients ──────────────────────────────────────────────────────────────────

router.get('/patients', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, phone, name, diagnosis, risk_level, created_at FROM patients ORDER BY created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/patients/search', async (req, res) => {
  const { dni } = req.query;
  if (!dni) return res.status(400).json({ error: 'dni query param required' });
  try {
    const { rows } = await pool.query(`SELECT * FROM patients WHERE dni = $1`, [dni]);
    res.json(rows[0] || null);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/patients', async (req, res) => {
  const { phone, name } = req.body;
  if (!phone) return res.status(400).json({ error: 'phone required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO patients (phone, name)
       VALUES ($1, $2)
       ON CONFLICT (phone) DO UPDATE SET name = EXCLUDED.name
       RETURNING *`,
      [phone, name || null]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/patients/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM patients WHERE id = $1`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Patient not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/patients/:id', async (req, res) => {
  const patientId = parseInt(req.params.id);
  const { name, dni, diagnosis, treatment_plan, oncologist, oncologist_phone, nutrition_plan, next_appointment, medications, emergency_contacts } = req.body;
  const nextApt = (next_appointment === '' || next_appointment == null) ? null : next_appointment;
  let meds, contacts;
  try {
    meds = typeof medications === 'string' ? JSON.parse(medications) : (medications || []);
  } catch { meds = []; }
  try {
    contacts = typeof emergency_contacts === 'string' ? JSON.parse(emergency_contacts) : (emergency_contacts || []);
  } catch { contacts = []; }
  try {
    const { rows } = await pool.query(
      `UPDATE patients
       SET name = $1, dni = $2, diagnosis = $3, treatment_plan = $4, oncologist = $5,
           nutrition_plan = $6, next_appointment = $7, medications = $8,
           emergency_contacts = $9, oncologist_phone = $10, updated_at = NOW()
       WHERE id = $11 RETURNING *`,
      [name, dni || null, diagnosis, treatment_plan, oncologist, nutrition_plan, nextApt,
       JSON.stringify(meds), JSON.stringify(contacts), oncologist_phone || null, patientId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Patient not found' });
    const patient = rows[0];
    // Reindex ficha_clinica (delete + regenerate)
    await pool.query(
      `DELETE FROM knowledge_chunks WHERE patient_id = $1 AND source = 'ficha_clinica'`,
      [patientId]
    );
    await indexChunk(buildFichaClinica(patient), 'ficha_clinica', patientId);
    res.json(patient);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Activation ────────────────────────────────────────────────────────────────

router.post('/patients/:id/activate', async (req, res) => {
  const patientId = parseInt(req.params.id);
  const { message } = req.body;
  if (!message || !message.trim()) return res.status(400).json({ error: 'message required' });
  try {
    const { rows } = await pool.query('SELECT * FROM patients WHERE id = $1', [patientId]);
    if (!rows[0]) return res.status(404).json({ error: 'Patient not found' });
    const patient = rows[0];

    // Send first message via WhatsApp
    await sendMessage(patient.phone, message.trim());

    // Save to message history
    await pool.query(
      'INSERT INTO messages (patient_id, role, content) VALUES ($1, $2, $3)',
      [patientId, 'assistant', message.trim()]
    );

    // Mark as activated
    const { rows: updated } = await pool.query(
      'UPDATE patients SET activated_at = NOW() WHERE id = $1 RETURNING *',
      [patientId]
    );
    res.json(updated[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Messages ──────────────────────────────────────────────────────────────────

router.get('/patients/:id/messages', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM messages WHERE patient_id = $1 ORDER BY created_at ASC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Alerts ────────────────────────────────────────────────────────────────────

router.get('/patients/:id/alerts', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM alerts WHERE patient_id = $1 ORDER BY created_at DESC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/alerts/:id/resolve', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE alerts SET resolved = TRUE WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Alert not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Appointments ──────────────────────────────────────────────────────────────

router.get('/patients/:id/appointments', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM appointments WHERE patient_id = $1 ORDER BY scheduled_at ASC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/patients/:id/appointments', async (req, res) => {
  const patientId = parseInt(req.params.id);
  const { scheduled_at, type, location, notes } = req.body;
  if (!scheduled_at) return res.status(400).json({ error: 'scheduled_at required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO appointments (patient_id, scheduled_at, type, location, notes)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [patientId, scheduled_at, type || null, location || null, notes || null]
    );
    await reindexCitas(patientId);
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/appointments/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT patient_id FROM appointments WHERE id = $1`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Appointment not found' });
    const patientId = rows[0].patient_id;
    await pool.query(`DELETE FROM appointments WHERE id = $1`, [req.params.id]);
    await reindexCitas(patientId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Doctor notes ──────────────────────────────────────────────────────────────

router.post('/patients/:id/notes', async (req, res) => {
  const patientId = parseInt(req.params.id);
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'text required' });
  try {
    const fecha = new Date().toLocaleDateString('es-PE', { dateStyle: 'long' });
    const content = `Indicaciones del médico (${fecha}): ${text}`;
    await indexChunk(content, 'indicaciones_medico', patientId);
    res.json({ success: true, content });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/patients/:id/notes', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, content, created_at FROM knowledge_chunks
       WHERE patient_id = $1 AND source = 'indicaciones_medico'
       ORDER BY created_at DESC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Global knowledge ──────────────────────────────────────────────────────────

router.post('/knowledge/global', async (req, res) => {
  const { text, source } = req.body;
  if (!text) return res.status(400).json({ error: 'text required' });
  const src = source || 'guias_globales';
  try {
    await pool.query(
      `DELETE FROM knowledge_chunks WHERE patient_id IS NULL AND source = $1`,
      [src]
    );
    const paragraphs = text.split(/\n\n+/).map(p => p.trim()).filter(p => p.length > 0);
    for (const paragraph of paragraphs) {
      await indexChunk(paragraph, src, null);
    }
    res.json({ success: true, chunks: paragraphs.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/knowledge/global', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, source, content, created_at FROM knowledge_chunks
       WHERE patient_id IS NULL ORDER BY created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
