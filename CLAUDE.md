# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development (hot reload via nodemon)
npm run dev

# Production
npm start

# Database setup — idempotent, safe to re-run on existing databases
npm run db:migrate

# Seed initial knowledge chunks (NOTE: src/db/seed.js does not exist yet — create before use)
npm run db:seed
```

No test, lint, or build pipeline is currently configured.

## Architecture

The project name is `sami-health` but the WhatsApp agent is named **Eva**. Eva is an oncology support companion. Messages flow through a multi-stage pipeline:

```
WhatsApp → Kapso.ai webhook → Patient lookup → Forbidden-topic filter → Risk classifier → RAG retrieval → gemini-2.0-flash → Reply
```

**`src/webhooks/kapso.js`** — Receives POST from Kapso.ai, responds 200 immediately to prevent retries. Maintains a per-patient in-memory queue (`Map<phone, Promise>`) to serialize concurrent messages from the same number. For each message: calls `markRead` + `sendTyping` (refreshed every 3s), then sends the reply split by `\n\n` as separate WhatsApp messages with 1-second delays between paragraphs. Only processes messages where `type === 'whatsapp.message.received'` and `message.type === 'text'`; all other message types (images, audio, etc.) are silently dropped. Kapso payload shape: `{ type, data: { conversation: { phone_number }, message: { id, type, text: { body } } } }`.

**`src/agents/samiAgent.js`** — Core orchestration. `handleIncomingMessage()` runs the full pipeline:
1. `getPatient(phone)` — looks up the patient by phone (normalizes to E.164); returns `INACTIVE_REPLY` if unregistered
2. If `activated_at` is null, sends a hardcoded welcome message and sets `activated_at = NOW()`; exits early
3. Steps 3–5 run in parallel via `Promise.all`: `isForbiddenTopic()`, `classifyRisk()`, `retrieveContext()`, `getHistory()`
4. `isForbiddenTopic()` — detects dosage-change / prognosis questions; returns hardcoded redirect-to-doctor reply
5. `classifyRisk()` — HIGH risk triggers hardcoded emergency response + `sendRiskReport()`; MODERATE saves alert and calls `sendRiskReport()` only if patient was previously at `expected` level (first escalation)
6. Gemini chat call (`gemini-2.0-flash`) with `temperature: 0.2`, `maxOutputTokens: 8192`, RAG chunks + patient data in `systemInstruction`; last 10 messages as `history` (Gemini requires history to start with a `user` turn)
7. Save both turns to `messages` table

**`src/routes/admin.js`** — Session-authenticated REST API for the admin panel. Manages patients (CRUD, search by DNI), appointments, alerts, messages, doctor notes, and global knowledge chunks. When patient data or appointments change, knowledge chunks are automatically reindexed (delete + regenerate via `indexChunk`). Also exposes `POST /admin/patients/:id/activate` to send the first WhatsApp message manually.

**`src/public/admin.html`** — Single-file admin UI served as a static asset.

**`src/services/riskClassifier.js`** — Two separate Gemini Flash functions: `isForbiddenTopic()` (dosage/prognosis filter) and `classifyRisk()` (HIGH/MODERATE/EXPECTED). `saveAlert()` inserts into `alerts` and updates `patients.risk_level`. Both fall back safely on API error (`false`/`'expected'`). Uses `gemini-flash-latest`.

**`src/services/psychReport.js`** — Called on HIGH risk (always) and MODERATE risk (only on first escalation). Fetches the last 5 alerts from the past 7 days, generates a 3-sentence clinical summary via `gemini-2.0-flash`, then sends the report via WhatsApp to all `emergency_contacts` + `oncologist_phone` on the patient record.

**`src/services/rag.js`** — Uses Google `text-embedding-004` (768 dimensions) to embed queries and retrieve top-5 chunks via pgvector cosine distance (`<=>`). `indexChunk(content, source, patientId)` is the public API for loading knowledge; `patientId = null` means global.

**`src/services/kapso.js`** — Thin axios wrapper for the Kapso.ai REST API (`POST /v1/messages`).

**`src/db/`** — `pool.js` exports a pg connection pool from `DATABASE_URL`; `migrate.js` is the sole schema source of truth.

## Patient Lifecycle

Patients must be **pre-registered by an admin** before they can interact with Eva:
1. Admin creates patient record via `POST /admin/patients` (phone + name)
2. Admin fills in clinical data via `PUT /admin/patients/:id` — this auto-generates a `ficha_clinica` knowledge chunk
3. Admin adds appointments via `POST /admin/patients/:id/appointments` — auto-generates `citas` chunks
4. Patient is activated either: (a) admin sends first message via `POST /admin/patients/:id/activate`, or (b) patient messages first and Eva sends the welcome message and sets `activated_at`

## Database Schema

Five tables defined in `migrate.js`:
- `patients` — phone, dni, name, diagnosis, treatment_plan, medications (JSONB), oncologist, oncologist_phone, nutrition_plan, next_appointment, emergency_contacts (JSONB), risk_level (`expected`|`moderate`|`high`), activated_at
- `messages` — role (`user`|`assistant`), content, patient_id FK
- `alerts` — level (`moderate`|`high`), type, description, resolved flag, patient_id FK
- `knowledge_chunks` — source, content, `embedding vector(768)` with ivfflat cosine index; `patient_id IS NULL` = global. Sources used: `ficha_clinica`, `citas`, `indicaciones_medico`, `guias_globales`
- `appointments` — scheduled_at, type, location, notes, reminded flag, patient_id FK

## Environment Variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `GEMINI_API_KEY` | `gemini-2.0-flash` (chat + psychReport) + `gemini-flash-latest` (risk/filter) + `text-embedding-004` (RAG) |
| `KAPSO_API_KEY` | Outbound WhatsApp messages via Kapso.ai |
| `KAPSO_WEBHOOK_SECRET` | Webhook signature verification (reserved) |
| `SESSION_SECRET` | Express session secret for admin panel (default: `sami-admin-secret`) |
| `ADMIN_USER` | Admin panel username (default: `admin`) |
| `ADMIN_PASSWORD` | Admin panel password (default: `admin`) |
| `PORT` | Express port (default 3000) |

## Local Development

Kapso.ai requires a public HTTPS URL for its webhook. Expose the local server with:

```bash
cloudflared tunnel --url http://localhost:3000
```

Then paste the generated URL into Kapso webhook settings.

## Key Constraints

- All user-facing responses are in **Spanish**.
- The system prompt enforces that Eva only answers from RAG-retrieved context — never from its own parametric knowledge about medical topics.
- `temperature: 0.2` is intentional for clinical accuracy; do not raise it.
- Both `isForbiddenTopic` and `classifyRisk` use `gemini-flash-latest` as a fast, cheap pre-filter before the main `gemini-2.0-flash` chat call — keep this two-model pattern.
- Steps 3–5 of the pipeline run via `Promise.all` — keep pre-filters concurrent.
- The agent is deployed on **Railway**.
