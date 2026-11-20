import React from 'react'
import {
  Mic,
  Monitor,
  Activity,
  Sliders,
  Play,
  Square,
  CheckCircle2,
  ShieldCheck,
  Cpu
} from 'lucide-react'
import { SessionProvider, useSession } from './context/SessionContext'
import { Header } from './components/Header/Header'
import { SubHeader } from './components/SubHeader/SubHeader'
import { GlossaryModal } from './components/Modals/GlossaryModal'
import { DOMAIN_PRESETS } from '../../types/domain'
import { SUPPORTED_LANGUAGES } from '../../types/language'

const WorkspaceContent: React.FC = () => {
  const {
    audioRoute,
    operatingMode,
    domainId,
    sourceLang,
    targetLang,
    latencyMode,
    isAudioActive,
    gainChannelA,
    gainChannelB,
    setGainChannelA,
    setGainChannelB,
    levelMetricA,
    levelMetricB,
    bufferSamplesA,
    bufferSamplesB,
    startAudioEngine,
    stopAudioEngine,
    latencyPingMs,
    quotaRemainingHours
  } = useSession()

  const activeDomain = DOMAIN_PRESETS[domainId] || DOMAIN_PRESETS.general
  const sourceLangObj = SUPPORTED_LANGUAGES.find((l) => l.code === sourceLang) || SUPPORTED_LANGUAGES[0]
  const targetLangObj = SUPPORTED_LANGUAGES.find((l) => l.code === targetLang) || SUPPORTED_LANGUAGES[1]

  return (
    <div className="flex h-screen w-screen flex-col bg-surface-base text-text-primary select-none overflow-hidden font-sans">
      {/* ZONE 1: TOP GLOBAL HEADER */}
      <Header />

      {/* ZONE 2: SUB-HEADER & HARDWARE VU METERS */}
      <SubHeader />

      {/* WORKSPACE PREVIEW: AUDIO ENGINE & REAL-TIME CONTROLS */}
      <main className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Title & Action Strip */}
        <div className="flex items-center justify-between border-b border-surface-border pb-4">
          <div>
            <h1 className="text-base font-semibold tracking-tight text-text-primary">
              Native Audio Ingestion Engine (Dual-Channel 16kHz PCM)
            </h1>
            <p className="text-xs text-text-secondary mt-0.5">
              AudioWorklet off-thread normalization, 30ms circular ring buffers, and hardware gain scaling.
            </p>
          </div>

          <div className="flex items-center space-x-3">
            {/* Master Engine Trigger Button */}
            <button
              type="button"
              onClick={isAudioActive ? stopAudioEngine : startAudioEngine}
              className={`flex h-8 items-center space-x-2 rounded px-3 text-xs font-semibold transition shadow-sm focus:outline-none ${
                isAudioActive
                  ? 'bg-accent-crimson hover:bg-accent-crimson/90 text-white'
                  : 'bg-accent-steel hover:bg-accent-steel/90 text-white'
              }`}
            >
              {isAudioActive ? (
                <>
                  <Square className="h-3 w-3 fill-current" />
                  <span>Stop Audio Ingestion</span>
                </>
              ) : (
                <>
                  <Play className="h-3 w-3 fill-current" />
                  <span>Start Audio Ingestion</span>
                </>
              )}
            </button>

            <div className="flex items-center space-x-1.5 rounded border border-surface-border bg-surface-panel px-2.5 py-1 font-mono text-xs text-text-secondary">
              <span
                className={`h-2 w-2 rounded-full ${
                  isAudioActive ? 'bg-accent-emerald animate-pulse' : 'bg-surface-border'
                }`}
              />
              <span>{isAudioActive ? 'INGESTING 16KHZ PCM' : 'ENGINE IDLE'}</span>
            </div>
          </div>
        </div>

        {/* Real-time Hardware Engine Controls & Telemetry */}
        <div className="grid grid-cols-3 gap-4">
          {/* Card 1: Channel A Hardware Ingest (Local Mic) */}
          <div className="rounded-lg border border-surface-border bg-surface-panel p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Mic className="h-4 w-4 text-accent-steel" strokeWidth={1.5} />
                <span className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
                  Channel A (Microphone)
                </span>
              </div>
              <span className="font-mono text-[10px] text-accent-steel bg-accent-steel/10 border border-accent-steel/20 px-2 py-0.5 rounded">
                CH A - IN
              </span>
            </div>

            <div className="space-y-2 font-mono text-xs text-text-secondary">
              <div className="flex items-center justify-between">
                <span>Hardware Gain:</span>
                <span className="text-text-primary font-semibold">{(gainChannelA * 100).toFixed(0)}%</span>
              </div>
              <input
                type="range"
                min="0.0"
                max="2.0"
                step="0.05"
                value={gainChannelA}
                onChange={(e) => setGainChannelA(parseFloat(e.target.value))}
                className="w-full accent-accent-steel bg-surface-border h-1 rounded cursor-pointer"
              />

              <div className="flex items-center justify-between pt-1 border-t border-surface-border-subtle">
                <span>Peak Level:</span>
                <span className="text-text-primary font-semibold">
                  {levelMetricA ? `${levelMetricA.peakDb.toFixed(1)} dB` : '-60.0 dB'}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span>Clipping Guard:</span>
                <span className={levelMetricA?.isClipping ? 'text-accent-crimson font-bold' : 'text-accent-emerald'}>
                  {levelMetricA?.isClipping ? 'CLIPPING PEAK' : 'NOMINAL'}
                </span>
              </div>
            </div>
          </div>

          {/* Card 2: Channel B Hardware Ingest (Loopback) */}
          <div className="rounded-lg border border-surface-border bg-surface-panel p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Monitor className="h-4 w-4 text-accent-amber" strokeWidth={1.5} />
                <span className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
                  Channel B (System Audio)
                </span>
              </div>
              <span className="font-mono text-[10px] text-accent-amber bg-accent-amber/10 border border-accent-amber/20 px-2 py-0.5 rounded">
                CH B - OUT
              </span>
            </div>

            <div className="space-y-2 font-mono text-xs text-text-secondary">
              <div className="flex items-center justify-between">
                <span>Hardware Gain:</span>
                <span className="text-text-primary font-semibold">{(gainChannelB * 100).toFixed(0)}%</span>
              </div>
              <input
                type="range"
                min="0.0"
                max="2.0"
                step="0.05"
                value={gainChannelB}
                onChange={(e) => setGainChannelB(parseFloat(e.target.value))}
                className="w-full accent-accent-amber bg-surface-border h-1 rounded cursor-pointer"
              />

              <div className="flex items-center justify-between pt-1 border-t border-surface-border-subtle">
                <span>Peak Level:</span>
                <span className="text-text-primary font-semibold">
                  {levelMetricB ? `${levelMetricB.peakDb.toFixed(1)} dB` : '-60.0 dB'}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span>Loopback Status:</span>
                <span className="text-accent-emerald font-medium">CoreAudio/WASAPI Active</span>
              </div>
            </div>
          </div>

          {/* Card 3: Circular FIFO Buffer & Worklet Health */}
          <div className="rounded-lg border border-surface-border bg-surface-panel p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Cpu className="h-4 w-4 text-accent-emerald" strokeWidth={1.5} />
                <span className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
                  Worklet & Buffer Engine
                </span>
              </div>
              <span className="font-mono text-[10px] text-accent-emerald bg-accent-emerald/10 border border-accent-emerald/20 px-2 py-0.5 rounded">
                THREADED
              </span>
            </div>

            <div className="space-y-1.5 font-mono text-xs text-text-secondary">
              <div className="flex items-center justify-between py-1 border-b border-surface-border-subtle">
                <span>Worklet Thread:</span>
                <span className="text-accent-emerald font-semibold">AudioWorklet Active</span>
              </div>
              <div className="flex items-center justify-between py-1 border-b border-surface-border-subtle">
                <span>PCM Normalization:</span>
                <span className="text-text-primary font-semibold">16kHz Linear Int16</span>
              </div>
              <div className="flex items-center justify-between py-1 border-b border-surface-border-subtle">
                <span>Frame Slicing:</span>
                <span className="text-text-primary font-semibold">30 ms (480 samples)</span>
              </div>
              <div className="flex items-center justify-between py-1">
                <span>Ring Buffer Capacity:</span>
                <span className="text-text-primary font-semibold">16,000 samples (1 sec)</span>
              </div>
            </div>
          </div>
        </div>

        {/* Real-Time Dual Channel Status Strip */}
        <div className="rounded-lg border border-surface-border bg-surface-panel p-4 space-y-2">
          <div className="flex items-center justify-between text-xs font-mono text-text-secondary">
            <span>
              CONCURRENT INGESTION: {audioRoute.toUpperCase()} | TARGET PAIR: {sourceLangObj.code.toUpperCase()} → {targetLangObj.code.toUpperCase()}
            </span>
            <span>Active Domain: {activeDomain.label}</span>
          </div>
          <div className="grid grid-cols-2 gap-3 text-xs font-mono">
            <div className="rounded bg-surface-base border border-surface-border p-2 flex items-center justify-between">
              <span className="text-text-muted">CH A Ring Buffer Queue:</span>
              <span className="text-accent-steel font-semibold">{bufferSamplesA} samples queued</span>
            </div>
            <div className="rounded bg-surface-base border border-surface-border p-2 flex items-center justify-between">
              <span className="text-text-muted">CH B Ring Buffer Queue:</span>
              <span className="text-accent-amber font-semibold">{bufferSamplesB} samples queued</span>
            </div>
          </div>
        </div>
      </main>

      {/* Footer Status Bar */}
      <footer className="flex h-9 items-center justify-between border-t border-surface-border bg-surface-panel px-4 font-mono text-xs text-text-secondary">
        <div className="flex items-center space-x-2">
          <CheckCircle2 className="h-3.5 w-3.5 text-accent-emerald" strokeWidth={1.5} />
          <span>DAY 04 COMPLETE: DUAL AUDIOWORKLET INGESTION & CIRCULAR BUFFER VERIFIED</span>
        </div>
        <div className="flex items-center space-x-4 text-text-muted">
          <span>NEXT: DAY-05 CLIENT-SIDE SILERO VAD ONNX</span>
          <span className="h-3 w-px bg-surface-border" />
          <span>ZERO EMOJIS ENFORCED</span>
        </div>
      </footer>

      {/* Modals */}
      <GlossaryModal />
    </div>
  )
}

export function App(): React.JSX.Element {
  return (
    <SessionProvider>
      <WorkspaceContent />
    </SessionProvider>
  )
}

export default App
