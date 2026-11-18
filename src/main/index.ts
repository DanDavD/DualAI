import { app, shell, BrowserWindow, ipcMain, globalShortcut, desktopCapturer } from 'electron'
import { join } from 'path'
import { IPC_CHANNELS, ScreenSourceInfo } from '../types/ipc'

let mainWindow: BrowserWindow | null = null
let hudWindow: BrowserWindow | null = null

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 800,
    minHeight: 550,
    show: false,
    autoHideMenuBar: true,
    title: 'DualAI - Professional Interpretation Engine',
    backgroundColor: '#09090b',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerIpcHandlers(): void {
  // Window Controls
  ipcMain.on(IPC_CHANNELS.WINDOW_MINIMIZE, () => {
    mainWindow?.minimize()
  })

  ipcMain.on(IPC_CHANNELS.WINDOW_MAXIMIZE, () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow?.maximize()
    }
  })

  ipcMain.on(IPC_CHANNELS.WINDOW_CLOSE, () => {
    mainWindow?.close()
  })

  ipcMain.handle(IPC_CHANNELS.WINDOW_IS_MAXIMIZED, async (): Promise<boolean> => {
    return mainWindow?.isMaximized() ?? false
  })

  // Hardware Audio & Screen Capture Sources
  ipcMain.handle(IPC_CHANNELS.AUDIO_GET_SOURCES, async (): Promise<ScreenSourceInfo[]> => {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 1280, height: 720 }
    })
    return sources.map((s) => ({
      id: s.id,
      name: s.name,
      thumbnailDataUrl: s.thumbnail.toDataURL(),
      displayId: s.display_id
    }))
  })

  // HUD Window Stubs (Prepared for Module 3 / Day 10)
  ipcMain.handle(IPC_CHANNELS.HUD_OPEN, async (): Promise<void> => {
    // HUD lifecycle will be fully instantiated on Day 10
  })

  ipcMain.handle(IPC_CHANNELS.HUD_CLOSE, async (): Promise<void> => {
    hudWindow?.close()
    hudWindow = null
  })

  ipcMain.handle(IPC_CHANNELS.HUD_SET_OPACITY, async (_event, opacity: number): Promise<void> => {
    hudWindow?.setOpacity(Math.max(0.1, Math.min(1.0, opacity)))
  })

  ipcMain.handle(
    IPC_CHANNELS.HUD_SET_CLICK_THROUGH,
    async (_event, enabled: boolean): Promise<void> => {
      hudWindow?.setIgnoreMouseEvents(enabled, { forward: true })
    }
  )
}

function registerGlobalShortcuts(): void {
  // Quick Mute / Unmute: CommandOrControl + Shift + M
  globalShortcut.register('CommandOrControl+Shift+M', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC_CHANNELS.SHORTCUT_MUTE_TOGGLE)
    }
  })

  // Swap Source/Target Languages: CommandOrControl + Shift + S
  globalShortcut.register('CommandOrControl+Shift+S', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC_CHANNELS.SHORTCUT_SWAP_LANGUAGES)
    }
  })

  // Toggle HUD Overlay: CommandOrControl + Shift + H
  globalShortcut.register('CommandOrControl+Shift+H', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC_CHANNELS.SHORTCUT_TOGGLE_HUD)
    }
  })

  // Trigger Screen Snipping: CommandOrControl + Shift + X
  globalShortcut.register('CommandOrControl+Shift+X', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC_CHANNELS.SHORTCUT_TRIGGER_SNIP)
    }
  })
}

app.whenReady().then(() => {
  registerIpcHandlers()
  registerGlobalShortcuts()
  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
