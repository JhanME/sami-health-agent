const express = require('express');
const path = require('path');
const router = express.Router();
const pool = require('../db/pool');
const { indexChunk } = require('../services/rag');

// ── Helpers (duplicated from admin.js to avoid modifying existing code) ───────

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

// ── Normalize phone to E.164 (Peru) ─────────────────────────────────────────

function normalizePhone(raw) {
  let digits = raw.replace(/[^0-9]/g, '');
  // If starts with 51 and is 11 digits (country code + 9-digit mobile), keep it
  if (digits.startsWith('51') && digits.length === 11) {
    return '+' + digits;
  }
  // If 9 digits starting with 9, add Peru country code
  if (digits.length === 9 && digits.startsWith('9')) {
    return '+51' + digits;
  }
  // Fallback: return with + prefix
  return '+' + digits;
}

// ── Simulated clinical data ──────────────────────────────────────────────────

const DEMO_DATA = {
  diagnosis: 'Cáncer de mama estadio IIA — carcinoma ductal infiltrante, receptor hormonal positivo (RE+/RP+), HER2 negativo',
  treatment_plan: 'Quimioterapia neoadyuvante (4 ciclos AC seguidos de 4 ciclos de Paclitaxel), luego cirugía conservadora y radioterapia. Terapia hormonal con Tamoxifeno por 5 años.',
  oncologist: 'Dra. Patricia Méndez Ríos',
  oncologist_phone: '+51999888777',
  nutrition_plan: 'Dieta hiperproteica durante quimioterapia. Evitar alimentos crudos en días de neutropenia. Hidratación mínima 2L/día. Suplemento de vitamina D 1000 UI diaria.',
  medications: [
    { name: 'Tamoxifeno', dose: '20 mg', frequency: 'una vez al día' },
    { name: 'Ondansetrón', dose: '8 mg', frequency: 'cada 8 horas (días de quimio)' },
    { name: 'Dexametasona', dose: '4 mg', frequency: 'cada 12 horas por 3 días post-quimio' },
    { name: 'Paracetamol', dose: '500 mg', frequency: 'cada 8 horas si hay dolor o fiebre' },
  ],
  emergency_contacts: [
    { name: 'Carlos Ramírez', parentesco: 'esposo', phone: '+51999111222' },
    { name: 'Lucía Ramírez Torres', parentesco: 'hija', phone: '+51999333444' },
  ],
};

// ── Routes ───────────────────────────────────────────────────────────────────

router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'demo.html'));
});

router.post('/register', async (req, res) => {
  const { name, phone } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Nombre requerido' });
  if (!phone || !phone.trim()) return res.status(400).json({ error: 'Número de celular requerido' });

  const normalizedPhone = normalizePhone(phone.trim());

  try {
    // Check if patient already exists and is activated
    const existing = await pool.query('SELECT id, activated_at FROM patients WHERE phone = $1', [normalizedPhone]);
    if (existing.rows.length > 0 && existing.rows[0].activated_at) {
      return res.json({ already_registered: true });
    }

    // 1. Insert or update patient
    const { rows } = await pool.query(
      `INSERT INTO patients (phone, name)
       VALUES ($1, $2)
       ON CONFLICT (phone) DO UPDATE SET name = EXCLUDED.name
       RETURNING *`,
      [normalizedPhone, name.trim()]
    );
    const patientId = rows[0].id;

    // 2. Update with simulated clinical data
    const nextApt = new Date();
    nextApt.setDate(nextApt.getDate() + 3);
    const { rows: updated } = await pool.query(
      `UPDATE patients
       SET diagnosis = $1, treatment_plan = $2, oncologist = $3, oncologist_phone = $4,
           nutrition_plan = $5, medications = $6, emergency_contacts = $7,
           next_appointment = $8, updated_at = NOW()
       WHERE id = $9 RETURNING *`,
      [
        DEMO_DATA.diagnosis,
        DEMO_DATA.treatment_plan,
        DEMO_DATA.oncologist,
        DEMO_DATA.oncologist_phone,
        DEMO_DATA.nutrition_plan,
        JSON.stringify(DEMO_DATA.medications),
        JSON.stringify(DEMO_DATA.emergency_contacts),
        nextApt.toISOString(),
        patientId,
      ]
    );

    // 3. Reindex ficha_clinica
    await pool.query(
      `DELETE FROM knowledge_chunks WHERE patient_id = $1 AND source = 'ficha_clinica'`,
      [patientId]
    );
    await indexChunk(buildFichaClinica(updated[0]), 'ficha_clinica', patientId);

    // 4. Delete old appointments and insert 3 demo appointments
    await pool.query(`DELETE FROM appointments WHERE patient_id = $1`, [patientId]);

    const apt1 = new Date(); apt1.setDate(apt1.getDate() + 3);
    const apt2 = new Date(); apt2.setDate(apt2.getDate() + 10);
    const apt3 = new Date(); apt3.setDate(apt3.getDate() + 21);

    const appointments = [
      { scheduled_at: apt1, type: 'Consulta oncológica', location: 'Consultorio 305, Clínica San Felipe', notes: 'Revisión de resultados de laboratorio pre-quimio' },
      { scheduled_at: apt2, type: 'Quimioterapia — Ciclo 3', location: 'Unidad de Infusión, Piso 2, Clínica San Felipe', notes: 'Llevar resultados de hemograma reciente. Ayuno de 2 horas.' },
      { scheduled_at: apt3, type: 'Ecografía mamaria de control', location: 'Centro de Imágenes, Clínica San Felipe', notes: 'Evaluación de respuesta al tratamiento' },
    ];

    for (const apt of appointments) {
      await pool.query(
        `INSERT INTO appointments (patient_id, scheduled_at, type, location, notes)
         VALUES ($1, $2, $3, $4, $5)`,
        [patientId, apt.scheduled_at.toISOString(), apt.type, apt.location, apt.notes]
      );
    }

    // 5. Reindex citas
    await reindexCitas(patientId);

    // activated_at stays NULL — Eva sends welcome on first WhatsApp message
    res.json({ success: true, message: 'Ahora envía un mensaje a Eva por WhatsApp para comenzar.' });
  } catch (err) {
    console.error('Demo register error:', err);
    res.status(500).json({ error: 'Error interno. Intenta de nuevo.' });
  }
});

module.exports = router;
