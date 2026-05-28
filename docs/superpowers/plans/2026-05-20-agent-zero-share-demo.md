# Agent Zero Share Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first runnable demo where a friend opens a web link, submits a task, watches an Agent Zero desktop/runtime preview, and receives the final result.

**Architecture:** Keep Agent Zero as an upstream runtime and add a thin local share gateway in front of it. The gateway exposes only a small friend-safe API, forwards task submission to Agent Zero, proxies a read-only desktop/browser preview, and gives the owner a kill switch. Do not expose Agent Zero's full owner UI directly to friends.

**Tech Stack:** Agent Zero Docker image, Colima/Docker, Node.js/TypeScript for the gateway and friend UI, React or Next.js for the friend web page if a frontend scaffold is needed, Agent Zero HTTP APIs, Agent Zero xpra/html5 desktop proxy.

---

## Current Machine State

Docker prerequisites are installed and verified:

```text
Docker CLI: 29.5.1
Docker Compose: 5.1.3
Runtime: Colima
Colima profile: running, aarch64, 4 CPU, 8GiB memory, 80GiB disk
```

Remaining runtime blocker:

```text
agent0ai/agent-zero:latest image pull is incomplete.
Partial Docker cache: about 3.3GB.
No completed agent-zero image.
No agent-zero container.
```

## File Structure

These paths assume the demo gateway is created in this repository, not inside the upstream Agent Zero checkout.

- Create: `demo/agent-zero-share-gateway/package.json`
  - Node project metadata and scripts.

- Create: `demo/agent-zero-share-gateway/src/config.ts`
  - Reads runtime URL, share token, owner admin token, and feature flags.

- Create: `demo/agent-zero-share-gateway/src/agentZeroClient.ts`
  - Small adapter for Agent Zero APIs: submit task, poll state, stop task, resolve desktop URL.

- Create: `demo/agent-zero-share-gateway/src/policy.ts`
  - Allows only friend-safe operations and blocks owner-only API access.

- Create: `demo/agent-zero-share-gateway/src/server.ts`
  - HTTP server exposing public friend routes and owner-only admin routes.

- Create: `demo/agent-zero-share-gateway/src/public/index.html`
  - Friend-facing single-page UI: task input, task plan/status, expandable preview, result stream.

- Create: `demo/agent-zero-share-gateway/README.md`
  - How to run Agent Zero, start the gateway, and test the friend link.

- Create: `docs/superpowers/research/agent-zero-live-test.md`
  - Live runtime validation notes once Agent Zero starts successfully.

## Task 1: Finish Agent Zero Runtime Pull

**Files:**
- Modify: `docs/superpowers/research/agent-zero-runbook.md`
- Create: `docs/superpowers/research/agent-zero-live-test.md`

- [ ] **Step 1: Verify Docker is healthy**

Run:

```bash
docker version
docker compose version
colima status
```

Expected: Docker client/server respond and Colima is running.

- [ ] **Step 2: Retry Agent Zero image pull**

Run:

```bash
docker pull agent0ai/agent-zero:latest
```

Expected: image pull completes.

If it stalls again, try:

```bash
docker pull --platform linux/amd64 agent0ai/agent-zero:latest
```

Expected: either pull completes or the exact failure/stall condition is documented.

- [ ] **Step 3: Start Agent Zero**

Run:

```bash
docker rm -f agent-zero-share-prep 2>/dev/null || true
docker run -d --name agent-zero-share-prep -p 50080:80 -v a0_usr:/a0/usr agent0ai/agent-zero
```

Expected: container starts.

- [ ] **Step 4: Verify HTTP readiness**

Run:

```bash
curl -I http://localhost:50080
docker logs --tail 100 agent-zero-share-prep
```

Expected: HTTP route responds and logs show Web UI startup.

- [ ] **Step 5: Create live test notes**

Create `docs/superpowers/research/agent-zero-live-test.md`:

```markdown
# Agent Zero Live Test

Date: 2026-05-20

## Runtime

- URL: http://localhost:50080
- Container: agent-zero-share-prep
- Image: agent0ai/agent-zero:latest

## Startup Result

TBD

## Onboarding Requirements

TBD

## Web UI Notes

TBD

## API Notes

TBD

## Desktop/Browser Preview Notes

TBD
```

- [ ] **Step 6: Commit runtime readiness**

Run:

```bash
git add docs/superpowers/research/agent-zero-runbook.md docs/superpowers/research/agent-zero-live-test.md
git commit -m "Validate Agent Zero runtime startup"
```

Expected: commit succeeds.

## Task 2: Inspect Live Agent Zero API Surfaces

**Files:**
- Modify: `docs/superpowers/research/agent-zero-live-test.md`

- [ ] **Step 1: Open the Web UI**

Open:

```text
http://localhost:50080
```

Expected: Agent Zero UI loads.

- [ ] **Step 2: Complete minimum onboarding**

Use the UI to configure a model provider or account-backed provider.

Expected: a test chat can be created.

- [ ] **Step 3: Inspect browser network calls**

Identify the request and response shapes for:

- message submit
- async message submit
- poll/snapshot
- websocket events
- pause/terminate
- desktop/browser surface open

- [ ] **Step 4: Document API shapes**

Update `agent-zero-live-test.md` with:

```markdown
## API Shapes

### Submit Task

Endpoint: TBD
Method: TBD
Request: TBD
Response: TBD

### Poll Progress

Endpoint: TBD
Method: TBD
Request: TBD
Response: TBD

### Stop Task

Endpoint: TBD
Method: TBD
Request: TBD
Response: TBD

### Desktop Preview

Endpoint: TBD
Token model: TBD
```

- [ ] **Step 5: Commit API inspection**

Run:

```bash
git add docs/superpowers/research/agent-zero-live-test.md
git commit -m "Document Agent Zero live API surfaces"
```

Expected: commit succeeds.

## Task 3: Scaffold Share Gateway

**Files:**
- Create: `demo/agent-zero-share-gateway/package.json`
- Create: `demo/agent-zero-share-gateway/src/config.ts`
- Create: `demo/agent-zero-share-gateway/src/server.ts`
- Create: `demo/agent-zero-share-gateway/README.md`

- [ ] **Step 1: Create package metadata**

Create `demo/agent-zero-share-gateway/package.json`:

```json
{
  "name": "agent-zero-share-gateway",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx src/server.ts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@types/node": "^22.0.0",
    "tsx": "^4.20.0",
    "typescript": "^5.8.0"
  },
  "devDependencies": {}
}
```

- [ ] **Step 2: Create config module**

Create `src/config.ts` with environment reads for:

- `AGENT_ZERO_BASE_URL`, default `http://localhost:50080`
- `FRIEND_SHARE_TOKEN`, default local dev token
- `OWNER_ADMIN_TOKEN`, default local dev token
- `PORT`, default `5179`

- [ ] **Step 3: Create health-only server**

Create `src/server.ts` with routes:

- `GET /health`
- `GET /share/:token`
- `GET /owner`

Expected behavior:

- health returns JSON
- valid token serves placeholder friend UI
- invalid token returns 404
- owner route requires `?admin_token=...` for local demo

- [ ] **Step 4: Document startup**

Create README with:

```bash
cd demo/agent-zero-share-gateway
npm install
npm run dev
```

Expected URL:

```text
http://localhost:5179/share/local-friend
```

- [ ] **Step 5: Run typecheck**

Run:

```bash
cd demo/agent-zero-share-gateway
npm install
npm run typecheck
```

Expected: typecheck passes.

- [ ] **Step 6: Commit scaffold**

Run:

```bash
git add demo/agent-zero-share-gateway
git commit -m "Scaffold Agent Zero share gateway"
```

Expected: commit succeeds.

## Task 4: Implement Agent Zero Adapter

**Files:**
- Create: `demo/agent-zero-share-gateway/src/agentZeroClient.ts`
- Modify: `demo/agent-zero-share-gateway/src/server.ts`

- [ ] **Step 1: Add adapter functions**

Create functions:

- `submitTask(text: string): Promise<{ context: string; message: string }>`
- `pollProgress(context: string): Promise<unknown>`
- `stopTask(context: string): Promise<unknown>`
- `getDesktopPreviewUrl(): Promise<string | null>`

- [ ] **Step 2: Add gateway routes**

Add routes:

- `POST /api/share/:token/tasks`
- `GET /api/share/:token/tasks/:context/events`
- `POST /api/owner/kill`

- [ ] **Step 3: Run against live Agent Zero**

With Agent Zero running, submit:

```text
Use the Browser tool to compare Linear and Notion AI. Return a one-page summary.
```

Expected: task reaches Agent Zero, or adapter mismatch is documented.

- [ ] **Step 4: Commit adapter**

Run:

```bash
git add demo/agent-zero-share-gateway docs/superpowers/research/agent-zero-live-test.md
git commit -m "Add Agent Zero gateway adapter"
```

Expected: commit succeeds.

## Task 5: Build Friend-Facing UI

**Files:**
- Create: `demo/agent-zero-share-gateway/src/public/index.html`
- Modify: `demo/agent-zero-share-gateway/src/server.ts`

- [ ] **Step 1: Build task-flow UI**

The UI must show:

- task input
- submitted task
- current status
- result stream
- expandable preview panel
- no cost display

- [ ] **Step 2: Wire task submission**

Use `fetch` to call:

```text
POST /api/share/:token/tasks
```

Expected: task starts and context id is stored client-side.

- [ ] **Step 3: Wire progress polling**

Poll:

```text
GET /api/share/:token/tasks/:context/events
```

Expected: user sees progress or raw event fallback.

- [ ] **Step 4: Add preview area**

Use the desktop/browser preview URL discovered in Task 2.

Expected: preview is hidden by default and can expand.

- [ ] **Step 5: Verify no owner controls leak**

Open the friend link and confirm:

- no settings page
- no model key page
- no destructive file actions
- no owner token in HTML
- no cost display

- [ ] **Step 6: Commit friend UI**

Run:

```bash
git add demo/agent-zero-share-gateway
git commit -m "Build friend-facing Agent Zero share UI"
```

Expected: commit succeeds.

## Verification

Run:

```bash
docker ps --filter name=agent-zero-share-prep
curl -I http://localhost:50080
curl http://localhost:5179/health
curl -I http://localhost:5179/share/local-friend
git status --short
```

Expected:

- Agent Zero container is running.
- Agent Zero Web UI responds.
- Share gateway health responds.
- Friend share route responds.
- Git worktree is clean after commits.

## Stop Commands

Use these after testing:

```bash
docker rm -f agent-zero-share-prep
colima stop
```

