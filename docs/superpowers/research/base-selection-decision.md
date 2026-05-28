# Base Selection Decision

Date: 2026-05-20

## Decision

Use Agent Zero as the first validation demo base.

Use Suna/Kortix, OpenHands, and Vercel Open Agents as architecture references, not direct product bases.

## Why

Agent Zero is the fastest path to proving the core user experience:

```text
friend opens link -> submits task -> agent works in visible desktop/runtime -> friend receives complete output
```

It already includes the pieces that are hardest to build from scratch:

- Web UI
- full Linux runtime
- Docker isolation
- browser surface
- Linux desktop surface
- xpra/html5 desktop proxy
- file/project surfaces
- message APIs
- real-time visible work model

Suna/Kortix is more product-shaped, but it is not the right direct base because:

- it uses Elastic License 2.0, which restricts hosted/managed service usage
- it is company/team oriented
- setup is more complex
- it carries large surfaces we do not need for a personal friend-sharing MVP

OpenHands is a mature runtime/sandbox reference but is too coding-agent oriented for the first friend-facing demo.

Vercel Open Agents is the best reference for long-term cloud agent architecture and session sharing, but it does not solve the immediate desktop-agent demo.

## What We Will Reuse

From Agent Zero:

- Dockerized runtime model
- Browser Canvas concept
- Desktop Canvas concept
- xpra/html5 desktop session proxy
- message submission APIs
- poll/websocket event ideas
- pause/terminate APIs
- file upload/workdir concepts

From Suna/Kortix:

- React session layout patterns
- desktop iframe pattern
- OpenCode event stream patterns
- permission request UI
- scoped tunnel permission validators
- share endpoint ideas

From OpenHands:

- Docker sandbox safety model
- separation between user-facing GUI/API and sandbox execution
- mature coding-agent runtime references

From Vercel Open Agents:

- `Web -> Agent workflow -> Sandbox VM` architecture
- durable workflow model
- stream reconnect/resume
- cancellation
- read-only session sharing concepts
- sandbox lifecycle separation

## What We Will Replace

Agent Zero's current owner-facing UI should not be exposed directly to friends.

We should add a new thin sharing layer:

- public share link route
- friend task UI
- share session token
- owner policy
- budget limits
- API allowlist
- desktop preview proxy
- high-risk action gate
- owner kill switch

The first demo can wrap one Agent Zero instance rather than deeply fork the whole app.

## Demo Plan

The first runnable demo should do this:

1. Start Agent Zero locally or on a VPS.
2. Create a share gateway in front of it.
3. Add one public friend URL.
4. Let the friend submit a task.
5. Forward the task to Agent Zero.
6. Stream readable progress back to the friend UI.
7. Show an expandable desktop/browser preview.
8. Let the owner revoke or kill the session.

Friend-facing UI should hide cost. Owner-facing control should show cost/limits.

## Current Blocker

Local container runtime setup is complete:

```text
Docker CLI: 29.5.1
Docker Compose: 5.1.3
Runtime: Colima
Colima profile: running, aarch64, 4 CPU, 8GiB memory, 80GiB disk
```

The remaining blocker is Agent Zero image retrieval. `agent0ai/agent-zero:latest` started pulling from Docker Hub, cached about 3.3GB of partial layers, then stopped making progress for several minutes. No completed image or container exists yet.

Next retry:

```bash
docker pull agent0ai/agent-zero:latest
docker run -d --name agent-zero-share-prep -p 50080:80 -v a0_usr:/a0/usr agent0ai/agent-zero
```

If the Docker Hub path remains slow, retry from a VPS or test `--platform linux/amd64`.

## Risks

- Agent Zero APIs are broad; direct public exposure would be unsafe.
- We need a gateway that only exposes the small friend-session API.
- Desktop session tokens must be treated as privileged.
- Host-machine connector features must be disabled in the friend-facing demo.
- We need to verify whether the event stream can be cleanly transformed into task steps.
- We need to verify Docker runtime performance and first-run model setup.

## Next Implementation Plan

Write a focused product demo plan for Agent Zero:

- clone or fork Agent Zero as the base runtime
- start the runtime through Docker
- build a separate friend web app or gateway
- implement a public share link
- allow one safe task submission path
- proxy a read-only desktop preview
- add owner kill switch

The next plan should not modify Agent Zero deeply until the runtime is actually running.
