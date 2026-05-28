# Agent Zero Runbook

Date: 2026-05-20

## Repo

https://github.com/agent0ai/agent-zero

Local checkout:

```text
.external/agent-zero
```

Inspected commit:

```text
6664fc7f Free runner disk before Docker publish
```

License: MIT.

## Setup Commands Found

Recommended install script:

```bash
curl -fsSL https://bash.agent-zero.ai | bash
```

Direct Docker command from README:

```bash
docker run -p 80:80 -v a0_usr:/a0/usr agent0ai/agent-zero
```

Direct Docker command from install docs:

```bash
docker run -p 0:80 -v /path/to/your/work_dir:/a0/usr agent0ai/agent-zero
```

Bundled Docker Compose file:

```yaml
services:
  agent-zero:
    container_name: agent-zero
    image: agent0ai/agent-zero:latest
    volumes:
      - ./agent-zero:/a0
    ports:
      - "50080:80"
```

## Required Environment

- Docker Desktop or Docker Engine.
- Docker socket access.
- LLM provider configuration through the Web UI onboarding.
- Optional A0 CLI Connector for host-machine file/shell/browser access.

For our sharing product, the optional host connector is a risk surface and should not be part of the friend-facing default.

Local prerequisite check:

```text
docker --version -> Docker version 29.5.1
docker compose version -> Docker Compose version 5.1.3
docker context -> colima
docker server -> Docker Engine 29.2.1, linux/arm64
colima status -> running, aarch64, 4 CPUs, 8GiB memory, 80GiB disk
node --version -> v25.6.1
python3 --version -> Python 3.9.6
/Applications/Docker.app -> not present
colima -> installed with Homebrew
```

## Ports and URLs

Default direct Docker mapping from docs:

```text
http://localhost:<mapped-port>
```

Example compose mapping:

```text
http://localhost:50080
```

## Static Architecture Notes

Top-level directories:

- `webui/`: browser UI, components, client API helpers, websocket helpers.
- `api/`: API handlers for messages, polling, settings, files, upload, projects, plugins, pause, terminate, and chat lifecycle.
- `plugins/_browser/`: Docker browser integration.
- `plugins/_desktop/`: Linux desktop and LibreOffice surface.
- `helpers/virtual_desktop.py`: virtual desktop registry and xpra session URL generation.
- `helpers/virtual_desktop_routes.py`: HTTP/WebSocket proxy for virtual desktop sessions.
- `docker/run/`: container image and compose files for runtime.

Important endpoints and files:

- `/api/message` accepts user messages and optional attachments.
- `/api/message_async` returns immediately after queueing a task.
- `/api/poll` builds UI snapshots for log and notification updates.
- `/api/pause` and `/api/api_terminate_chat` look relevant for stop/kill behavior.
- `/desktop/session/<token>/...` proxies xpra/html5 desktop sessions.
- `webui/js/api.js` wraps JSON API calls and CSRF handling.
- `webui/js/websocket.js` wraps Socket.IO-style event delivery.

## Observed Capabilities

- Web UI: yes, existing first-party UI.
- Desktop/browser visibility: yes. README and guides show Browser Canvas and Linux Desktop Canvas.
- Files: yes. API includes upload, file browser, workdir file editing, deletion, downloads, and project workspaces.
- Terminal/code execution: yes. README describes Linux system access, terminal, command execution, code writing, and tools.
- Task streaming: likely yes. README describes real-time streamed output; static code shows poll and websocket paths.
- Approval hooks: not obvious as a product-level policy layer. There are API and extension hooks that may be wrapped, but share-specific approval would need to be added.
- Isolation: yes by default through Docker container, but host access can be enabled through A0 CLI Connector. For our product, host connector must be disabled or heavily gated.

## Fit for Personal Agent Sharing

Agent Zero is a strong first demo candidate because it already has the hardest visible-runtime pieces:

- a full Linux environment
- Web UI
- live Canvas
- Docker browser
- Linux desktop through xpra/html5
- file and project surfaces
- plugins
- API surface for messages and chat lifecycle

The biggest mismatch is product shape. Agent Zero is built as an owner-operated agent workbench, not as a shared public friend link. We should avoid forking deeply at first and instead add a share gateway in front of one running instance/session.

## Initial Product Mapping

Friend-facing UI can map to Agent Zero like this:

| Product Need | Agent Zero Surface |
| --- | --- |
| Submit task | `/api/message` or `/api/message_async` |
| Stream progress | `/api/poll` and websocket events |
| Show desktop preview | `/desktop/session/<token>/...` xpra proxy |
| Stop task/session | pause/terminate APIs |
| Upload files | upload and workdir APIs |
| Owner settings | existing settings plus new share policy layer |

## Risks

- Current UI is owner/operator oriented, not friend-facing.
- Host connector can grant access to the owner's real machine; it must be excluded from the demo unless explicitly tested in a separate local-only mode.
- Existing file APIs include destructive operations; friend-facing gateway must block or wrap them.
- Existing plugin ecosystem may allow actions outside our intended permission model.
- Need to verify whether xpra desktop tokens can be exposed safely through a share session.
- Need to verify whether message streams can be filtered into a task-flow UI without tightly coupling to the existing Web UI.

## Runtime Test Status

Docker/Colima is now installed and running locally.

Agent Zero image pull is not complete. Attempted:

```bash
docker run -d --name agent-zero-share-prep -p 50080:80 -v a0_usr:/a0/usr agent0ai/agent-zero
docker pull agent0ai/agent-zero:latest
```

Both attempts reached Docker Hub layer download, cached about 3.3GB of partial image layers, then stopped making progress for several minutes with no completed image and no container created.

Current Docker state after aborting the stuck pull:

```text
docker images -> no completed agent-zero image
docker ps -a -> no agent-zero container
docker system df -> 3.312GB partial image cache
```

Expected next command after installing Docker:

```bash
docker run -p 50080:80 -v a0_usr:/a0/usr agent0ai/agent-zero
```

Expected URL:

```text
http://localhost:50080
```

## Next Run Task

Run the Docker image locally, configure the minimum model settings, open the Web UI, and test a representative research task.

If Docker Hub remains slow, try one of:

```bash
docker pull agent0ai/agent-zero:latest
docker pull --platform linux/amd64 agent0ai/agent-zero:latest
```

or run the same Docker command from a VPS with a faster Docker Hub route.
