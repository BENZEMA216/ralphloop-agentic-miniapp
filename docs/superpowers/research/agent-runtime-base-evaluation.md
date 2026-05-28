# Agent Runtime Base Evaluation

Date: 2026-05-20

## Goal

Choose the fastest safe base for validating a personal desktop-agent sharing product.

## Candidates

| Candidate | Repo | Role | Initial Status |
| --- | --- | --- | --- |
| Agent Zero | https://github.com/agent0ai/agent-zero | Fast visible desktop-agent demo | Static inspection complete; Docker ready; image pull incomplete |
| Suna/Kortix | https://github.com/kortix-ai/suna | Product-shaped agent base | Static inspection complete; Docker ready; runtime not run |
| OpenHands | https://github.com/OpenHands/OpenHands | Runtime/sandbox reference | Static reference review complete |
| Vercel Open Agents | https://github.com/vercel-labs/open-agents | Cloud-agent architecture reference | Static reference review complete |

## Criteria

| Criterion | Agent Zero | Suna | OpenHands | Vercel Open Agents |
| --- | --- | --- | --- | --- |
| Web friend experience | Existing owner UI; friend UI needs wrapper | Strong React session UI; too company/account-heavy for friend MVP | Local GUI is developer/coding-agent oriented | Strong cloud-agent web/chat template but coding-agent oriented |
| Desktop/browser visibility | Strong: Browser Canvas and Linux Desktop via xpra/html5 | Strong: desktop iframe/noVNC, browser stream, terminal tabs | Strong runtime reference; docs mention Docker sandbox, VSCode/VNC/browser surfaces | Limited desktop fit; better for previews and sandbox ports |
| Runtime isolation | Strong default Docker isolation; host connector must be gated | Strong Docker sandbox, persistent workspace, proxy ports | Strong Docker sandbox default; process sandbox is unsafe | Strong Vercel sandbox separation and hibernation/resume |
| Task event stream | Likely usable via poll/websocket; needs runtime test | Strong: OpenCode SSE event stream and React Query updates | Mature API/GUI/SDK concepts; exact friend stream adapter would need inspection | Strong: durable workflows, streaming, cancellation, reconnect/resume |
| Approval/policy hook points | Needs share gateway; existing APIs are too broad for direct friend access | Strong references: questions, permissions, tunnel scopes, validators | Likely strong for coding tasks, but friend permission layer still custom | Good architecture reference for preferences and session sharing, but not desktop permissions |
| Setup complexity | Simple Docker path documented; Colima/Docker installed; image pull stalled after partial cache | High: Docker, pnpm, Supabase/env, API, web, core services | Docker required; mature docs; coding-agent setup | Medium/high: Bun, Postgres, Vercel OAuth, GitHub App, Vercel sandbox |
| Product fit | Best fast demo candidate so far | Best architecture reference, poor direct fork candidate because of license | Best mature runtime/sandbox reference, not first demo base | Best cloud architecture reference, not desktop-agent base |

## Notes

- Keep first-pass evaluation practical: can we run it, inspect it, and modify it quickly?
- Do not optimize for perfect architecture before validating friend usage.

## Decision

Use Agent Zero as the first validation demo base.

Use Suna/Kortix, OpenHands, and Vercel Open Agents as architecture references. Do not use Suna/Kortix as the direct commercial base without legal review because of Elastic License 2.0 hosted-service restrictions.

## Agent Zero Static Notes

- MIT license.
- README describes "AI agents with a full Linux system at their fingertips."
- Direct run command exists: `docker run -p 80:80 -v a0_usr:/a0/usr agent0ai/agent-zero`.
- Web UI includes Canvas surfaces.
- Browser surface can show the Docker browser and supports screenshots, annotations, page reading, clicks, typing, uploads, and Chrome extensions.
- Desktop surface starts an XFCE Linux desktop in Canvas using xpra/html5 proxying through `/desktop/session/<token>/...`.
- API handlers include message submission, async message submission, polling, pause, terminate, upload, file operations, settings, projects, and plugins.
- Main concern: it is an owner workbench, so direct public exposure is unsafe without a gateway that narrows APIs and filters desktop/session access.
- Local Docker/Colima is now available. Runtime test is blocked only by incomplete `agent0ai/agent-zero:latest` image pull from Docker Hub.

## Suna/Kortix Static Notes

- Elastic License 2.0. This is a direct commercial/product risk for using it as a hosted managed-service base.
- Monorepo includes `apps/web`, `apps/api`, `apps/desktop`, `apps/mobile`, `core`, `packages/db`, and `packages/agent-tunnel`.
- Web app is a modern React/Next.js product with session chat, terminal, browser, desktop, file tabs, and task surfaces.
- Runtime uses OpenCode inside a Docker sandbox.
- Core sandbox exposes noVNC desktop on port `6080`, browser stream, browser viewer, SSH, static web server, and preview services.
- API already has sandbox share endpoints at `/v1/p/share`.
- Permission design is useful: tunnel permissions validate filesystem, shell, network, and desktop scopes.
- Product scope is too broad for MVP: accounts, teams, billing, Supabase, integrations, deployments, mobile, desktop shell, and company OS concepts.
- Docker is now available locally, but Suna runtime was not run because it is no longer the direct demo base and still requires additional Supabase/env setup.

## OpenHands Static Notes

- README says the core repository is MIT except the `enterprise/` directory.
- Local GUI provides REST API and a single-page React app.
- Current docs describe sandbox providers: Docker sandbox, process sandbox, and remote sandbox.
- Docker sandbox is the relevant model for us because it isolates code execution from the host.
- OpenHands is strongest as a runtime/sandbox and coding-agent reference.
- It is not the fastest base for the friend-sharing MVP because the UI and task loop are developer/coding-agent oriented, and friend-facing desktop sharing would still need custom product work.

## Vercel Open Agents Static Notes

- MIT licensed.
- Explicitly describes a three-layer architecture: `Web -> Agent workflow -> Sandbox VM`.
- Key design choice: the agent does not run inside the sandbox; it runs as a durable workflow and talks to the sandbox through tools.
- Current capabilities include durable multi-step execution, streaming, cancellation, isolated Vercel sandboxes, snapshot resume, repo cloning, auto-commit/PR, and read-only session sharing.
- Best reference for our long-term share gateway, session model, workflow persistence, and cloud sandbox lifecycle.
- Less useful for the immediate "desktop agent with expandable remote desktop" demo because it is coding-agent and Vercel-sandbox focused.
