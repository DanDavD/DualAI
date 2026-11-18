export interface CustomElectronAPI {
  platform: string
}

declare global {
  interface Window {
    electronAPI: CustomElectronAPI
  }
}
