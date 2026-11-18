#!/usr/bin/env python3
"""
DualAI - Automated Trello Sprint Board Generator
Generates a structured 14-day production sprint board (1 card per day)
using the official Trello REST API.

Zero emojis policy enforced across all board assets and console logs.
Standard library only: no external pip dependencies required.
"""

import sys
import os
import json
import argparse
from datetime import datetime, timedelta
from urllib import request, parse, error

TRELLO_API_BASE = "https://api.trello.com/1"

def api_call(endpoint, method="GET", params=None, data=None):
    if params is None:
        params = {}
    
    query_string = parse.urlencode(params)
    url = f"{TRELLO_API_BASE}{endpoint}"
    if query_string:
        url = f"{url}?{query_string}"
    
    headers = {"Accept": "application/json"}
    body = None
    if data is not None:
        headers["Content-Type"] = "application/json"
        body = json.dumps(data).encode("utf-8")
    
    req = request.Request(url, data=body, headers=headers, method=method)
    try:
        with request.urlopen(req) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except error.HTTPError as e:
        err_msg = e.read().decode("utf-8")
        sys.stderr.write(f"[ERROR] HTTP {e.code} on {endpoint}: {err_msg}\n")
        sys.exit(1)
    except Exception as e:
        sys.stderr.write(f"[ERROR] Failed request on {endpoint}: {str(e)}\n")
        sys.exit(1)

def get_14_day_cards(start_date):
    """
    Returns the exact 14 cards corresponding to the 14-day development sprint.
    """
    days = [
        {
            "day": 1,
            "title": "DAY-01: IPC Contracts, Audio Types & Base Design System Tokens",
            "list": "week1",
            "roles": ["Architect", "Code Maker"],
            "desc": (
                "## Objective\n"
                "Establish strict TypeScript boundaries across Electron Main, Preload, and Renderer processes.\n\n"
                "## Technical Scope\n"
                "- Define explicit IPC channel interfaces in `src/types/ipc.ts`.\n"
                "- Implement context isolation bridge in `src/preload/index.ts` with zero untyped bypasses.\n"
                "- Configure enterprise Zinc/Slate design tokens in Tailwind CSS v4.\n"
                "- Set up sample rate, channel, and decibel measurement types for audio engine."
            ),
            "checklists": [
                "Strict contextBridge exposure implemented",
                "Zero 'any' types in IPC interface contracts",
                "Zinc/Slate color tokens and Geist/Inter font families active",
                "npm run typecheck passes with zero warnings"
            ]
        },
        {
            "day": 2,
            "title": "DAY-02: Zone 1 Top Header & Global Audio Routing Surface",
            "list": "week1",
            "roles": ["UX Maker", "Code Maker", "UX Reviewer"],
            "desc": (
                "## Objective\n"
                "Construct the global master header with functional audio routing and operating mode switches.\n\n"
                "## Technical Scope\n"
                "- Wordmark and version tag with solid typography.\n"
                "- Audio routing selector: Mic, System Loopback, Bilateral, Specific App.\n"
                "- Operating mode segmented control: Translate vs Conversation.\n"
                "- Domain preset selector (General, Medical, Legal, Tech, Business).\n"
                "- Latency ping and quota monitor with 5-second polling interval."
            ),
            "checklists": [
                "Zero gradient or decorative AI accents in header",
                "Audio routing switch dispatches state without buffer interruption",
                "Keyboard accessible dropdowns (Arrow keys, Enter, Escape)",
                "Latency gauge renders in Geist Mono with desaturated status"
            ]
        },
        {
            "day": 3,
            "title": "DAY-03: Zone 2 Sub-Header, Language Controls & Hardware VU Meters",
            "list": "week1",
            "roles": ["UX Maker", "Code Maker"],
            "desc": (
                "## Objective\n"
                "Deliver real-time language pair selection and dual hardware VU decibel meters.\n\n"
                "## Technical Scope\n"
                "- Searchable ISO language selectors (EN - English, ES - Spanish).\n"
                "- Language swap trigger with global shortcut Cmd/Ctrl + Shift + S.\n"
                "- Canvas-rendered hardware peak/RMS VU meters (-60dB to 0dB).\n"
                "- Latency mode toggle: Sub-Second Live vs Sentence-Accurate."
            ),
            "checklists": [
                "VU meters render on requestAnimationFrame at under 2% CPU load",
                "Clipping detection flags red threshold at 0dB and holds 800ms",
                "Language swap swaps audio channel mappings cleanly",
                "Latency switch sets chunking boundaries in audio state"
            ]
        },
        {
            "day": 4,
            "title": "DAY-04: Native Audio Ingestion Engine (Mic & System Loopback)",
            "list": "week1",
            "roles": ["Code Maker", "Code Reviewer"],
            "desc": (
                "## Objective\n"
                "Build low-latency audio capture for both local microphone and system loopback.\n\n"
                "## Technical Scope\n"
                "- AudioWorklet processor for 16kHz linear PCM normalization.\n"
                "- Electron desktopCapturer stream integration for system audio.\n"
                "- Hardware gain control slider and channel clipping prevention.\n"
                "- Circular audio buffer to eliminate audio dropouts (target: 30ms)."
            ),
            "checklists": [
                "Concurrent capture of local mic and remote meeting audio verified",
                "AudioWorklet outputs clean Float32 to Int16 array buffers",
                "Graceful fallback when input device is disconnected at runtime",
                "Memory heap remains flat during continuous 30-minute ingestion"
            ]
        },
        {
            "day": 5,
            "title": "DAY-05: Client-Side Voice Activity Detection (Silero VAD ONNX)",
            "list": "week1",
            "roles": ["Code Maker", "Architect"],
            "desc": (
                "## Objective\n"
                "Integrate Silero VAD running locally via ONNX Runtime Web for ultra-low latency segmentation.\n\n"
                "## Technical Scope\n"
                "- Load Silero VAD v5 ONNX model in Web Worker thread.\n"
                "- 30ms frame-level speech probability computation.\n"
                "- Threshold gating with configurable pre-speech and post-speech padding.\n"
                "- Event emitter triggering STT transmission only during active speech."
            ),
            "checklists": [
                "VAD executes entirely on-device with sub-5ms frame inference",
                "Background keyboard clicks and breathing rejected by classifier",
                "Speech start and speech end events dispatched accurately",
                "Zero main-thread UI stutter during continuous VAD processing"
            ]
        },
        {
            "day": 6,
            "title": "DAY-06: WebSocket Streaming STT Pipeline & Interim Word Events",
            "list": "week1",
            "roles": ["Code Maker", "Code Reviewer"],
            "desc": (
                "## Objective\n"
                "Establish real-time bidirectional WebSocket connection for continuous speech-to-text.\n\n"
                "## Technical Scope\n"
                "- Streaming client connecting to Deepgram Nova-2 / Whisper Turbo WebSocket endpoint.\n"
                "- Sub-second interim transcript dispatch for word-by-word streaming.\n"
                "- Final transcript commitment and word-level confidence scoring.\n"
                "- Low-confidence token tagging (< 0.75 confidence threshold)."
            ),
            "checklists": [
                "Interim words stream to UI in under 300ms from speech onset",
                "Automatic socket reconnection on network interruption",
                "Low-confidence tokens marked with discrete dotted underline",
                "Proper cleanup of socket instances on session termination"
            ]
        },
        {
            "day": 7,
            "title": "DAY-07: Real-Time Domain Inference Engine (Gemini 2.0 Flash)",
            "list": "week1",
            "roles": ["Code Maker", "Architect", "AI Auditor"],
            "desc": (
                "## Objective\n"
                "Connect streaming translation inference with specialized domain prompt injection.\n\n"
                "## Technical Scope\n"
                "- Streaming Gemini 2.0 Flash integration with low-temperature configuration.\n"
                "- Domain prompt directives: Medical (ICD-10), Legal, Technical, Business, General.\n"
                "- Bidirectional context memory preserving speaker dialogue history.\n"
                "- Token stream parsing and translation latency telemetry."
            ),
            "checklists": [
                "Translation begins streaming within 400ms of speech pause",
                "Medical terminology strictly conforms to ICD-10 anatomical directives",
                "Legal terms of art translated verbatim without colloquialism",
                "Telemetry records end-to-end latency metrics accurately"
            ]
        },
        {
            "day": 8,
            "title": "DAY-08: Zone 3 Dual-Pane Split Workspace & Virtualized Feed",
            "list": "week2",
            "roles": ["UX Maker", "Code Maker"],
            "desc": (
                "## Objective\n"
                "Implement the resizable 50/50 dual workspace rendering synchronized transcripts.\n\n"
                "## Technical Scope\n"
                "- Central draggable split divider with percentage width persistence.\n"
                "- Left pane: Original source utterances, timestamps, editable speaker labels.\n"
                "- Right pane: Aligned streaming translations with inline action rail.\n"
                "- High-contrast bold regex highlighting for dosages, currencies, dates.\n"
                "- Virtualized scroll feed supporting 1,000+ utterances without frame drops."
            ),
            "checklists": [
                "Split divider resizes smoothly without flickering or text jump",
                "Numbers and medical units highlighted in high-contrast bold",
                "Smart auto-scroll pauses on user scroll and resumes at bottom",
                "Action rail provides instant Copy, Flag, and Terminology actions"
            ]
        },
        {
            "day": 9,
            "title": "DAY-09: Zone 4 Master Toolbar, Cough/Mute Buffer & State Machine",
            "list": "week2",
            "roles": ["Code Maker", "UX Maker"],
            "desc": (
                "## Objective\n"
                "Build the bottom toolbar, quick cough/mute trigger, and master session state machine.\n\n"
                "## Technical Scope\n"
                "- Global Spacebar toggle for instantaneous zero-gain cough mute.\n"
                "- Master Start/Stop Translation state button (Steel Blue / Solid Crimson).\n"
                "- System state status readout (Idle, Listening, Transcribing, Buffer ms).\n"
                "- State machine linking audio ingestion, VAD, STT, and UI states."
            ),
            "checklists": [
                "Cough mute cuts microphone input within 1 audio buffer (0ms audible bleed)",
                "Master button changes visual state cleanly without lag",
                "System state accurately reflects pipeline activity",
                "Full keyboard navigation across all toolbar action items"
            ]
        },
        {
            "day": 10,
            "title": "DAY-10: Module 3 Teleprompter & Floating Overlay HUD Window",
            "list": "week2",
            "roles": ["UX Maker", "Code Maker", "Architect"],
            "desc": (
                "## Objective\n"
                "Construct the secondary frameless floating HUD for live video conference overlays.\n\n"
                "## Technical Scope\n"
                "- Secondary Electron BrowserWindow: frameless, transparent, alwaysOnTop.\n"
                "- Background opacity slider (0% to 100% solid zinc).\n"
                "- Typography scale slider (14px to 48px Geist Mono).\n"
                "- Line display limit selector (2, 4, 6 sentences) with auto-scroll.\n"
                "- Click-through toggle option via Electron setIgnoreMouseEvents."
            ),
            "checklists": [
                "HUD floats above full-screen Zoom and Teams windows without minimize",
                "Click-through mode allows clicking underlying desktop elements cleanly",
                "Opacity and font scale adjustments apply with zero rendering latency",
                "HUD position and user settings persisted in local storage"
            ]
        },
        {
            "day": 11,
            "title": "DAY-11: Module 4 Configuration Matrix & Custom Glossary Engine",
            "list": "week2",
            "roles": ["UX Maker", "Code Maker"],
            "desc": (
                "## Objective\n"
                "Deliver modular settings modal with custom glossary import and shortcut management.\n\n"
                "## Technical Scope\n"
                "- Tab 1: Audio & Hardware (Device selection, gain calibration, RNNoise, AEC).\n"
                "- Tab 2: Translation & Domain (CSV/JSON custom glossary upload and validation).\n"
                "- Tab 3: Global Keyboard Shortcuts (PTT, Mute, Swap, HUD toggle, Buffer clear).\n"
                "- Tab 4: Account & Compliance (Usage gauge, Zero-Data Retention policy)."
            ),
            "checklists": [
                "CSV glossary parser validates syntax and injects terms into prompt context",
                "Global shortcuts respond when application is minimized in background",
                "Hardware calibration slider provides audible test monitor feedback",
                "Zero-data retention statement clearly articulated for compliance"
            ]
        },
        {
            "day": 12,
            "title": "DAY-12: Multimodal Screen Snipping & Instant OCR Translation",
            "list": "week2",
            "roles": ["Code Maker", "UX Maker"],
            "desc": (
                "## Objective\n"
                "Implement global shortcut screen capture and multimodal OCR translation.\n\n"
                "## Technical Scope\n"
                "- Global shortcut Cmd/Ctrl + Shift + S triggers snipping workflow.\n"
                "- DesktopCapturer screenshot preview with crop selection or clipboard paste.\n"
                "- Gemini 2.0 Flash vision call performing OCR and domain translation in 1 request.\n"
                "- Modal output displaying detected text and translated text with copy action."
            ),
            "checklists": [
                "Clipboard paste (Ctrl+V / Cmd+V) processes images immediately",
                "Single API call extracts text, detects language, and translates under 1.2s",
                "Extracted text respects active domain terminology constraints",
                "Zero temporary files left on disk after capture processing"
            ]
        },
        {
            "day": 13,
            "title": "DAY-13: Session Export Engine & Sustained Stress QA / Leak Profiling",
            "list": "week2",
            "roles": ["Code Reviewer", "Code Maker", "AI Auditor"],
            "desc": (
                "## Objective\n"
                "Build multi-format session export and execute 4-hour continuous audio stress tests.\n\n"
                "## Technical Scope\n"
                "- Export engine generating TXT (speaker-labeled), SRT, VTT, and clean PDF.\n"
                "- Native Electron save dialog integration via dialog.showSaveDialog.\n"
                "- 4-hour automated audio loopback benchmark monitoring heap and GC cycles.\n"
                "- Validate WebAudio context cleanup on session reset."
            ),
            "checklists": [
                "SRT and VTT files align millisecond timestamps accurately with audio",
                "Heap delta remains under 35MB over a 2-hour uninterrupted stream",
                "Zero unhandled promise rejections on simulated network disconnects",
                "Clean export file generation without blocking UI thread"
            ]
        },
        {
            "day": 14,
            "title": "DAY-14: Windows MSIX Packaging, WACK Validation & Store Submission",
            "list": "week2",
            "roles": ["Architect", "Code Maker", "AI Leader"],
            "desc": (
                "## Objective\n"
                "Package production Windows MSIX bundle, validate WACK compliance, and finalize store assets.\n\n"
                "## Technical Scope\n"
                "- Configure electron-builder for Windows appx/msix target.\n"
                "- Generate official store visual assets (44x44, 150x150, 310x150, StoreLogo).\n"
                "- Configure AppxManifest with publisher identity and restricted capabilities.\n"
                "- Run Windows App Certification Kit (WACK) validation test suite.\n"
                "- Assemble Microsoft Partner Center submission metadata and AI declarations."
            ),
            "checklists": [
                "Clean .msix installation package generated without signing warnings",
                "Windows App Certification Kit (WACK) passes with zero errors",
                "Store assets formatted in high-contrast monochrome solid-state palette",
                "Application 100% ready for Microsoft Partner Center ingestion"
            ]
        }
    ]
    
    # Calculate dates
    start_dt = datetime.strptime(start_date, "%Y-%m-%d")
    for item in days:
        card_dt = start_dt + timedelta(days=item["day"] - 1)
        item["due_date"] = card_dt.strftime("%Y-%m-%dT18:00:00.000Z")
        item["date_str"] = card_dt.strftime("%Y-%m-%d")
        
    return days

def main():
    parser = argparse.ArgumentParser(description="Create DualAI 14-Day Sprint Board in Trello")
    parser.add_argument("--key", default=os.environ.get("TRELLO_API_KEY"), help="Trello API Key")
    parser.add_argument("--token", default=os.environ.get("TRELLO_TOKEN"), help="Trello User Token")
    parser.add_argument("--board-name", default="DualAI - 14-Day Production Sprint", help="Board title")
    parser.add_argument("--start-date", default="2026-11-18", help="Sprint start date (YYYY-MM-DD)")
    args = parser.parse_args()

    if not args.key or not args.token:
        sys.stderr.write("[ERROR] Missing Trello API Key or Token.\n")
        sys.stderr.write("Provide via --key and --token arguments or export TRELLO_API_KEY and TRELLO_TOKEN.\n")
        sys.exit(1)

    auth = {"key": args.key, "token": args.token}

    print(f"[STATUS] Initializing board creation: '{args.board_name}'...")
    board_data = api_call("/boards/", method="POST", params={
        **auth,
        "name": args.board_name,
        "defaultLists": "false",
        "prefs_background": "zinc" if "zinc" in ["blue", "orange", "green", "red", "purple", "pink", "lime", "sky", "grey"] else "grey"
    })
    board_id = board_data["id"]
    board_url = board_data["shortUrl"]
    print(f"[SUCCESS] Board created with ID: {board_id}")
    print(f"[LINK] Board URL: {board_url}")

    # Create Labels for Team Roles
    print("[STATUS] Setting up team role labels...")
    roles = {
        "Architect": "sky",
        "Code Maker": "blue",
        "Code Reviewer": "red",
        "UX Maker": "purple",
        "UX Reviewer": "orange",
        "AI Auditor": "yellow",
        "AI Leader": "green"
    }
    label_ids = {}
    for role, color in roles.items():
        lbl = api_call(f"/boards/{board_id}/labels", method="POST", params={
            **auth,
            "name": f"Role: {role}",
            "color": color
        })
        label_ids[role] = lbl["id"]

    # Create 5 Strategic Lists
    print("[STATUS] Generating workflow lists...")
    lists_config = [
        ("Architecture & Reference", "backlog"),
        ("Week 1: Core Engine & Audio (Days 01-07)", "week1"),
        ("Week 2: Interface, HUD & Store (Days 08-14)", "week2"),
        ("Quality Assurance & Review Gate", "qa"),
        ("Completed & Verified (DoD)", "done")
    ]
    created_lists = {}
    for name, key in lists_config:
        lst = api_call("/lists", method="POST", params={
            **auth,
            "name": name,
            "idBoard": board_id
        })
        created_lists[key] = lst["id"]
        print(f"  - Created list: {name}")

    # Generate 14 Daily Cards
    cards = get_14_day_cards(args.start_date)
    print(f"[STATUS] Populating 14 daily sprint cards starting on {args.start_date}...")

    for card in cards:
        target_list_id = created_lists[card["list"]]
        assigned_label_ids = [label_ids[r] for r in card["roles"] if r in label_ids]
        
        card_title = f"{card['title']} [{card['date_str']}]"
        c_res = api_call("/cards", method="POST", params={
            **auth,
            "idList": target_list_id,
            "name": card_title,
            "desc": card["desc"],
            "due": card["due_date"],
            "idLabels": ",".join(assigned_label_ids)
        })
        card_id = c_res["id"]

        # Add Definition of Done Checklist
        cl_res = api_call("/checklists", method="POST", params={
            **auth,
            "idCard": card_id,
            "name": "Acceptance Criteria (Definition of Done)"
        })
        checklist_id = cl_res["id"]

        for item in card["checklists"]:
            api_call(f"/checklists/{checklist_id}/checkItems", method="POST", params={
                **auth,
                "name": item
            })
        
        print(f"  [DAY {card['day']:02d}] Created: {card_title}")

    print("\n[COMPLETE] 14-Day Sprint Board fully generated.")
    print(f"[LINK] View your Trello board at: {board_url}")

if __name__ == "__main__":
    main()
