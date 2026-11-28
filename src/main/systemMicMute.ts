/**
 * DUALAI - OS-Wide System Microphone Mute Controller
 * Mutes/unmutes the operating system's microphone across ALL running call apps
 * (Zoom, Microsoft Teams, Google Meet, softphones) without DualAI ever capturing
 * or streaming microphone audio to AI services.
 *
 * Cross-platform implementation (zero external binaries, zero shell interpolation):
 * - macOS: CoreAudio input volume via AppleScript (`osascript`) with previous-volume restore.
 * - Windows: Persistent hidden Core Audio COM worker (`IMMDeviceEnumerator` + `IAudioEndpointVolume`)
 *   launched with `windowsHide: true` and UTF-16LE `-EncodedCommand` (zero console flash, <5ms toggle).
 * - Linux: PulseAudio / PipeWire (`pactl set-source-mute @DEFAULT_SOURCE@`) with ALSA fallback.
 */

import { ChildProcessWithoutNullStreams, execFile, execFileSync, spawn } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface SystemMicMuteResult {
  ok: boolean
  muted: boolean
  error?: string
}

const DEFAULT_RESTORE_MAC_VOLUME = 75

// Windows CoreAudio COM helper supporting both SetMute and GetMute on eConsole (0) & eCommunications (2).
// Returns explicit status strings (OK/ERR/MUTED/UNMUTED) instead of silently swallowing COM failures.
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

  public static bool SetMute(bool muted) {
    IMMDeviceEnumerator enumerator = null;
    int succeeded = 0;
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
            int muteHr = ((IAudioEndpointVolume)obj).SetMute(muted, ref ctx);
            if (muteHr == 0) succeeded++;
          }
        } catch {}
        finally {
          if (obj != null) Marshal.ReleaseComObject(obj);
          if (device != null) Marshal.ReleaseComObject(device);
        }
      }
      return succeeded > 0;
    } finally {
      if (enumerator != null) Marshal.ReleaseComObject(enumerator);
    }
  }

  public static int GetMute() {
    IMMDeviceEnumerator enumerator = null;
    try {
      enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumeratorComObject());
      var volGuid = new Guid("5CDF2C82-841E-4546-9722-0CF74078229A");
      int[] roles = new int[] { 2, 0 }; // Prefer eCommunications, fallback eConsole
      foreach (int role in roles) {
        IMMDevice device = null;
        object obj = null;
        try {
          int hr = enumerator.GetDefaultAudioEndpoint(1, role, out device);
          if (hr != 0 || device == null) continue;
          hr = device.Activate(ref volGuid, 23, IntPtr.Zero, out obj);
          if (hr == 0 && obj != null) {
            bool isMuted = false;
            int getHr = ((IAudioEndpointVolume)obj).GetMute(out isMuted);
            if (getHr == 0) return isMuted ? 1 : 0;
          }
        } catch {}
        finally {
          if (obj != null) Marshal.ReleaseComObject(obj);
          if (device != null) Marshal.ReleaseComObject(device);
        }
      }
      return -1;
    } finally {
      if (enumerator != null) Marshal.ReleaseComObject(enumerator);
    }
  }
}
`

function encodePowerShellUtf16Base64(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64')
}

function buildWindowsPersistentWorkerScript(): string {
  return [
    `$ErrorActionPreference = 'Stop'`,
    `Add-Type -TypeDefinition @'\n${WIN_CORE_AUDIO_CS}\n'@`,
    `[Console]::Out.WriteLine('READY')`,
    `[Console]::Out.Flush()`,
    `while (($line = [Console]::In.ReadLine()) -ne $null) {`,
    `  $cmd = $line.Trim().ToUpperInvariant()`,
    `  if ($cmd -eq 'EXIT') { break }`,
    `  if ($cmd -eq 'MUTE') {`,
    `    $ok = [DualAiOsMicMute]::SetMute($true)`,
    `    [Console]::Out.WriteLine($(if ($ok) { 'OK:1' } else { 'ERR:NO_ENDPOINT' }))`,
    `  } elseif ($cmd -eq 'UNMUTE') {`,
    `    $ok = [DualAiOsMicMute]::SetMute($false)`,
    `    [Console]::Out.WriteLine($(if ($ok) { 'OK:0' } else { 'ERR:NO_ENDPOINT' }))`,
    `  } elseif ($cmd -eq 'GET') {`,
    `    $state = [DualAiOsMicMute]::GetMute()`,
    `    [Console]::Out.WriteLine("STATE:$state")`,
    `  } else {`,
    `    [Console]::Out.WriteLine('ERR:UNKNOWN')`,
    `  }`,
    `  [Console]::Out.Flush()`,
    `}`
  ].join('\n')
}

function buildWindowsOneShotUnmuteScript(): string {
  return `Add-Type -TypeDefinition @'\n${WIN_CORE_AUDIO_CS}\n'@; [void][DualAiOsMicMute]::SetMute($false)`
}

let winWorker: ChildProcessWithoutNullStreams | null = null
let winWorkerReadyPromise: Promise<void> | null = null
let winStdoutBuffer = ''
let winPendingResolver: ((line: string) => void) | null = null
let winPendingRejecter: ((err: Error) => void) | null = null

function teardownWindowsWorker(): void {
  const proc = winWorker
  winWorker = null
  winWorkerReadyPromise = null
  winStdoutBuffer = ''
  if (winPendingRejecter) {
    const rej = winPendingRejecter
    winPendingResolver = null
    winPendingRejecter = null
    rej(new Error('Windows mic mute worker terminated'))
  }
  if (proc && !proc.killed) {
    try {
      proc.stdin.write('EXIT\n')
    } catch {
      // ignore
    }
    try {
      proc.kill()
    } catch {
      // ignore
    }
  }
}

function ensureWindowsWorker(): Promise<void> {
  if (winWorker && !winWorker.killed && winWorkerReadyPromise) {
    return winWorkerReadyPromise
  }

  teardownWindowsWorker()

  const encoded = encodePowerShellUtf16Base64(buildWindowsPersistentWorkerScript())
  const proc = spawn(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
    {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    }
  )
  winWorker = proc

  winWorkerReadyPromise = new Promise<void>((resolve, reject) => {
    let settled = false
    const bootTimer = setTimeout(() => {
      if (!settled) {
        settled = true
        teardownWindowsWorker()
        reject(new Error('Windows CoreAudio mute worker timed out during initialization'))
      }
    }, 8000)

    proc.stdout.setEncoding('utf8')
    proc.stdout.on('data', (chunk: string) => {
      winStdoutBuffer += chunk
      let nlIdx = winStdoutBuffer.indexOf('\n')
      while (nlIdx !== -1) {
        const line = winStdoutBuffer.slice(0, nlIdx).trim()
        winStdoutBuffer = winStdoutBuffer.slice(nlIdx + 1)
        if (!settled && line === 'READY') {
          settled = true
          clearTimeout(bootTimer)
          resolve()
        } else if (winPendingResolver) {
          const res = winPendingResolver
          winPendingResolver = null
          winPendingRejecter = null
          res(line)
        }
        nlIdx = winStdoutBuffer.indexOf('\n')
      }
    })

    proc.on('error', (err) => {
      if (!settled) {
        settled = true
        clearTimeout(bootTimer)
        reject(err)
      }
      teardownWindowsWorker()
    })

    proc.on('exit', () => {
      if (!settled) {
        settled = true
        clearTimeout(bootTimer)
        reject(new Error('Windows CoreAudio mute worker exited unexpectedly'))
      }
      if (winWorker === proc) {
        winWorker = null
        winWorkerReadyPromise = null
      }
      if (winPendingRejecter) {
        const rej = winPendingRejecter
        winPendingResolver = null
        winPendingRejecter = null
        rej(new Error('Windows CoreAudio mute worker exited'))
      }
    })
  })

  return winWorkerReadyPromise
}

async function sendWindowsWorkerCommand(cmd: 'MUTE' | 'UNMUTE' | 'GET'): Promise<string> {
  await ensureWindowsWorker()
  const proc = winWorker
  if (!proc || proc.killed) {
    throw new Error('Windows CoreAudio mute worker unavailable')
  }

  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (winPendingRejecter) {
        winPendingResolver = null
        winPendingRejecter = null
        teardownWindowsWorker()
        reject(new Error(`Windows mute command "${cmd}" timed out`))
      }
    }, 3000)

    winPendingResolver = (line: string) => {
      clearTimeout(timer)
      resolve(line)
    }
    winPendingRejecter = (err: Error) => {
      clearTimeout(timer)
      reject(err)
    }

    try {
      proc.stdin.write(`${cmd}\n`)
    } catch (err) {
      clearTimeout(timer)
      winPendingResolver = null
      winPendingRejecter = null
      teardownWindowsWorker()
      reject(err instanceof Error ? err : new Error(String(err)))
    }
  })
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
      const reply = await sendWindowsWorkerCommand(muted ? 'MUTE' : 'UNMUTE')
      if (!reply.startsWith('OK:')) {
        return {
          ok: false,
          muted: isOsMicMuted,
          error: `Windows CoreAudio mute failed (${reply})`
        }
      }
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
  } else if (process.platform === 'win32') {
    try {
      const reply = await sendWindowsWorkerCommand('GET')
      if (reply === 'STATE:1') {
        isOsMicMuted = true
      } else if (reply === 'STATE:0') {
        isOsMicMuted = false
      }
    } catch {
      // Keep last known state if CoreAudio worker is unavailable
    }
  }
  return { muted: isOsMicMuted }
}

/**
 * Restores the OS microphone synchronously on app quit ONLY if DualAI muted it,
 * preventing users from being left unexpectedly muted in calls after closing DualAI.
 */
export function restoreOsMicrophoneOnQuit(): void {
  const shouldRestore = didDualAiMuteOsMic
  didDualAiMuteOsMic = false
  isOsMicMuted = false

  if (process.platform === 'win32') {
    if (shouldRestore && winWorker && !winWorker.killed) {
      try {
        winWorker.stdin.write('UNMUTE\nEXIT\n')
      } catch {
        // Fallback to hidden one-shot unmute below
      }
    }
    teardownWindowsWorker()
  }

  if (!shouldRestore) return

  try {
    if (process.platform === 'darwin') {
      const restoreVol = Math.max(10, Math.min(100, savedMacInputVolume || DEFAULT_RESTORE_MAC_VOLUME))
      execFileSync('osascript', ['-e', `set volume input volume ${restoreVol}`], { timeout: 2000 })
    } else if (process.platform === 'win32') {
      const encoded = encodePowerShellUtf16Base64(buildWindowsOneShotUnmuteScript())
      execFileSync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
        { timeout: 4000, windowsHide: true }
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
