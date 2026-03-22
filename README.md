<div align="center">

# amycare-health-agent

**Sami is an intelligent conversational agent that accompanies oncology patients through their treatment journey — handling appointment booking, medication reminders, personalized nutrition plans, and emotional support, all through WhatsApp.**

[![Node.js](https://img.shields.io/badge/Node.js-22.x-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![Express](https://img.shields.io/badge/Express-4.x-000000?style=flat-square&logo=express&logoColor=white)](https://expressjs.com)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-pgvector-4169E1?style=flat-square&logo=postgresql&logoColor=white)](https://www.postgresql.org)
[![OpenAI](https://img.shields.io/badge/OpenAI-Embeddings-412991?style=flat-square&logo=openai&logoColor=white)](https://openai.com)
[![WhatsApp](https://img.shields.io/badge/WhatsApp-Kapso.ai-25D366?style=flat-square&logo=whatsapp&logoColor=white)](https://kapso.ai)
[![Railway](https://img.shields.io/badge/Deploy-Railway-0B0D0E?style=flat-square&logo=railway&logoColor=white)](https://railway.app)
[![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](LICENSE)

</div>

---

##  How it works

Sami operates as a multi-layer conversational pipeline designed for clinical safety and empathetic patient support. Every message a patient sends through WhatsApp goes through the following stages before a response is delivered:

```
Patient (WhatsApp)
       │
       ▼
  [ Kapso.ai ]                 ← Webhook delivers message to Sami
       │
       ▼
[ Risk Pre-filter ]            ← Forbidden topics & keyword-based risk classification
       │                          before any LLM call is made
   ┌───┴──────────┐
   │              │
 HIGH           SAFE
 RISK           ↓
   │      [ RAG Retrieval ]    ← Patient clinical file + verified medical guidelines
   │      pgvector similarity     are fetched from PostgreSQL using semantic search
   │      search (top 5)
   │            │
   ▼            ▼
[ Immediate  [ Claude API ]    ← Augmented prompt: patient context + RAG chunks +
  Protocol ]   Sonnet 4.6        conversation history. Temperature: 0.2 (low hallucination)
  + Alert      max 500 tokens
               │
               ▼
       [ Response Guard ]      ← If Claude cannot ground its answer in the retrieved
                                  context, a safe fallback is returned instead
               │
               ▼
       [ Kapso.ai ]            ← Final response delivered to patient on WhatsApp
               │
               ▼
       [ PostgreSQL ]          ← Message, risk level and alerts persisted
```

### Anti-hallucination layers

Clinical accuracy is non-negotiable. Sami uses four stacked defenses to prevent the AI from generating unverified medical information:

**1. Forbidden topic filter** — Before any LLM call, a keyword filter intercepts questions about dosage changes, prognosis, or treatment suspension and returns a hardcoded safe response redirecting to the physician.

**2. RAG grounding** — Every prompt sent to Claude is augmented with the top 5 most semantically relevant chunks from the patient's verified clinical file and curated medical guidelines (WHO, MINSA). Claude is instructed to respond *only* from that context.

**3. Low temperature** — Claude is called with `temperature: 0.2`, minimizing creative generation and keeping responses factual and consistent.

**4. Safe fallback instruction** — The system prompt explicitly instructs Claude that if it cannot find the answer in the provided context, it must respond with a fixed phrase redirecting to the medical team — never invent an answer.

### Risk classification

Every incoming message is classified into one of three risk levels before the RAG and LLM pipeline runs:

| Level | Triggers | Automated action |
|-------|----------|-----------------|
| **Expected** | Normal interaction | Empathetic conversational support |
|  **Moderate** | Emotional distress, adherence barriers, persistent symptoms | Increased follow-up frequency, offer psychology appointment |
|  **High** | Self-harm language, perceived abuse, malpractice signals | Immediate containment response, emergency resources, clinic alert |

High-risk events bypass the LLM entirely — a hardcoded, clinically validated response is sent immediately and an alert is persisted for the clinic dashboard.

---

##  Stack

| Layer | Technology |
|-------|-----------|
| WhatsApp channel | Kapso.ai |
| Backend | Node.js + Express |
| AI model | Claude Sonnet 4.6 (Anthropic) |
| RAG embeddings | OpenAI text-embedding-3-small |
| Vector database | PostgreSQL + pgvector |
| Relational data | PostgreSQL (patients, messages, alerts, appointments) |
| Dashboard | Next.js (separate repo) |

##  Project structure

```
src/
├── index.js                  # Express entry point
├── webhooks/
│   └── kapso.js              # Kapso.ai incoming message handler
├── agents/
│   └── samiAgent.js          # Core agent — orchestrates RAG + Claude
├── services/
│   ├── kapso.js              # Send messages via Kapso API
│   ├── rag.js                # Embeddings + semantic search (pgvector)
│   └── riskClassifier.js     # 3-level risk classification + alert persistence
└── db/
    ├── pool.js               # PostgreSQL connection pool
    └── migrate.js            # Schema migrations
```

---

##  Environment variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `ANTHROPIC_API_KEY` | Claude API key (Anthropic) |
| `OPENAI_API_KEY` | OpenAI API key (for embeddings) |
| `KAPSO_API_KEY` | Kapso.ai API key |
| `KAPSO_WEBHOOK_SECRET` | Webhook signature secret |

---

##  License

MIT 
