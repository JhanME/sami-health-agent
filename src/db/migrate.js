require('dotenv').config();
const pool = require('./pool');

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Enable pgvector
    await client.query('CREATE EXTENSION IF NOT EXISTS vector');

    // Patients
    await client.query(`
      CREATE TABLE IF NOT EXISTS patients (
        id SERIAL PRIMARY KEY,
        phone TEXT UNIQUE NOT NULL,         -- WhatsApp number (from Kapso)
        dni TEXT UNIQUE,                    -- Documento Nacional de Identidad
        name TEXT,
        diagnosis TEXT,                     -- e.g. "Cáncer de mama estadio II"
        treatment_plan TEXT,
        medications JSONB DEFAULT '[]',     -- [{ name, dose, frequency }]
        oncologist TEXT,
        next_appointment TIMESTAMP,
        nutrition_plan TEXT,
        emergency_contacts JSONB DEFAULT '[]',
        risk_level TEXT DEFAULT 'expected', -- expected | moderate | high
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Conversations (message history)
    await client.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        patient_id INT REFERENCES patients(id) ON DELETE CASCADE,
        role TEXT NOT NULL,                 -- user | assistant
        content TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Risk events / alerts
    await client.query(`
      CREATE TABLE IF NOT EXISTS alerts (
        id SERIAL PRIMARY KEY,
        patient_id INT REFERENCES patients(id) ON DELETE CASCADE,
        level TEXT NOT NULL,               -- moderate | high
        type TEXT,                         -- emotional | clinical | adherence | malpractice
        description TEXT,
        resolved BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // RAG knowledge base
    await client.query(`
      CREATE TABLE IF NOT EXISTS knowledge_chunks (
        id SERIAL PRIMARY KEY,
        patient_id INT REFERENCES patients(id) ON DELETE CASCADE,  -- NULL = global
        source TEXT NOT NULL,             -- ficha_clinica | guia_oms | protocolo_psico | nutricion
        content TEXT NOT NULL,
        embedding vector(768),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS knowledge_chunks_embedding_idx
      ON knowledge_chunks USING ivfflat (embedding vector_cosine_ops)
      WITH (lists = 100)
    `);

    // Appointments
    await client.query(`
      CREATE TABLE IF NOT EXISTS appointments (
        id SERIAL PRIMARY KEY,
        patient_id INT REFERENCES patients(id) ON DELETE CASCADE,
        scheduled_at TIMESTAMP NOT NULL,
        type TEXT,                         -- consulta | quimio | control | nutricion
        location TEXT,
        notes TEXT,
        reminded BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Add dni column if it doesn't exist (for existing databases)
    await client.query(`
      ALTER TABLE patients ADD COLUMN IF NOT EXISTS dni TEXT UNIQUE
    `);

    // Add activated_at column if it doesn't exist
    await client.query(`
      ALTER TABLE patients ADD COLUMN IF NOT EXISTS activated_at TIMESTAMP
    `);

    // Add oncologist_phone column if it doesn't exist
    await client.query(`
      ALTER TABLE patients ADD COLUMN IF NOT EXISTS oncologist_phone TEXT
    `);

    await client.query('COMMIT');
    console.log('✅ Migrations applied successfully');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Migration error:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
