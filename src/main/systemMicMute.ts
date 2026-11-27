/**
 * DUALAI - OS-Wide System Microphone Mute Controller
 * Mutes/unmutes the operating system's microphone across ALL running call apps
 * (Zoom, Microsoft Teams, Google Meet, softphones) without DualAI ever capturing
 * or streaming microphone audio to AI services.
 *
 * Cross-platform implementation (zero external binaries, zero shell interpolation):
 * - macOS: CoreAudio input volume via AppleScript (`osascript`) with previous-volume restore.
 * - Windows: Core Audio COM `IAudioEndpointVolume::SetMute` on both eConsole & eCommunications
 *   capture endpoints via PowerShell.
 * - Linux: PulseAudio / PipeWire (`pactl set-source-mute @DEFAULT_SOURCE@`) with ALSA fallback.
 */

import { execFile, execFileSync } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface SystemMicMuteResult {
  ok: boolean
  muted: boolean
  error?: string
}

const DEFAULT_RESTORE_MAC_VOLUME = 75

// Windows PowerShell snippet using standard CoreAudio COM API (IMMDeviceEnumerator + IAudioEndpointVolume)
// Mutes/unmutes both eConsole (0) and eCommunications (2) capture endpoints so all VoIP/call apps honor mute.
const WIN_CORE_AUDIO_CS = `
using System;
using System.Runtime.InteropServices;

public static class DualAiOsMicMute {
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
  private class MMDeviceEnumeratorComObject {}

  [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  private interface IMMDeviceEnumerator {
    [PreserveSig] int EnumAudioEndpoints(int dataFlow, int dwStateMask, out IntPtr ppDevices);
    [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice ppEndpoint);
  }

  [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  private interface IMMDevice {
    [PreserveSig] int Activate(ref Guid iid, int dwClsCtx, IntPtr pActivationParams, [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface);
  }

  [Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  private interface IAudioEndpointVolume {
    [PreserveSig] int RegisterControlChangeNotify(IntPtr pNotify);
    [PreserveSig] int UnregisterControlChangeNotify(IntPtr pNotify);
    [PreserveSig] int GetChannelCount(out uint pnChannelCount);
    [PreserveSig] int SetMasterVolumeLevel(float fLevelDB, ref Guid pguidEventContext);
    [PreserveSig] int SetMasterVolumeLevelScalar(float fLevel, ref Guid pguidEventContext);
    [PreserveSig] int GetMasterVolumeLevel(out float pfLevelDB);
    [PreserveSig] int GetMasterVolumeLevelScalar(out float pfLevel);
    [PreserveSig] int SetChannelVolumeLevel(uint nChannel, float fLevelDB, ref Guid pguidEventContext);
    [PreserveSig] int SetChannelVolumeLevelScalar(uint nChannel, float fLevel, ref Guid pguidEventContext);
    [PreserveSig] int GetChannelVolumeLevel(uint nChannel, out float pfLevelDB);
    [PreserveSig] int GetChannelVolumeLevelScalar(uint nChannel, out float pfLevel);
    [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, ref Guid pguidEventContext);
    [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool pbMute);
  }

  public static void SetMute(bool muted) {
    IMMDeviceEnumerator enumerator = null;
    try {
      enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumeratorComObject());
      var volGuid = new Guid("5CDF2C82-841E-4546-9722-0CF74078229A");
      var ctx = Guid.Empty;
      int[] roles = new int[] { 0, 2 }; // eConsole, eCommunications
      foreach (int role in roles) {
        IMMDevice device = null;
        object obj = null;
        try {
          int hr = enumerator.GetDefaultAudioEndpoint(1, role, out device); // 1 = eCapture
          if (hr != 0 || device == null) continue;
          hr = device.Activate(ref volGuid, 23, IntPtr.Zero, out obj);
          if (hr == 0 && obj != null) {
            ((IAudioEndpointVolume)obj).SetMute(muted, ref ctx);
          }
        } catch {}
        finally {
          if (obj != null) Marshal.ReleaseComObject(obj);
          if (device != null) Marshal.ReleaseComObject(device);
        }
      }
    } finally {
      if (enumerator != null) Marshal.ReleaseComObject(enumerator);
    }
  }
}
`

function buildWindowsMutePsCommand(muted: boolean): string {
  const boolLit = muted ? '$true' : '$false'
  return `Add-Type -TypeDefinition @'\n${WIN_CORE_AUDIO_CS}\n'@; [DualAiOsMicMute]::SetMute(${boolLit})`
}

let isOsMicMuted = false
let didDualAiMuteOsMic = false
let savedMacInputVolume = DEFAULT_RESTORE_MAC_VOLUME
let muteOpQueue: Promise<SystemMicMuteResult> = Promise.resolve({ ok: true, muted: false })

async function readMacInputVolume(): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync(
      'osascript',
      ['-e', 'input volume of (get volume settings)'],
      { timeout: 2500 }
    )
    const parsed = Number.parseInt(stdout.trim(), 10)
    if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 100) {
      return parsed
    }
    return null
  } catch {
    return null
  }
}

async function applyOsMicrophoneMuteSerialized(muted: boolean): Promise<SystemMicMuteResult> {
  const platform = process.platform

  try {
    if (platform === 'darwin') {
      if (muted) {
        const current = await readMacInputVolume()
        if (current !== null && current > 0) {
          savedMacInputVolume = current
        }
        await execFileAsync('osascript', ['-e', 'set volume input volume 0'], { timeout: 2500 })
      } else {
        const restoreVol = Math.max(10, Math.min(100, savedMacInputVolume || DEFAULT_RESTORE_MAC_VOLUME))
        await execFileAsync('osascript', ['-e', `set volume input volume ${restoreVol}`], {
          timeout: 2500
        })
      }
      isOsMicMuted = muted
      didDualAiMuteOsMic = muted
      return { ok: true, muted }
    }

    if (platform === 'win32') {
      const psScript = buildWindowsMutePsCommand(muted)
      await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', psScript],
        { timeout: 5000 }
      )
      isOsMicMuted = muted
      didDualAiMuteOsMic = muted
      return { ok: true, muted }
    }

    if (platform === 'linux') {
      try {
        await execFileAsync(
          'pactl',
          ['set-source-mute', '@DEFAULT_SOURCE@', muted ? '1' : '0'],
          { timeout: 2500 }
        )
      } catch {
        await execFileAsync('amixer', ['set', 'Capture', muted ? 'nocap' : 'cap'], {
          timeout: 2500
        })
      }
      isOsMicMuted = muted
      didDualAiMuteOsMic = muted
      return { ok: true, muted }
    }

    return { ok: false, muted: isOsMicMuted, error: `Unsupported platform: ${platform}` }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, muted: isOsMicMuted, error: message }
  }
}

export function setOsMicrophoneMute(muted: boolean): Promise<SystemMicMuteResult> {
  const next = muteOpQueue.then(
    () => applyOsMicrophoneMuteSerialized(muted),
    () => applyOsMicrophoneMuteSerialized(muted)
  )
  muteOpQueue = next
  return next
}

export async function getOsMicrophoneMute(): Promise<{ muted: boolean }> {
  if (process.platform === 'darwin') {
    const current = await readMacInputVolume()
    if (current !== null) {
      isOsMicMuted = current === 0
      if (current > 0) {
        savedMacInputVolume = current
      }
    }
  }
  return { muted: isOsMicMuted }
}

/**
 * Restores the OS microphone synchronously on app quit ONLY if DualAI muted it,
 * preventing users from being left unexpectedly muted in calls after closing DualAI.
 */
export function restoreOsMicrophoneOnQuit(): void {
  if (!didDualAiMuteOsMic) return
  didDualAiMuteOsMic = false
  isOsMicMuted = false

  try {
    if (process.platform === 'darwin') {
      const restoreVol = Math.max(10, Math.min(100, savedMacInputVolume || DEFAULT_RESTORE_MAC_VOLUME))
      execFileSync('osascript', ['-e', `set volume input volume ${restoreVol}`], { timeout: 2000 })
    } else if (process.platform === 'win32') {
      const psScript = buildWindowsMutePsCommand(false)
      execFileSync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', psScript],
        { timeout: 4000 }
      )
    } else if (process.platform === 'linux') {
      try {
        execFileSync('pactl', ['set-source-mute', '@DEFAULT_SOURCE@', '0'], { timeout: 2000 })
      } catch {
        execFileSync('amixer', ['set', 'Capture', 'cap'], { timeout: 2000 })
      }
    }
  } catch {
    // Best-effort restore during app shutdown
  }
}
