# Suna/Kortix Runbook

Date: 2026-05-20

## Repo

https://github.com/kortix-ai/suna

Local checkout:

```text
.external/suna
```

Inspected commit:

```text
c1aa27084 Stabilize OpenCode sandbox runtime
```

License: Elastic License 2.0.

Important licensing note: Elastic License 2.0 restricts providing the software to third parties as a hosted or managed service when that service provides access to a substantial set of the software's features. This makes Suna/Kortix a poor direct fork base for a commercial hosted sharing product. It remains useful as an architecture reference.

## Setup Commands Found

Installer:

```bash
curl -fsSL https://kortix.com/install | bash
```

Local development:

```bash
pnpm dev
pnpm dev:web
pnpm dev:api
pnpm dev:core
pnpm dev:core:build
```

Environment generation:

```bash
./scripts/setup-env.sh
```

Core sandbox:

```bash
docker compose -f core/docker/docker-compose.yml -f core/docker/docker-compose.dev.yml up
```

## Required Environment

- Docker runtime.
- pnpm 8.15.8.
- Supabase configuration.
- Backend API env values.
- Local or cloud sandbox provider.
- Optional Pipedream and other integration keys.

Local prerequisite status in this workspace:

```text
docker --version -> Docker version 29.5.1
docker compose version -> Docker Compose version 5.1.3
docker context -> colima
docker server -> Docker Engine 29.2.1, linux/arm64
colima status -> running, aarch64, 4 CPUs, 8GiB memory, 80GiB disk
node --version -> v25.6.1
python3 --version -> Python 3.9.6
```

Runtime test is no longer blocked by missing Docker, but Suna still has a heavier setup path requiring pnpm install, Supabase/database configuration, API env values, and core sandbox startup.

## Ports and URLs

Web app:

```text
http://localhost:3000
```

API:

```text
http://localhost:8008/v1
```

Core sandbox ports from `core/docker/docker-compose.yml`:

```text
127.0.0.1:14000 -> Kortix Master proxy
127.0.0.1:14002 -> Desktop noVNC
127.0.0.1:14003 -> Desktop HTTPS
127.0.0.1:14004 -> Presentation viewer
127.0.0.1:14005 -> Agent browser stream WebSocket
127.0.0.1:14006 -> Agent browser viewer
127.0.0.1:14007 -> SSH
127.0.0.1:14008 -> Static web server
```

## Static Architecture Notes

Top-level shape:

- `apps/web/`: Next.js web frontend.
- `apps/api/`: Hono/TypeScript backend API.
- `apps/desktop/`: Tauri wrapper around the web app.
- `apps/mobile/`: mobile app.
- `core/`: sandbox runtime, OpenCode runtime, Docker images, services.
- `packages/agent-tunnel/`: tunnel package.
- `packages/db/`: database package.
- `scripts/`: install/start/env scripts.
- `supabase/`: migrations and local Supabase assets.

The runtime is based on OpenCode and a full Linux sandbox. The core Docker compose explicitly exposes a noVNC desktop on port `6080`, an agent browser stream, SSH, and preview services.

## Observed Capabilities

- Web UI: yes, modern Next.js app with session/chat layout.
- Desktop/browser visibility: yes. `DesktopTabContent` embeds the sandbox desktop stream via iframe, using port `6080`.
- Files: yes. It has file renderers, code editor, markdown editor, file tabs, upload paths, and sandbox file APIs.
- Terminal: yes. It has a `pty-terminal` component and terminal tab content.
- Task streaming: yes. Frontend consumes OpenCode SSE events and updates React Query incrementally.
- Approval hooks: yes. There are question prompts, OpenCode permission handling, tunnel permission requests, scope editors, and API-side scope validation.
- Isolation: yes. Sandbox uses Docker, persistent workspace volumes, and explicit public/preview proxy routes.
- Share primitives: yes. API includes `/v1/p/share` routes to create, list, and revoke public sandbox share links.

## Fit for Personal Agent Sharing

Suna/Kortix is architecturally closer to the long-term product than Agent Zero:

- strong web app structure
- sandbox lifecycle concepts
- desktop iframe already in React
- OpenCode event stream
- permission requests and scoped permission validators
- share endpoints
- tunnel permission UI
- local/cloud provider abstraction

But it is not a good direct product base because:

- Elastic License 2.0 is restrictive for hosted managed-service usage.
- It is explicitly designed as a company operating system, not personal friend sharing.
- It depends on Supabase, accounts, billing, integrations, sandbox providers, and many product surfaces we do not need for MVP.
- Setup is materially more complex than Agent Zero.

Best use: architecture reference and component/pattern reference, not direct fork.

## Initial Product Mapping

| Product Need | Suna/Kortix Surface |
| --- | --- |
| Friend chat/task UI | `apps/web/src/components/session/session-chat.tsx` and `session-layout.tsx` |
| Expandable desktop | `apps/web/src/components/tabs/desktop-tab-content.tsx` |
| Task events | `apps/web/src/hooks/opencode/use-opencode-events.ts` |
| Human questions | `QuestionPrompt` and OpenCode pending question store |
| Permission approvals | tunnel permission request dialog and scope validators |
| Public share link | `apps/api/src/sandbox-proxy/routes/share.ts` |
| Runtime sandbox | `core/docker/docker-compose.yml` |

## Risks

- License blocks using it as-is for the product direction without legal review and likely permission.
- Broad company/team feature set would slow down a personal MVP.
- Local dev requires Docker, Supabase/env setup, pnpm, and multiple services.
- Existing share endpoint appears oriented around exposing sandbox service ports, not specifically a safe friend-agent session.
- Permission system is promising but tied to the platform's tunnel/account/database model.

## Runtime Test Status

Not run yet. Docker is available now, but Suna remains lower priority because Agent Zero is the selected demo base and Suna is not a direct commercial fork candidate.

If Docker is installed later, the first setup path to try is:

```bash
cd .external/suna
pnpm install
./scripts/setup-env.sh
pnpm dev
```

But this likely also requires a valid Supabase/database configuration, so Agent Zero remains the faster local runnable candidate.
