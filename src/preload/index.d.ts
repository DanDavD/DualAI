import { ElectronBridgeApi } from '../types/ipc'

declare global {
  interface Window {
    electronAPI: ElectronBridgeApi
  }
}
