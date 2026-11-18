# DUALAI: TECHNICAL ARCHITECTURE & 14-DAY PRODUCTION SPRINT PLAN

Document Identifier: DUALAI-SPEC-2026-V1  
Sprint Schedule: 14 Consecutive Days (Day 01 to Day 14)  
Delivery Standard: Microsoft Store Production Gold Master  
Aesthetic Directive: Enterprise Solid-State / DAW Neutral Dark Matrix  
Policy: Strict Zero Emojis Across UI, Logs, and Documentation

---

## 1. AI TEAM GOVERNANCE & INTERACTION PROTOCOL

The engineering team operates under a strict single-spokesperson hierarchy to ensure high architectural velocity and zero communication drift:

```
                      +---------------------------------------+
                      |         CHIEF ARCHITECT / USER        |
                      |        (Final Authority & Scope)      |
                      +---------------------------------------+
                                          ^
                                          | (Exclusive Interaction & Decisions)
                                          v
                      +---------------------------------------+
                      |            AI TEAM LEADER             |
                      |   (Spokesperson, Sprint Coordinator)  |
                      +---------------------------------------+
                                          |
        +---------------------------------+---------------------------------+
        |                                 |                                 |
        v                                 v                                 v
+----------------+               +-----------------+               +-----------------+
| AI CODE MAKER  |               |   AI UX MAKER   |               | AI AGENT AUDITOR|
| (Implementation|               | (Layout, Tokens,|               | (Cross-Agent QA,|
|  & Pipeline)   |               |  Accessibility) |               |  Anti-Drift)    |
+----------------+               +-----------------+               +-----------------+
        |                                 |                                 |
        v                                 v                                 v
+----------------+               +-----------------+                        |
|AI CODE REVIEWER|               | AI UX REVIEWER  |                        |
| (Security, VAD,|               | (Solid Design,  |                        |
|  Memory Leaks) |               |  Zero Emojis)   |                        |
+----------------+               +-----------------+                        |
        |                                 |                                 |
        +---------------------------------+---------------------------------+
                                          |
                               (Internal Synthesis)
                                          v
                               [Direct to AI Leader]
```

### Role Definitions
1. **Chief Architect / User:** Sets the project vision, accepts milestones, and makes executive trade-off decisions.
2. **AI Team Leader:** Sole communicator with the user. Directs sub-agents, aggregates work, enforces standards, and requests decisions only when necessary.
3. **AI Code Maker:** Authors production TypeScript, WebAudio, Electron IPC, and API logic.
4. **AI Code Reviewer:** Audits code quality, memory leaks, performance metrics, and type safety.
5. **AI UX Maker:** Authors clean Tailwind CSS tokens, component layouts, and ergonomics.
6. **AI UX Reviewer:** Enforces strict zero-emoji compliance, DAW-inspired aesthetics, and accessibility.
7. **AI Agent Auditor:** Supervises agent interactions to prevent hallucinations and ensure adherence to this specification.

---

## 2. 14-DAY SPRINT BREAKDOWN (EXACTLY 1 CARD PER DAY)

### WEEK 1: FOUNDATION, AUDIO ROUTING & STREAMING CORE

#### DAY-01: IPC Contracts, Audio Types & Base Design System Tokens
* **Assigned Roles:** Architect, Code Maker
* **Scope:**
  * Define typed IPC contracts in `src/types/ipc.ts`.
  * Establish safe preload exposure in `src/preload/index.ts`.
  * Configure Zinc/Slate color matrix and Geist/Inter typography in Tailwind CSS v4.
  * Define data structures for audio channels, sample rates, and decibel ranges.
* **Definition of Done:**
  * Context isolation strictly enforced.
  * Zero `any` types across IPC definitions.
  * `npm run typecheck` passes with zero warnings.

#### DAY-02: Zone 1 Top Header & Global Audio Routing Surface
* **Assigned Roles:** UX Maker, Code Maker, UX Reviewer
* **Scope:**
  * Implement `Header.tsx` adhering to solid-state enterprise design.
  * Audio routing selector dropdown: Mic, System Loopback, Bilateral, Specific App.
  * Operating mode segmented switch: Translate vs Conversation.
  * Domain preset selector (General, Medical, Legal, Tech, Business).
  * Real-time network latency monitor (ping in ms) with 5-second polling.
* **Definition of Done:**
  * Zero gradient accents or neon visuals.
  * Audio routing switch dispatches cleanly without state corruption.
  * Keyboard accessible navigation across all dropdown menus.

#### DAY-03: Zone 2 Sub-Header, Language Controls & Hardware VU Meters
* **Assigned Roles:** UX Maker, Code Maker
* **Scope:**
  * Left and Right language selectors with searchable ISO codes (e.g. EN - English, ES - Spanish).
  * Central language swap trigger with shortcut `Cmd/Ctrl + Shift + S`.
  * Canvas-rendered dual hardware Peak/RMS VU meters (-60dB to 0dB).
  * Clipping indicator holding red alert state at >0dB for 800ms.
  * Latency mode toggle: Sub-Second Live vs Sentence-Accurate.
* **Definition of Done:**
  * VU meter renders on `requestAnimationFrame` under 2% CPU overhead.
  * Language swap triggers symmetrical channel realignment.

#### DAY-04: Native Audio Ingestion Engine (Mic & System Loopback)
* **Assigned Roles:** Code Maker, Code Reviewer
* **Scope:**
  * AudioWorklet processor for 16kHz linear PCM normalization.
  * Electron `desktopCapturer` stream capture for system/conference loopback.
  * Hardware input gain calibration and channel balance controls.
  * Circular buffer implementation (30ms target) to eliminate buffer underruns.
* **Definition of Done:**
  * Concurrent capture of local microphone and remote meeting audio verified.
  * AudioWorklet outputs clean Float32 to Int16 array buffers.
  * Flat heap profile during sustained 30-minute test.

#### DAY-05: Client-Side Voice Activity Detection (Silero VAD ONNX)
* **Assigned Roles:** Code Maker, Architect
* **Scope:**
  * Load Silero VAD v5 ONNX model in isolated Web Worker thread.
  * Execute 30ms frame-level speech probability computation.
  * Apply threshold gating with configurable pre/post speech padding.
  * Emit speech boundary events to control downstream STT consumption.
* **Definition of Done:**
  * VAD operates fully client-side with sub-5ms inference per frame.
  * Background noise and keyboard clicks classified as non-speech.
  * Zero UI thread stutter during continuous speech.

#### DAY-06: WebSocket Streaming STT Pipeline & Interim Word Events
* **Assigned Roles:** Code Maker, Code Reviewer
* **Scope:**
  * Streaming client connecting to WebSocket endpoint (Deepgram Nova-2 / Whisper Turbo).
  * Sub-second interim transcript dispatch for word-by-word streaming updates.
  * Final transcript commitment and word-level confidence scoring.
  * Tag low-confidence tokens (< 0.75 score) for visual indicator.
* **Definition of Done:**
  * Interim words render in UI under 300ms from speech onset.
  * Automatic reconnection logic handles network packet loss.
  * Dotted underline applied to low-confidence tokens.

#### DAY-07: Real-Time Domain Inference Engine (Gemini 2.0 Flash)
* **Assigned Roles:** Code Maker, Architect, AI Auditor
* **Scope:**
  * Streaming Gemini 2.0 Flash integration with low-temperature configuration.
  * Domain prompt injection: Medical (ICD-10), Legal, Technical, Business, General.
  * Context memory buffer preserving bidirectional conversation continuity.
  * Telemetry recording end-to-end translation latency.
* **Definition of Done:**
  * Translation streaming commences within 400ms of speech pause.
  * Medical terminology strictly conforms to ICD-10 anatomical nomenclature.
  * End-to-end latency benchmarked and logged.

---

### WEEK 2: DUAL WORKSPACE, HUD, SETTINGS & MICROSOFT STORE RELEASE

#### DAY-08: Zone 3 Dual-Pane Split Workspace & Virtualized Feed
* **Assigned Roles:** UX Maker, Code Maker
* **Scope:**
  * Central draggable vertical divider with percentage width persistence.
  * Left pane: Utterance blocks with timestamps, editable speaker labels, source icon.
  * Right pane: Aligned streaming translations with inline action rail.
  * High-contrast bold regex highlighting for dosages, monetary sums, dates.
  * Virtualized scroll feed supporting 1,000+ utterances without frame drops.
* **Definition of Done:**
  * Split divider resizes smoothly without jump or layout shift.
  * Critical numbers and medical units automatically highlighted.
  * Smart auto-scroll pauses when user reviews past utterances.

#### DAY-09: Zone 4 Master Toolbar, Cough/Mute Buffer & State Machine
* **Assigned Roles:** Code Maker, UX Maker
* **Scope:**
  * Global Spacebar toggle for instantaneous zero-gain cough mute.
  * Master Start/Stop Translation state button (Steel Blue / Solid Crimson).
  * System state status indicator (Idle, Listening, Transcribing, Buffer ms).
  * Master finite state machine orchestrating audio, VAD, STT, and UI states.
* **Definition of Done:**
  * Cough mute completely silences microphone in under 1 buffer frame (0ms bleed).
  * Master action button transitions states cleanly without lag.
  * Full keyboard accessibility across all toolbar actions.

#### DAY-10: Module 3 Teleprompter & Floating Overlay HUD Window
* **Assigned Roles:** UX Maker, Code Maker, Architect
* **Scope:**
  * Secondary Electron `BrowserWindow`: frameless, transparent, `alwaysOnTop`.
  * Background opacity slider (0% to 100% solid zinc).
  * Typography scaling slider (14px to 48px Geist Mono).
  * Line display limit switch (2, 4, 6 sentences) with automatic scrolling.
  * Click-through toggle option via Electron `setIgnoreMouseEvents`.
* **Definition of Done:**
  * HUD floats above full-screen video call windows (Zoom, Teams, Meet).
  * Click-through allows interaction with underlying windows without obstruction.
  * Window coordinates and user settings persisted across reboots.

#### DAY-11: Module 4 Configuration Matrix & Custom Glossary Engine
* **Assigned Roles:** UX Maker, Code Maker
* **Scope:**
  * Tab 1: Audio & Hardware (Device selection, gain calibration, RNNoise, AEC).
  * Tab 2: Translation & Domain (CSV/JSON custom glossary upload and validation).
  * Tab 3: Global Keyboard Shortcuts (PTT, Mute, Swap, HUD toggle, Buffer clear).
  * Tab 4: Account & Compliance (Usage gauge, Zero-Data Retention policy).
* **Definition of Done:**
  * Custom glossary CSV parser validates format and injects key-values into prompts.
  * Global shortcuts respond when application is unfocused or minimized.
  * Zero-data retention policy clearly articulated for HIPAA/GDPR alignment.

#### DAY-12: Multimodal Screen Snipping & Instant OCR Translation
* **Assigned Roles:** Code Maker, UX Maker
* **Scope:**
  * Global shortcut `Cmd/Ctrl + Shift + S` triggers screen capture workflow.
  * `desktopCapturer` screenshot preview with crop selection or clipboard paste (`Ctrl+V`).
  * Gemini 2.0 Flash vision call performing OCR and domain translation in 1 request.
  * Modal output presenting source detected text and target translation with copy action.
* **Definition of Done:**
  * Clipboard paste processes images immediately.
  * Single multimodal API call completes extraction and translation under 1.2s.
  * Zero temporary image artifacts left on filesystem after processing.

#### DAY-13: Session Export Engine & Sustained Stress QA / Leak Profiling
* **Assigned Roles:** Code Reviewer, Code Maker, AI Auditor
* **Scope:**
  * Export engine generating TXT (speaker-labeled), SRT, VTT, and clean PDF.
  * Native Electron save dialog integration via `dialog.showSaveDialog`.
  * 4-hour automated audio loopback benchmark monitoring heap and GC cycles.
  * Validate WebAudio context cleanup on session reset.
* **Definition of Done:**
  * SRT and VTT subtitle files align millisecond timestamps with audio.
  * Heap delta remains under 35MB over a 2-hour uninterrupted stream.
  * Clean export generation without main thread freezing.

#### DAY-14: Windows MSIX Packaging, WACK Validation & Store Submission
* **Assigned Roles:** Architect, Code Maker, AI Leader
* **Scope:**
  * Configure `electron-builder` for Windows `appx`/`msix` target.
  * Generate official store visual assets (44x44, 150x150, 310x150, StoreLogo).
  * Configure `AppxManifest` with publisher identity and restricted capabilities.
  * Execute Windows App Certification Kit (WACK) validation test suite.
  * Assemble Microsoft Partner Center submission metadata and AI declarations.
* **Definition of Done:**
  * Clean `.msix` package created without signature warnings.
  * Windows App Certification Kit (WACK) passes with zero errors and zero warnings.
  * Application 100% prepared for Microsoft Partner Center ingestion.

---

## 3. TRELLO AUTOMATION SCRIPT INSTRUCTIONS

The automated board generation script is located at:
`scripts/create_trello_board.py`

### Execution Syntax
```bash
python3 scripts/create_trello_board.py --key YOUR_API_KEY --token YOUR_TOKEN
```

The script automatically generates the 5 lists, 7 team labels, and all 14 daily sprint cards with due dates and Definition of Done checklists.
