# tasks.md

# Alice Calling Bridge — Implementation Tasks

_Last updated: 2026-03-08 (UTC)_

> Note: Integration tests and automated test requirements are deferred for now. Use manual verification steps only.

## Locked Decisions
- Repo: no git init for now
- Structure: `apps/api`, `apps/web`, `packages/shared`
- Auth: none for now (MVP)
- Tenancy: single workspace/account first
- Scope: outbound calls only (MVP)
- Initial markets: UK and USA
- Accounts: Vapi + Twilio already available
- Build priority: API first, dashboard later
- No Docker usage (local/native tooling + managed services only)

## Phase 1 — Repo + Boilerplate

### Task 1.1 Initialize npm workspace
**Done when:** `npm run dev` starts API locally.

### Task 1.2 Set up TypeScript, ESLint, Prettier
**Done when:** `npm run lint` passes.

### Task 1.3 Add Express app with `/health`
**Done when:** `GET /health` returns 200.

---

## Phase 2 — Database + Prisma

### Task 2.1 Add Prisma + Postgres connection
**Done when:** `prisma migrate dev` succeeds.

### Task 2.2 Create MVP schema tables
**Done when:** tables exist and seed script inserts sample call.

### Task 2.3 Add Prisma client module
**Done when:** API can manually create and fetch one `calls` record via a temporary route/script.

---

## Phase 3 — Call Start API

### Task 3.1 Build `POST /v1/calls/start` with validation
**Done when:** invalid number returns 400, valid returns `callId`.

### Task 3.2 Integrate Vapi outbound call request
**Done when:** real test call is initiated successfully.

### Task 3.3 Persist initial call record
**Done when:** DB row created per request with `queued`/`initiated` status.

---

## Phase 4 — Webhook Ingestion

### Task 4.1 Implement `POST /v1/webhooks/vapi`
**Done when:** signed webhook accepted, unsigned rejected.

### Task 4.2 Idempotency for duplicate events
**Done when:** repeated same event doesn’t duplicate state transitions.

### Task 4.3 Status transition logic
**Done when:** `queued -> in_progress -> completed/failed` works during manual webhook replay.

---

## Phase 5 — Qualification Outcome Extraction

### Task 5.1 Parse transcript/events into structured lead outcome
**Done when:** intent/location/budget/timeline fields saved.

### Task 5.2 Outcome classification rule
**Done when:** call labeled one of:
- `qualified_booked`
- `qualified_not_booked`
- `unqualified`
- `no_answer`
- `do_not_call`

---

## Phase 6 — Safety & Controls

### Task 6.1 Blocked-number check before calling
**Done when:** blocked number returns 403 and no outbound attempt.

### Task 6.2 Rate limit `/calls/start`
**Done when:** >N requests/min per key returns 429.

### Task 6.3 Request audit logging
**Done when:** each API call gets `requestId` traceable in logs.

---

## Phase 7 — OpenClaw Integration

### Task 7.1 Define command mapping
- “call [number] [context]” -> `POST /v1/calls/start`

**Done when:** one natural-language command triggers real call.

### Task 7.2 Add call status retrieval flow
**Done when:** “what happened on last call?” returns summary from `/calls/:id`.

---

## Phase 8 — Deploy + Manual Validation (Railway)

### Task 8.1 Configure Railway service + env vars
**Done when:** production `/health` is up.

### Task 8.2 Register production webhook URL in Vapi
**Done when:** live events appear in DB.

### Task 8.3 End-to-end smoke test (3 scenarios)
1. Answered + qualified + booked
2. No answer
3. Do-not-call request

**Done when:** all 3 produce correct final outcomes.

---

## Immediate Next 5 Tasks
1. Create repo + npm workspace
2. Scaffold Express API + `/health`
3. Add Prisma schema + migrate
4. Implement `/v1/calls/start`
5. Wire Vapi webhook endpoint
