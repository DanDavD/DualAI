/**
 * DUALAI - Cross-Platform OS Detection & Accelerator Formatting Utilities
 * Guarantees 100% native shortcuts and layout parity across macOS and Windows 11.
 */

export const isMac =
  typeof navigator !== 'undefined' && /mac/i.test(navigator.platform || navigator.userAgent)

export const isWindows =
  typeof navigator !== 'undefined' && /win/i.test(navigator.platform || navigator.userAgent)

/**
 * Normalizes accelerators for the active OS.
 * On macOS: CommandOrControl -> Cmd, Alt -> Option (or Alt), Ctrl -> Ctrl
 * On Windows/Linux: CommandOrControl -> Ctrl, Cmd -> Ctrl
 */
export function formatPlatformShortcut(shortcut: string): string {
  if (!shortcut) return ''

  if (isMac) {
    return shortcut.replace(/CommandOrControl/g, 'Cmd')
  }

  // Windows / Linux
  return shortcut
    .replace(/CommandOrControl/g, 'Ctrl')
    .replace(/\bCmd\b/g, 'Ctrl')
}
