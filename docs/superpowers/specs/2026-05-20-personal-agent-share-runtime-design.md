# Personal Agent Share Runtime Design

Date: 2026-05-20

## Summary

We want to let an individual share their desktop agent with a friend through a web link. The friend should feel like they are using the full agent, not a restricted chatbot, while the owner keeps control over cost, access, and risk.

The first product should not start from a blank frontend/runtime. We should fork or reuse an existing open-source agent runtime and add the differentiating layer: share links, friend-facing task UI, owner controls, desktop preview, and high-risk action approval.

## Product Thesis

The product is not "share a prompt." It is a safe remote runtime for using someone else's configured desktop agent.

The core loop:

1. The owner chooses an agent/runtime and creates a share link.
2. The owner sets budget, expiry, and permission rules.
3. A friend opens the link without setup.
4. The friend gives tasks in a web interface.
5. The agent runs inside an isolated desktop runtime.
6. The friend sees task progress, a live desktop preview, and final output.
7. High-risk actions are blocked or routed to owner approval.

## Target User

The first user is an individual who already has a useful desktop agent and wants to let a trusted friend use it.

The first friend experience should be link-first and low-friction:

- no API key setup
- no model configuration
- no runtime installation
- no cost display
- no required account for the very first trial

## Experience Direction

We chose "task flow + expandable desktop" as the main interaction model.

The friend-facing UI should default to:

- task input
- agent plan
- current step
- live status
- expandable remote desktop preview
- intermediate results
- final output
- approval prompts only when needed

The friend should not see token cost, dollar cost, or budget progress during normal use. Cost is an owner control surface.

The owner-facing UI should show:

- share link
- total budget
- per-task budget
- expiry
- active sessions
- pause/revoke link
- approval queue
- usage history
- audit log

## MVP Scope

### In Scope

- Create a share link for one desktop agent.
- Let a friend open the link and start a task.
- Run the task in a remote desktop/sandbox runtime.
- Stream agent messages, task steps, screenshots, and final result.
- Let the friend expand the desktop preview.
- Hide cost from the friend.
- Enforce owner-side budget and task limits.
- Block or require approval for high-risk actions.
- Let the owner pause or revoke the link.

### Out of Scope

- Public marketplace.
- Team/workspace sharing.
- Billing for arbitrary creators.
- Multi-agent collaboration.
- Unrestricted access to the owner's personal Mac.
- Giving friends direct control over the owner's private accounts.
- Supporting every agent framework on day one.

## Reference Projects

### Primary Candidates

1. Agent Zero: https://github.com/agent0ai/agent-zero

   Best for a fast demo of "desktop agent through the web." It already has a Web UI, Docker runtime, Linux desktop, browser, files, plugins, and a canvas-like experience.

2. Suna/Kortix: https://github.com/kortix-ai/suna

   Best for a more product-shaped base. It has a Next.js app, agent runtime, sandbox environment, integrations, and persistence. It is closer to a full product but may carry company/team complexity we do not need.

3. OpenHands: https://github.com/OpenHands/OpenHands

   Best runtime reference. It has a mature sandbox model, REST API, React local GUI, browser/terminal/files, and strong developer-agent behavior. It is more coding-agent oriented than friend-facing.

4. Vercel Open Agents: https://github.com/vercel-labs/open-agents

   Best cloud-agent architecture reference. Useful for understanding session sharing, sandbox orchestration, streaming, cancellation, and web-to-runtime flow.

### Component References

- assistant-ui: https://github.com/assistant-ui/assistant-ui
  Use for chat UI, streaming, attachments, tool-call rendering, and approval prompts.

- CopilotKit: https://github.com/CopilotKit/CopilotKit
  Use for agent-native React UI, shared state, generative UI, and human-in-the-loop flows.

- AG-UI: https://github.com/ag-ui-protocol/ag-ui
  Use as a reference protocol for runtime-to-frontend event streaming.

- noVNC: https://github.com/novnc/noVNC
  Use for remote desktop preview.

- xterm.js: https://github.com/xtermjs/xterm.js
  Use for terminal/log display if needed.

- browser-use/web-ui: https://github.com/browser-use/web-ui
  Use as a browser-agent UI reference, not as the main runtime.

## Recommended Build Path

### Phase 1: Validation Demo

Fork and run Agent Zero or Suna locally. The goal is not polish. The goal is to prove:

- a friend can open a web URL
- submit a task
- watch progress
- optionally expand the desktop
- receive a complete result

Recommendation: start with Agent Zero if the priority is speed and visible desktop-agent behavior. Start with Suna if the priority is product structure and longer-term extensibility.

My recommendation is to start with Agent Zero for a 1-2 week validation demo, then compare with Suna before committing to a production base.

### Phase 2: Share Layer

Add a thin share gateway around the chosen runtime:

- share token
- owner policy
- session creation
- task submission
- runtime event stream
- owner revocation
- approval requests
- audit log

This layer should be independent from the chosen runtime as much as possible.

### Phase 3: Product UI

Build the friend UI around task flow, not raw remote control:

- left panel: conversation, plan, steps, results
- right panel: desktop preview
- expanded mode: larger desktop view
- approval modal: explain blocked/risky action
- unavailable state: expired/revoked/budget exhausted

## Architecture

The target architecture has five units:

1. Friend Web App

   The public link experience. It renders conversation, plan, status, desktop preview, approval prompts, and final results.

2. Owner Console

   The private control surface. It manages share links, budgets, permissions, active sessions, revocation, and approvals.

3. Share Gateway

   The policy and session boundary. It validates links, creates sessions, applies budgets, routes messages, filters events, and enforces approval gates.

4. Agent Runtime Adapter

   A wrapper around Agent Zero, Suna, OpenHands, or another runtime. It normalizes task submission, streaming events, screenshots, files, terminal logs, and cancellation.

5. Sandbox Runtime

   The actual desktop environment where the agent runs. It should be isolated from the owner's real computer by default.

## Permission Model

The friend gets access to an agent session, not the owner's machine.

Default allowed actions:

- chat with the agent
- ask it to browse public websites
- upload files for that session
- generate reports, summaries, plans, and code snippets
- inspect the live desktop preview

Default blocked or approval-required actions:

- send email or messages
- spend money
- sign in to personal accounts
- modify or delete persistent files
- download sensitive files
- access owner credentials
- run destructive shell commands
- bypass budget or policy limits

## Cost Model

The owner pays in the first version.

Friend-facing UI hides cost during normal operation. The friend may only see neutral states such as:

- "This shared agent is temporarily unavailable."
- "This task needs owner approval."
- "This link has expired."

Owner-facing controls include:

- total link budget
- per-task max
- max concurrent sessions
- expiry
- manual pause
- hard kill switch

## Security Principles

- Never run shared sessions directly on the owner's personal machine in the product version.
- Use isolated cloud desktop or containerized desktop runtimes.
- Treat all websites, documents, and friend prompts as untrusted input.
- Do not rely on system prompts for safety boundaries.
- Enforce policy in the share gateway and runtime adapter.
- Log high-risk actions and approval decisions.
- Provide owner revocation and session kill at all times.

## Open Questions

1. Should the first demo use Agent Zero or Suna as the base?
2. Should the first friend link be anonymous, password-protected, or magic-link based?
3. Should the owner approval flow happen inside the owner console, email, or mobile notification?
4. How much of the desktop should be visible by default: screenshot stream, VNC view, or event timeline?
5. What is the first "wow" task we will use to test with a real friend?

## Success Criteria

The first demo succeeds if:

- the owner can create one share link
- a friend can open it in a browser
- the friend can run a real task without setup
- the agent performs visible work in a sandbox desktop
- the friend receives a useful complete output
- the owner can stop the link
- risky actions do not execute silently

