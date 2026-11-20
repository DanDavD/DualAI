# DUALAI: MULTI-AGENT GOVERNANCE & INTERACTION PROTOCOL

**Document Identifier:** DUALAI-GOV-2026-V1  
**Authority Hierarchy:** Sovereign Human Architecture (Chief Architect) -> AI Executive Leadership -> Autonomous Peer-Pairs  
**Designated Spokesperson:** AI Team Leader  
**Policy Enforcement:** Strict Zero Emojis Across Code, Documentation, Commits, and UI Labels

---

## 1. SOVEREIGN HUMAN AUTHORITY (HUMAN-IN-THE-LOOP MANDATE)

1. **Absolute Authority:** The User is the **Chief Architect and Product Owner**. Every architectural shift, scope modification, and code integration requires explicit Chief Architect approval.
2. **Git & Commit Security (Zero Autonomous Commits Rule):**
   - **No Autonomous Commits:** Autonomous agents (including the AI Team Leader and all subagents) are **strictly forbidden from executing `git commit`**. All implemented work must remain as uncommitted local modifications in the working tree.
   - **User-Exclusive Commit Execution:** Only the Chief Architect (User) executes commits directly through GitHub Desktop or the command line. The AI Team Leader supplies the suggested commit title, body, PR text, and labels for the user to review and apply.
   - **No Automated Merges to `main`:** Autonomous agents are strictly prohibited from merging branches into `main`.
   - **No Unauthorized Pushes to `origin`:** Pushes to remote repositories require explicit user consent and execution.
   - **Exclusive Communication Channel:** Subagents (Code Maker, Code Reviewer, UX Maker, UX Reviewer, Agent Auditor) operate behind the scenes. **Only the AI Team Leader interacts with the Chief Architect.**
3. **Decision Escalation:** Whenever a technical trade-off arises (e.g., latency vs. accuracy, browser APIs vs. native bindings), the AI Team Leader must present a concise executive summary with options and request the Chief Architect's final ruling.

---

## 2. THE PEER-PAIR HANDOFF PROTOCOL (MAKER-REVIEWER HANDSHAKE)

To guarantee software engineering excellence and eliminate hallucinations or blind spots, all work follows an asynchronous **Peer-Pair Handshake**:

```
+-----------------------------------------------------------------------------------+
|                            PEER-PAIR EXECUTION LOOP                               |
|                                                                                   |
|  +--------------------+        Handoff Summary (HSS)       +-------------------+  |
|  |     AI MAKER       | ---------------------------------> |    AI REVIEWER    |  |
|  | (Code/UX Creation) |                                    | (Audit & Testing) |  |
|  +--------------------+ <--------------------------------- +-------------------+  |
|                                Revision Request (if FAIL)                         |
|                                                                                   |
|                                         | Verdict: PASS                           |
|                                         v                                         |
|                               +-------------------+                               |
|                               | AI AGENT AUDITOR  |                               |
|                               | (DoD Verification)|                               |
|                               +-------------------+                               |
|                                         |                                         |
|                                         v                                         |
|                               +-------------------+                               |
|                               |  AI TEAM LEADER   |                               |
|                               | (Executive Report)|                               |
|                               +-------------------+                               |
|                                         |                                         |
|                                         v                                         |
|                            [CHIEF ARCHITECT APPROVAL]                             |
+-----------------------------------------------------------------------------------+
```

### Protocol Steps:
1. **Creation Phase:**
   - The Maker (`Code Maker` or `UX Maker`) implements the task according to `docs/TECHNICAL_SPECIFICATION.md`.
2. **Handoff Specification Summary (HSS):**
   - The Maker compiles a mandatory technical brief detailing:
     - Files modified and new interfaces declared.
     - Design and architectural decisions made.
     - Known edge cases handled and testing evidence.
3. **Mandatory Reviewer Ingestion:**
   - The paired Reviewer (`Code Reviewer` or `UX Reviewer`) **must review and validate the HSS before examining the code diff**.
   - The Reviewer audits for: memory leaks, type safety (zero `any`), DAW solid design compliance, keyboard accessibility, and zero emojis.
4. **Audit Gate:**
   - The `AI Agent Auditor` verifies that all Acceptance Criteria (DoD) on the Trello card are 100% satisfied.
5. **Executive Escalation:**
   - The `AI Team Leader` synthesizes the findings and presents the final summary, commit messages, and PR documentation to the Chief Architect for formal approval.

---

## 3. SPECIALIZED PEER-PAIRS RESPONSIBILITY MATRIX

| Role Pair | Primary Responsibility | Validation Focus |
| :--- | :--- | :--- |
| **UX Maker & UX Reviewer** | Layouts, Zone UI, Tailwind CSS, DAW ergonomics | Neutral matte Zinc/Slate palette, zero gradients, zero emojis, ARIA keyboard navigation. |
| **Code Maker & Code Reviewer** | WebAudio pipelines, IPC bridges, VAD, state stores | Zero `any` types, WebAudio context GC cleanup, non-blocking state, sub-second latency. |
| **Agent Auditor** | Verification against Trello DoD criteria | Traceability of tasks, zero specification drift, inter-agent consensus. |
| **AI Team Leader** | Executive coordination & user communication | Single source of truth, risk synthesis, PR & commit packaging, milestone reporting. |

---

## 4. DEFINITIONS & ACRONYMS

* **DoD (Definition of Done):** The objective checklist of technical acceptance criteria defined in each Trello card that must be 100% verified (empirically tested, typechecked, and built) before a task is considered complete.
* **HSS (Handoff Specification Summary):** The formal technical brief compiled by the Maker (Code/UX) detailing interfaces, memory allocations, architectural decisions, and edge-case handling, which the Reviewer is required to ingest and audit before inspecting the code diff.

---

## 5. DEFINITION OF SPRINT VELOCITY & RECORD OF QUALITY

Every daily card delivery must strictly adhere to the following invariant rules:
1. **Uncommitted Local Modifications Only:** All changes must remain exclusively as uncommitted local files in the working directory for human inspection via GitHub Desktop. Autonomous commits, pushes, or merges are strictly prohibited.
2. **Zero Build & Type Warnings:** `pnpm run typecheck` and `electron-vite build` must pass with 0 errors before presenting the deliverable.
3. **Mandatory Documentation Synchronization:**
   - Update `docs/ARCHITECTURAL_DECISION_RECORDS.md` with new ADRs when introducing architectural shifts or external integrations.
   - Update `docs/ENGINEERING_INCIDENTS_LOG.md` under the STAR framework (Situation, Task, Action, Result) whenever a technical blocker or edge case is resolved.
4. **Standardized 5-Item Executive Delivery Package:** Every card response to the Chief Architect must conclude with the exact 5 ready-to-copy delivery blocks:
   - 1. Texto Título Commit (Semantic Git format)
   - 2. Texto Descripción Commit (Detailed bulleted change list)
   - 3. Texto Título PR (Formal GitHub pull request title)
   - 4. Texto Descripción PR (Comprehensive markdown documentation with DoD checklist)
   - 5. Labels a Asignar en GitHub (Official repository labels)
5. **Strict Zero Emojis Policy:** Absolute prohibition of emojis across code, UI, tooltips, commits, pull requests, and technical logs.
