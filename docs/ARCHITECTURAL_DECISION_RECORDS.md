# DUALAI: ARCHITECTURAL DECISION RECORDS (ADR)

**Document Identifier:** DUALAI-ADR-2026-V1  
**Target Audience:** Technical Evaluators, System Architects, and Engineering Leadership  
**Standard:** Michael Nygard ADR Template  
**Policy:** Strict Zero Emojis Across All Records

---

## ADR INDEX

* [ADR-001: Desktop Runtime Environment: Electron + Vite vs. Tauri vs. PWA](#adr-001-desktop-runtime-environment)
* [ADR-002: Package Manager Selection: pnpm over npm / yarn](#adr-002-package-manager-selection)
* [ADR-003: Visual Design Language: Solid-State DAW Matrix over Generic AI Neon Clichés](#adr-003-visual-design-language)
* [ADR-004: Low-Latency Audio Pipeline: AudioWorklet Threading over ScriptProcessorNode](#adr-004-low-latency-audio-pipeline)
* [ADR-005: Multi-Agent AI Governance: Sovereign Human Authority & Peer-Pair Handshake](#adr-005-multi-agent-ai-governance)

---

## ADR-001: DESKTOP RUNTIME ENVIRONMENT

### Status
Accepted

### Context
DualAI requires:
1. Native system audio loopback capture (WASAPI on Windows, CoreAudio on macOS) to intercept meeting audio from Zoom, Teams, and Google Meet without requiring virtual audio cables.
2. Global OS-level keyboard shortcuts that trigger even when the application is minimized or unfocused.
3. A transparent, frameless, click-through HUD window capable of floating over full-screen third-party video call applications.
4. Native screen region capture for instant OCR translation.

### Decision
We chose **Electron with electron-vite and React 19 / TypeScript** over Tauri and Progressive Web Apps (PWA).

### Alternatives Considered & Rejected
* **Progressive Web App (PWA):** Rejected immediately. Modern browsers enforce strict sandboxing that prohibits global background keyboard shortcuts, window opacity controls, click-through overlays, and automated system audio loopback without continuous user interaction prompts.
* **Tauri (v2):** Considered for its lightweight footprint (< 15MB binary). Rejected for this initial release due to ecosystem maturity constraints around cross-platform desktop loopback capture and complex multi-window click-through forward bindings on macOS/Windows, which would require custom native Rust plugins and increase delivery risk within our 14-day timeline.

### Consequences
* **Positive:** Complete access to native OS audio devices, `desktopCapturer` APIs, global shortcuts, and multi-window managers via standard Node.js/Chromium primitives.
* **Negative:** Larger binary size (~85MB) compared to Tauri. Mitigated by strict tree-shaking, minimal runtime dependencies, and Vite's optimized SSR/client bundling.

---

## ADR-002: PACKAGE MANAGER SELECTION

### Status
Accepted

### Context
Node.js package managers differ significantly in dependency resolution strategies, disk utilization, and supply-chain script security.

### Decision
We selected **pnpm** as the sole authorized package manager for the repository.

### Alternatives Considered & Rejected
* **npm (Default):** Rejected due to its flat `node_modules` structure, which causes phantom dependencies (code can require packages that were installed transitively without explicit declaration in `package.json`).
* **yarn (v1/v4):** Rejected due to inconsistent workspace configuration syntax across versions and slower lockfile resolution compared to pnpm.

### Consequences
* **Positive:**
  * Non-flat, symlinked virtual store (`node_modules/.pnpm`) strictly prevents phantom dependencies.
  * Content-addressable global storage saves disk space across branches.
  * Deterministic builds and strict script execution policies (`allowBuilds`) prevent rogue postinstall binaries.
* **Negative:** Requires explicit whitelisting of packages with native compilation scripts (`electron`, `electron-winstaller`, `esbuild`) in `pnpm-workspace.yaml`.

---

## ADR-003: VISUAL DESIGN LANGUAGE

### Status
Accepted

### Context
Modern AI applications heavily lean on visual tropes: animated neon gradients, glowing purple/cyan blobs, floating particles, and decorative emojis. DualAI is built for professional interpreters working in high-stress environments (hospitals, trials, executive negotiations) for 4 to 8 hours continuously.

### Decision
We established the **Enterprise Solid-State DAW Matrix**:
* Neutral matte Zinc/Slate dark theme (`#09090b`, `#121215`, `#18181b`, `#27272a`).
* High-density, high-contrast monospace typography (Geist Mono) for metrics, timestamps, and audio feeds.
* Pure monochrome vector line glyphs (Lucide 1.5px stroke).
* Strict **Zero Emojis policy** across UI, logs, tooltips, and documentation.
* Functional, desaturated accent colors (Steel Blue for primary actions, Muted Emerald for nominal status, Muted Amber for thresholds, Solid Crimson for clipping/errors).

### Alternatives Considered & Rejected
* **Consumer Neomorphic / Cybernetic Theme:** Rejected. Visually exhausting, causes optical glare during prolonged sessions, and looks unprofessional in legal or clinical environments.

### Consequences
* **Positive:** Reduced visual fatigue, maximum readability, zero GPU-heavy CSS gradient calculations, and instant credibility with professional enterprise users and recruiters.

---

## ADR-004: LOW-LATENCY AUDIO PIPELINE

### Status
Accepted

### Context
Real-time interpretation requires sub-second audio turnaround. Ingesting audio on the main JavaScript thread causes buffer underruns, stuttering, and dropped samples whenever the UI renders heavy components or virtualized lists.

### Decision
We architecture the audio engine using **Web Audio API `AudioWorkletNode` running on a dedicated audio rendering thread**:
* Audio normalization and resampling to 16kHz linear PCM occurs off the main thread.
* Audio samples are converted from Float32 to Int16 array buffers in real time inside the worklet.
* Samples are streamed into a 30ms circular FIFO buffer with pre-allocated memory to guarantee zero garbage-collection pauses.

### Alternatives Considered & Rejected
* **`ScriptProcessorNode` (Legacy WebAudio):** Deprecated by W3C. Executes audio processing on the main browser thread, causing noticeable audio pops whenever the UI is busy.
* **External Native C++ Addon (Node-gyp):** Considered for maximum raw throughput, but adds complex cross-compilation toolchains for Windows, macOS, and Linux that complicate local development and CI/CD pipelines.

### Consequences
* **Positive:** Guaranteed zero audio dropouts, smooth 60fps UI animations, and sub-10ms processing latency on the audio thread.

---

## ADR-005: MULTI-AGENT AI GOVERNANCE

### Status
Accepted

### Context
Developing a complex application using multiple autonomous AI subagents can quickly degenerate into chaotic code generation ("vibe coding"), hallucinated dependencies, regression of existing features, and premature commits to `main`.

### Decision
We established a strict **Sovereign Human Authority & Peer-Pair Handshake Protocol** (`docs/AI_GOVERNANCE_PROTOCOL.md`):
* The Human User is the **Chief Architect** with absolute veto power; no commits to `main` or remote pushes can occur without explicit user approval.
* The **AI Team Leader** is the sole spokesperson to the user.
* Work is executed in dedicated peer-pairs (`Code Maker` + `Code Reviewer`; `UX Maker` + `UX Reviewer`).
* The Maker must write a structured **Handoff Specification Summary (HSS)** which the Reviewer must validate before code inspection.
* An **AI Agent Auditor** validates that 100% of the Trello DoD acceptance criteria are satisfied before reporting to the Leader.

### Consequences
* **Positive:** Traceable Git commits, elimination of phantom bugs, strict alignment with project roadmap, and a clean engineering record that proves advanced AI orchestration skills.
