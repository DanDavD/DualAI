import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'
import {
  ElectronBridgeApi,
  IPC_CHANNELS,
  ScreenSourceInfo,
  CaptureBounds,
  TranscriptPayload,
  ShortcutRegistrationReport
} from '../types/ipc'
import { AudioLevelMetric } from '../types/audio'
import { HudBounds, HudSettings, ShortcutBinding } from '../types/settings'

const electronBridgeApi: ElectronBridgeApi = {
  // Window Controls
  minimizeWindow: (): void => {
    ipcRenderer.send(IPC_CHANNELS.WINDOW_MINIMIZE)
  },
  maximizeWindow: (): void => {
    ipcRenderer.send(IPC_CHANNELS.WINDOW_MAXIMIZE)
  },
  closeWindow: (): void => {
    ipcRenderer.send(IPC_CHANNELS.WINDOW_CLOSE)
  },
  isWindowMaximized: async (): Promise<boolean> => {
    return ipcRenderer.invoke(IPC_CHANNELS.WINDOW_IS_MAXIMIZED)
  },

  // Hardware & Loopback Sources
  getDesktopSources: async (): Promise<ScreenSourceInfo[]> => {
    return ipcRenderer.invoke(IPC_CHANNELS.AUDIO_GET_SOURCES)
  },
  captureScreenRegion: async (bounds: CaptureBounds): Promise<string> => {
    return ipcRenderer.invoke(IPC_CHANNELS.AUDIO_CAPTURE_LOOPBACK, bounds)
  },

  // HUD Controls (Day 10)
  openHud: async (initialBounds?: HudBounds): Promise<boolean> => {
    return ipcRenderer.invoke(IPC_CHANNELS.HUD_OPEN, initialBounds)
  },
  closeHud: async (): Promise<void> => {
    return ipcRenderer.invoke(IPC_CHANNELS.HUD_CLOSE)
  },
  isHudOpen: async (): Promise<boolean> => {
    return ipcRenderer.invoke(IPC_CHANNELS.HUD_IS_OPEN)
  },
  setHudOpacity: async (opacity: number): Promise<void> => {
    return ipcRenderer.invoke(IPC_CHANNELS.HUD_SET_OPACITY, opacity)
  },
  setHudClickThrough: async (enabled: boolean): Promise<void> => {
    return ipcRenderer.invoke(IPC_CHANNELS.HUD_SET_CLICK_THROUGH, enabled)
  },
  sendHudConfig: (config: HudSettings): void => {
    ipcRenderer.send(IPC_CHANNELS.HUD_UPDATE_CONFIG, config)
  },
  sendHudTranscript: (payload: TranscriptPayload): void => {
    ipcRenderer.send(IPC_CHANNELS.HUD_UPDATE_TRANSCRIPT, payload)
  },

  // Dynamic Global Shortcuts Registration (Day 11)
  updateGlobalShortcuts: async (
    bindings: ShortcutBinding[]
  ): Promise<ShortcutRegistrationReport> => {
    return ipcRenderer.invoke(IPC_CHANNELS.SHORTCUT_UPDATE_BINDINGS, bindings)
  },

  // Zero-Trust OS Keychain Encrypted Session Vault
  storeEncryptedSession: async (serializedSession: string): Promise<boolean> => {
    return ipcRenderer.invoke(IPC_CHANNELS.AUTH_STORE_SESSION, serializedSession)
  },
  loadEncryptedSession: async (): Promise<string | null> => {
    return ipcRenderer.invoke(IPC_CHANNELS.AUTH_LOAD_SESSION)
  },
  clearEncryptedSession: async (): Promise<boolean> => {
    return ipcRenderer.invoke(IPC_CHANNELS.AUTH_CLEAR_SESSION)
  },

  // Event Listeners (Main -> Renderer)
  onShortcutMute: (callback: () => void): (() => void) => {
    const handler = (): void => callback()
    ipcRenderer.on(IPC_CHANNELS.SHORTCUT_MUTE_TOGGLE, handler)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.SHORTCUT_MUTE_TOGGLE, handler)
    }
  },
  onShortcutSwapLanguages: (callback: () => void): (() => void) => {
    const handler = (): void => callback()
    ipcRenderer.on(IPC_CHANNELS.SHORTCUT_SWAP_LANGUAGES, handler)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.SHORTCUT_SWAP_LANGUAGES, handler)
    }
  },
  onShortcutToggleHud: (callback: () => void): (() => void) => {
    const handler = (): void => callback()
    ipcRenderer.on(IPC_CHANNELS.SHORTCUT_TOGGLE_HUD, handler)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.SHORTCUT_TOGGLE_HUD, handler)
    }
  },
  onShortcutTriggerSnip: (callback: () => void): (() => void) => {
    const handler = (): void => callback()
    ipcRenderer.on(IPC_CHANNELS.SHORTCUT_TRIGGER_SNIP, handler)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.SHORTCUT_TRIGGER_SNIP, handler)
    }
  },
  onShortcutPttToggle: (callback: () => void): (() => void) => {
    const handler = (): void => callback()
    ipcRenderer.on(IPC_CHANNELS.SHORTCUT_PTT_TOGGLE, handler)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.SHORTCUT_PTT_TOGGLE, handler)
    }
  },
  onShortcutClearBuffer: (callback: () => void): (() => void) => {
    const handler = (): void => callback()
    ipcRenderer.on(IPC_CHANNELS.SHORTCUT_CLEAR_BUFFER, handler)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.SHORTCUT_CLEAR_BUFFER, handler)
    }
  },
  onSystemAudioMetrics: (callback: (metric: AudioLevelMetric) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, metric: AudioLevelMetric): void => callback(metric)
    ipcRenderer.on(IPC_CHANNELS.AUDIO_CAPTURE_LOOPBACK, handler)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.AUDIO_CAPTURE_LOOPBACK, handler)
    }
  },
  onHudTranscript: (callback: (payload: TranscriptPayload) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, payload: TranscriptPayload): void =>
      callback(payload)
    ipcRenderer.on(IPC_CHANNELS.HUD_UPDATE_TRANSCRIPT, handler)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.HUD_UPDATE_TRANSCRIPT, handler)
    }
  },
  onHudConfigUpdate: (callback: (config: HudSettings) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, config: HudSettings): void => callback(config)
    ipcRenderer.on(IPC_CHANNELS.HUD_UPDATE_CONFIG, handler)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.HUD_UPDATE_CONFIG, handler)
    }
  },
  onHudBoundsChanged: (callback: (bounds: HudBounds) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, bounds: HudBounds): void => callback(bounds)
    ipcRenderer.on(IPC_CHANNELS.HUD_BOUNDS_CHANGED, handler)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.HUD_BOUNDS_CHANGED, handler)
    }
  },
  onHudStatusChanged: (callback: (isOpen: boolean) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, isOpen: boolean): void => callback(isOpen)
    ipcRenderer.on(IPC_CHANNELS.HUD_STATUS_CHANGED, handler)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.HUD_STATUS_CHANGED, handler)
    }
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electronAPI', electronBridgeApi)
  } catch (error) {
    console.error('[DUALAI] ContextBridge exposure failed:', error)
  }
} else {
  // @ts-ignore (fallback environment)
  window.electronAPI = electronBridgeApi
}
