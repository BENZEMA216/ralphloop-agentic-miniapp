# Ralphloop Agentic Miniapp

This repository contains the current Ralphloop share-runtime prototype plus the latest architecture notes for building agentic miniapps on top of it.

For backend handoff, start with:

1. `docs/superpowers/specs/2026-05-28-agentic-miniapp-conversation-handoff.zh.md`
2. `docs/superpowers/specs/2026-05-28-agentic-miniapp-code-architecture.zh.md`
3. `docs/superpowers/specs/2026-05-28-agentic-miniapp-builder-mvp-io-contract.zh.md`

The code for the miniapp modules is not implemented yet. The important implementation target is described in the docs: add `apps/share-gateway/src/miniapp/` and `apps/share-web-react/src/miniapp/`, then wire them into the existing share runtime.

## Directory Guide

### `apps/share-gateway/`

Backend gateway for the current share runtime.

Important areas:

- `src/adapters/`
  - Provider adapter contract and current adapters for Codex, Claude, and OpenCode.
  - Reuse `ProviderAdapter`, `ProviderRegistry`, and `RuntimeEvent` for miniapp execution.

- `src/productization/`
  - Current productized share runtime.
  - Key files:
    - `routes.ts`: friend/owner API logic, including task submission.
    - `httpServer.ts`: HTTP routing and page serving.
    - `relayStore.ts`: JSON snapshot + JSONL journal store for hosts, share links, sessions, tasks, runtime events, approvals.
    - `hostCommands.ts`: outbound host command contract.
    - `hostClient.ts`: owner-host command polling and adapter execution.
    - `agUiEvents.ts`: maps runtime events into AG-UI style events.

- `test/`
  - Node test coverage for adapters, productized routes, relay store, approvals, security, host transport, and task flow.

Planned miniapp backend home:

```text
apps/share-gateway/src/miniapp/
  domain/
  store/
  extraction/
  skill/
  builder/
  runtime/
  eval/
  routes/
```

### `apps/share-web/`

Legacy/server-rendered share web implementation plus shared runtime helpers.

Important areas:

- `src/runtime/`
  - Shared client runtime logic used by the React v2 app.
  - `friendAgUiRuntimeStore.ts` and `assistantUiRuntimeBinding.ts` are important if miniapp runner UI keeps reusing the current assistant/thread model.

- `src/pages/`
  - Existing owner/share page renderers and classic assistant UI entry.

- `e2e/`
  - Browser-level tests and screenshot/pixel baseline harnesses.

### `apps/share-web-react/`

React `/v2` frontend shell.

Current files:

- `src/App.ts`
  - Hydrated assistant-ui style runtime shell.
  - Today it renders chat/session state. Miniapp runner UI should extend this initial state with a `miniapp` branch.

- `src/main.tsx`
  - Reads `window.__RALPHLOOP_STATE__` or `#ralphloop-state` and mounts React.

- `test/`
  - React build and hydration tests.

Planned miniapp frontend home:

```text
apps/share-web-react/src/miniapp/
  api/
  creator/
  runner/
  a2ui/
  state/
```

### `docs/superpowers/specs/`

Current design docs.

Read in this order:

1. `2026-05-28-agentic-miniapp-conversation-handoff.zh.md`
   - Cleaned-up discussion handoff for backend implementation.

2. `2026-05-28-agentic-miniapp-code-architecture.zh.md`
   - Main code architecture design.
   - Includes module dependency diagrams, creator publish flow, consumer run flow, stores, routes, run engine, artifact extraction, eval, and landing phases.

3. `2026-05-28-agentic-miniapp-builder-mvp-io-contract.zh.md`
   - Raw Input, Candidate Extraction, Skill Draft, UI Plan, Evaluation Report, Publish I/O.

4. `2026-05-28-agentic-miniapp-builder-requirements-architecture.zh.md`
   - Earlier requirements and architecture discussion.

5. `2026-05-28-agentic-app-manifest-a2ui-bridge-spec.zh.md`
   - Earlier manifest/A2UI bridge spec.
   - Treat this as historical background. Later discussion weakens the manifest as the central contract and favors `AgenticSkillSpec`.

Other folders:

- `docs/superpowers/plans/`: older implementation plans for share runtime phases.
- `docs/superpowers/research/`: earlier research notes.
- `docs/superpowers/validation/`: validation scenarios and test-case notes.

### `scripts/`

Project test/lint/check wrappers.

Common commands:

```bash
npm test
npm run lint
npm run typecheck
npm run build
npm run build:web-react
npm run test:web-react
npm run test:contract
npm run test:integration
npm run test:security
npm run test:e2e
```

The project uses Node.js with stripped TypeScript execution rather than a separate compiled backend build.

### `agora-demo/`

Ancillary demo folder. It is not part of the miniapp architecture path described in the current specs.

## Current Miniapp Architecture Summary

The recommended implementation model is:

```text
AgenticSkillSpec defines capability
MiniappBuildSpec compiles capability
MiniappStore saves product objects
PublishedMiniappRecord binds share link
MiniappRunEngine executes one consumer run
Existing share task flow sends runtimePrompt to owner host
RuntimeEventIngest syncs task events
ArtifactExtractor produces final user-facing output
React MiniappRunShell renders intake, thread, and artifact
```

MVP should not add a new host command or require owner host to understand miniapp packages. The gateway should compile `skill + intake` into a `runtimePrompt`, then reuse the existing `task.submit(adapterId, prompt)` path.

## Suggested First Backend Step

Start with backend core, before extraction UI:

```text
Miniapp domain types
MiniappStore
buildSpec fixture
promptCompiler
artifactExtractor
MiniappRunEngine mock runtime test
```

This proves that a miniapp can be stored, compiled, run, and produce an artifact before investing in creator UI or real cloud extraction.
