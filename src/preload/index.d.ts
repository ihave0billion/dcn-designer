import { ElectronAPI } from '@electron-toolkit/preload'
import type { DcnApi } from './types'

declare global {
  interface Window {
    electron: ElectronAPI
    dcn: DcnApi
  }
}
