# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development (hot reload via nodemon)
npm run dev

# Production
npm start

# Database setup (run once to create tables + pgvector extension)
npm run db:migrate

# Seed initial knowledge chunks
npm run db:seed
```

No test, lint, or build pipeline is currently configured.

## Architecture

The project name is `sami-health` but the WhatsApp agent is named **Eva**. Eva is an oncology support companion. Messages flow through a multi-stage pipeline:

```
WhatsApp → Kapso.ai webhook → Patient lookup → Forbidden-topic filter → Risk classifier → RAG retrieval → Gemini 2.5 Pro → Reply
```

**`src/webhooks/kapso.js`** — Receives POST from Kapso.ai, extracts `from` + `message.text`, responds 200 immediately to prevent retries, then fires the pipeline async.

**`src/agents/samiAgent.js`** — Core orchestration. `handleIncomingMessage()` runs the full pipeline:
1. `getPatient(phone)` — looks up the patient by phone; returns `INACTIVE_REPLY` if unregistered (patients must be pre-created via the admin panel)
2. If `activated_at` is null, sends a hardcoded welcome message and sets `activated_at = NOW()`; exits early
3. `isForbiddenTopic()` — Gemini Flash LLM call; detects clinical questions (dosage changes, prognosis) and returns a hardcoded redirect-to-doctor reply
4. `classifyRisk()` — Gemini Flash LLM call; HIGH risk triggers an immediate hardcoded emergency response and exits; MODERATE risk saves an alert and continues
5. `retrieveContext()` — semantic search over `knowledge_chunks` (patient-specific + global)
6. Gemini 2.5 Pro call (`gemini-2.5-pro`) with `temperature: 0.2`, `maxOutputTokens: 8192`, RAG chunks + patient data injected into `systemInstruction`; last 10 messages passed as `history`
7. Save both turns to `messages` table

**`src/routes/admin.js`** — Session-authenticated REST API for the admin panel. Manages patients (CRUD, search by DNI), appointments, alerts, messages, doctor notes, and global knowledge chunks. When patient data or appointments change, knowledge chunks are automatically reindexed (delete + regenerate via `indexChunk`). Also exposes `POST /admin/patients/:id/activate` to send the first WhatsApp message manually.

**`src/public/admin.html`** — Single-file admin UI served as a static asset.

**`src/services/riskClassifier.js`** — Two separate Gemini Flash functions: `isForbiddenTopic()` (dosage/prognosis filter) and `classifyRisk()` (HIGH/MODERATE/EXPECTED). `saveAlert()` inserts into `alerts` and updates `patients.risk_level`. Both fall back safely on API error (`false`/`'expected'`).

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
- `patients` — phone, dni, name, diagnosis, treatment_plan, medications (JSONB), oncologist, nutrition_plan, next_appointment, emergency_contacts (JSONB), risk_level (`expected`|`moderate`|`high`), activated_at
- `messages` — role (`user`|`assistant`), content, patient_id FK
- `alerts` — level (`moderate`|`high`), type, description, resolved flag, patient_id FK
- `knowledge_chunks` — source, content, `embedding vector(768)` with ivfflat cosine index; `patient_id IS NULL` = global. Sources used: `ficha_clinica`, `citas`, `indicaciones_medico`, `guias_globales`
- `appointments` — scheduled_at, type, location, notes, reminded flag, patient_id FK

## Environment Variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `GEMINI_API_KEY` | Gemini 2.5 Pro (chat) + `gemini-flash-latest` (risk/filter) + text-embedding-004 (RAG) |
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
- Both `isForbiddenTopic` and `classifyRisk` use Gemini Flash as a fast, cheap pre-filter before the main Gemini 2.5 Pro call — keep this two-model pattern.
- The agent is deployed on **Railway**.
