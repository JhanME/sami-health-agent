const { OpenAI } = require('openai');
const pool = require('../db/pool');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Generate an embedding vector for a given text
 */
async function getEmbedding(text) {
  const res = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
  });
  return res.data[0].embedding;
}

/**
 * Index a document chunk into the knowledge base
 * @param {string} content - Text to index
 * @param {string} source - e.g. 'ficha_clinica', 'guia_oms', 'protocolo_psico'
 * @param {number|null} patientId - null for global knowledge
 */
async function indexChunk(content, source, patientId = null) {
  const embedding = await getEmbedding(content);
  await pool.query(
    `INSERT INTO knowledge_chunks (patient_id, source, content, embedding)
     VALUES ($1, $2, $3, $4)`,
    [patientId, source, content, JSON.stringify(embedding)]
  );
}

/**
 * Retrieve the top-k most relevant chunks for a query
 * Searches both patient-specific and global knowledge
 */
async function retrieveContext(query, patientId, topK = 5) {
  const embedding = await getEmbedding(query);

  const result = await pool.query(
    `SELECT content, source, 1 - (embedding <=> $1) AS similarity
     FROM knowledge_chunks
     WHERE patient_id = $2 OR patient_id IS NULL
     ORDER BY embedding <=> $1
     LIMIT $3`,
    [JSON.stringify(embedding), patientId, topK]
  );

  return result.rows;
}

module.exports = { indexChunk, retrieveContext, getEmbedding };
