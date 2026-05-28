# Agent Runtime Base Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Validate which open-source agent runtime is the best base for a personal "share my desktop agent with a friend" product.

**Architecture:** This is a validation plan, not production implementation. External repositories are cloned into ignored local directories, run as-is first, then evaluated against the product requirements from the spec. The output is a written base-selection decision plus a runnable demo path.

**Tech Stack:** Git, Docker, Docker Compose, Node.js/Next.js if required by the candidate repo, Python if required by the candidate repo, Agent Zero, Suna/Kortix, optional OpenHands reference review.

---

## File Structure

- Modify: `.gitignore`
  - Add ignored directories for external candidate checkouts, logs, and local environment files.

- Create: `docs/superpowers/research/agent-runtime-base-evaluation.md`
  - Decision log comparing Agent Zero, Suna/Kortix, OpenHands, and Vercel Open Agents.

- Create: `docs/superpowers/research/agent-zero-runbook.md`
  - Exact local setup notes, commands, ports, required env vars, and issues from running Agent Zero.

- Create: `docs/superpowers/research/suna-runbook.md`
  - Exact local setup notes, commands, ports, required env vars, and issues from running Suna/Kortix.

- Create: `docs/superpowers/research/base-selection-decision.md`
  - Final recommendation for the first demo base and why.

- External, ignored: `.external/agent-zero/`
  - Local clone of `https://github.com/agent0ai/agent-zero`.

- External, ignored: `.external/suna/`
  - Local clone of `https://github.com/kortix-ai/suna`.

## Evaluation Criteria

Each candidate must be evaluated against these requirements:

- Friend can use it from a web page.
- Runtime can execute real agent tasks.
- Runtime supports visible desktop/browser progress.
- Runtime can be isolated from the owner's personal machine.
- Frontend can be modified into task flow + expandable desktop.
- Task events can be streamed to our own frontend.
- High-risk actions can be intercepted or wrapped.
- Setup complexity is reasonable for a 1-2 week demo.
- License and project health are acceptable.

## Task 1: Prepare Evaluation Workspace

**Files:**
- Modify: `.gitignore`
- Create: `docs/superpowers/research/agent-runtime-base-evaluation.md`

- [ ] **Step 1: Update ignored local directories**

Add these entries to `.gitignore`:

```gitignore
.external/
.env
.env.*
*.log
logs/
```

- [ ] **Step 2: Create the evaluation matrix document**

Create `docs/superpowers/research/agent-runtime-base-evaluation.md` with:

```markdown
# Agent Runtime Base Evaluation

Date: 2026-05-20

## Goal

Choose the fastest safe base for validating a personal desktop-agent sharing product.

## Candidates

| Candidate | Repo | Role | Initial Status |
| --- | --- | --- | --- |
| Agent Zero | https://github.com/agent0ai/agent-zero | Fast visible desktop-agent demo | Pending |
| Suna/Kortix | https://github.com/kortix-ai/suna | Product-shaped agent base | Pending |
| OpenHands | https://github.com/OpenHands/OpenHands | Runtime/sandbox reference | Pending |
| Vercel Open Agents | https://github.com/vercel-labs/open-agents | Cloud-agent architecture reference | Pending |

## Criteria

| Criterion | Agent Zero | Suna | OpenHands | Vercel Open Agents |
| --- | --- | --- | --- | --- |
| Web friend experience | TBD | TBD | TBD | TBD |
| Desktop/browser visibility | TBD | TBD | TBD | TBD |
| Runtime isolation | TBD | TBD | TBD | TBD |
| Task event stream | TBD | TBD | TBD | TBD |
| Approval/policy hook points | TBD | TBD | TBD | TBD |
| Setup complexity | TBD | TBD | TBD | TBD |
| Product fit | TBD | TBD | TBD | TBD |

## Notes

- Keep first-pass evaluation practical: can we run it, inspect it, and modify it quickly?
- Do not optimize for perfect architecture before validating friend usage.
```

- [ ] **Step 3: Verify workspace state**

Run:

```bash
git status --short
```

Expected: only `.gitignore`, the plan file, and the new research file are changed.

- [ ] **Step 4: Commit workspace preparation**

Run:

```bash
git add .gitignore docs/superpowers/plans/2026-05-20-agent-runtime-base-validation.md docs/superpowers/research/agent-runtime-base-evaluation.md
git commit -m "Prepare agent runtime base evaluation"
```

Expected: commit succeeds.

## Task 2: Clone and Inspect Agent Zero

**Files:**
- External: `.external/agent-zero/`
- Create: `docs/superpowers/research/agent-zero-runbook.md`
- Modify: `docs/superpowers/research/agent-runtime-base-evaluation.md`

- [ ] **Step 1: Clone Agent Zero**

Run:

```bash
mkdir -p .external
git clone https://github.com/agent0ai/agent-zero .external/agent-zero
```

Expected: `.external/agent-zero` exists and is ignored by git.

- [ ] **Step 2: Read setup docs**

Run:

```bash
rg --files .external/agent-zero | rg '(^|/)(README|readme|INSTALL|install|docker|compose|env|setup)'
```

Expected: identify the main README, Docker docs, and env examples.

- [ ] **Step 3: Create Agent Zero runbook**

Create `docs/superpowers/research/agent-zero-runbook.md`:

```markdown
# Agent Zero Runbook

Date: 2026-05-20

## Repo

https://github.com/agent0ai/agent-zero

## Setup Commands Tried

TBD

## Required Environment

TBD

## Ports and URLs

TBD

## Observed Capabilities

- Web UI: TBD
- Desktop/browser visibility: TBD
- Files: TBD
- Terminal: TBD
- Task streaming: TBD
- Approval hooks: TBD

## Issues

TBD

## Fit for Personal Agent Sharing

TBD
```

- [ ] **Step 4: Record static inspection**

Update the runbook with:

- install command
- start command
- expected URL
- runtime model
- Docker requirements
- where frontend code lives
- where runtime/tool code lives

- [ ] **Step 5: Commit Agent Zero inspection**

Run:

```bash
git add docs/superpowers/research/agent-zero-runbook.md docs/superpowers/research/agent-runtime-base-evaluation.md
git commit -m "Inspect Agent Zero as runtime candidate"
```

Expected: commit succeeds.

## Task 3: Run Agent Zero Locally

**Files:**
- Modify: `docs/superpowers/research/agent-zero-runbook.md`
- Modify: `docs/superpowers/research/agent-runtime-base-evaluation.md`

- [ ] **Step 1: Check local prerequisites**

Run:

```bash
docker --version
docker compose version
node --version || true
python3 --version || true
```

Expected: Docker and Docker Compose are available, or missing prerequisites are documented.

- [ ] **Step 2: Configure minimal env**

Follow the Agent Zero docs and create local env files inside `.external/agent-zero` only.

Expected: no secrets or env files are tracked by git.

- [ ] **Step 3: Start Agent Zero**

Run the documented start command from inside `.external/agent-zero`.

Expected: local web UI starts, or startup failure is documented with exact error.

- [ ] **Step 4: Open the local UI**

Use the browser to open the Agent Zero local URL.

Expected: UI loads far enough to identify whether it can support friend-facing sharing.

- [ ] **Step 5: Run one representative task**

Task:

```text
Research the difference between Linear and Notion AI and produce a one-page summary.
```

Expected: agent can execute visible browser/desktop work or the exact limitation is documented.

- [ ] **Step 6: Document results**

Update `agent-zero-runbook.md` with:

- commands that worked
- commands that failed
- screenshots or URL notes if available
- capability assessment
- blockers

- [ ] **Step 7: Update evaluation matrix**

Update `agent-runtime-base-evaluation.md` Agent Zero column with findings.

- [ ] **Step 8: Commit Agent Zero run result**

Run:

```bash
git add docs/superpowers/research/agent-zero-runbook.md docs/superpowers/research/agent-runtime-base-evaluation.md
git commit -m "Evaluate Agent Zero local runtime"
```

Expected: commit succeeds.

## Task 4: Clone and Inspect Suna/Kortix

**Files:**
- External: `.external/suna/`
- Create: `docs/superpowers/research/suna-runbook.md`
- Modify: `docs/superpowers/research/agent-runtime-base-evaluation.md`

- [ ] **Step 1: Clone Suna**

Run:

```bash
mkdir -p .external
git clone https://github.com/kortix-ai/suna .external/suna
```

Expected: `.external/suna` exists and is ignored by git.

- [ ] **Step 2: Read setup docs**

Run:

```bash
rg --files .external/suna | rg '(^|/)(README|readme|INSTALL|install|docker|compose|env|setup)'
```

Expected: identify the main README, Docker docs, and env examples.

- [ ] **Step 3: Create Suna runbook**

Create `docs/superpowers/research/suna-runbook.md`:

```markdown
# Suna/Kortix Runbook

Date: 2026-05-20

## Repo

https://github.com/kortix-ai/suna

## Setup Commands Tried

TBD

## Required Environment

TBD

## Ports and URLs

TBD

## Observed Capabilities

- Web UI: TBD
- Agent runtime: TBD
- Sandbox/desktop visibility: TBD
- Files: TBD
- Integrations: TBD
- Task streaming: TBD
- Approval hooks: TBD

## Issues

TBD

## Fit for Personal Agent Sharing

TBD
```

- [ ] **Step 4: Record static inspection**

Update the runbook with:

- app architecture
- setup command
- start command
- env requirements
- frontend location
- backend/runtime location
- sandbox model

- [ ] **Step 5: Commit Suna inspection**

Run:

```bash
git add docs/superpowers/research/suna-runbook.md docs/superpowers/research/agent-runtime-base-evaluation.md
git commit -m "Inspect Suna as runtime candidate"
```

Expected: commit succeeds.

## Task 5: Run Suna If Setup Is Reasonable

**Files:**
- Modify: `docs/superpowers/research/suna-runbook.md`
- Modify: `docs/superpowers/research/agent-runtime-base-evaluation.md`

- [ ] **Step 1: Assess setup complexity**

Use the Suna docs to determine whether local setup can be completed within one hour.

Expected: continue only if requirements are locally available or quick to configure.

- [ ] **Step 2: Configure minimal env**

Create local env files inside `.external/suna` only.

Expected: no secrets or env files are tracked by git.

- [ ] **Step 3: Start Suna**

Run the documented local start command.

Expected: local web UI starts, or failure is documented with exact error.

- [ ] **Step 4: Run the same representative task**

Task:

```text
Research the difference between Linear and Notion AI and produce a one-page summary.
```

Expected: agent can execute useful work or limitation is documented.

- [ ] **Step 5: Update matrix**

Update `agent-runtime-base-evaluation.md` Suna column with findings.

- [ ] **Step 6: Commit Suna run result**

Run:

```bash
git add docs/superpowers/research/suna-runbook.md docs/superpowers/research/agent-runtime-base-evaluation.md
git commit -m "Evaluate Suna local runtime"
```

Expected: commit succeeds.

## Task 6: Static Review OpenHands and Vercel Open Agents

**Files:**
- Modify: `docs/superpowers/research/agent-runtime-base-evaluation.md`

- [ ] **Step 1: Inspect OpenHands docs**

Use GitHub docs and README to identify:

- frontend architecture
- runtime/sandbox architecture
- browser/terminal/file capabilities
- event streaming or API surfaces
- why it may or may not be a good friend-facing base

- [ ] **Step 2: Inspect Vercel Open Agents docs**

Use GitHub docs and README to identify:

- web-to-agent architecture
- sandbox model
- session sharing behavior
- streaming/cancel behavior
- reusable ideas for our share gateway

- [ ] **Step 3: Update evaluation matrix**

Update the OpenHands and Vercel Open Agents columns.

- [ ] **Step 4: Commit reference review**

Run:

```bash
git add docs/superpowers/research/agent-runtime-base-evaluation.md
git commit -m "Review reference agent runtime architectures"
```

Expected: commit succeeds.

## Task 7: Make Base Selection Decision

**Files:**
- Create: `docs/superpowers/research/base-selection-decision.md`
- Modify: `docs/superpowers/research/agent-runtime-base-evaluation.md`

- [ ] **Step 1: Write decision document**

Create `docs/superpowers/research/base-selection-decision.md`:

```markdown
# Base Selection Decision

Date: 2026-05-20

## Decision

TBD

## Why

TBD

## What We Will Reuse

TBD

## What We Will Replace

TBD

## Demo Plan

TBD

## Risks

TBD

## Next Implementation Plan

TBD
```

- [ ] **Step 2: Choose the base**

Select one:

- Agent Zero for fastest visible desktop-agent demo.
- Suna/Kortix for more product-shaped base.
- Custom composed stack only if both are too hard to adapt.

- [ ] **Step 3: Define first demo modification**

Write the first real product modification as a new follow-up plan. Expected scope:

- friend share link
- simple public route
- task submission to chosen runtime
- read-only desktop preview
- owner kill switch

- [ ] **Step 4: Commit decision**

Run:

```bash
git add docs/superpowers/research/base-selection-decision.md docs/superpowers/research/agent-runtime-base-evaluation.md
git commit -m "Select base for personal agent sharing demo"
```

Expected: commit succeeds.

## Verification

Run:

```bash
git status --short
```

Expected: no uncommitted tracked files. Ignored `.external/` clones may exist locally.

Run:

```bash
git log --oneline --decorate -5
```

Expected: recent commits show the design, preparation, candidate inspections, candidate evaluations, and final decision.

## Handoff

After this plan is complete, write the next implementation plan for the selected base. That plan should target actual product code changes in the chosen repository or fork.

