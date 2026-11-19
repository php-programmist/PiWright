import type { PiwrightApi } from '../../shared/ipc-contracts'

declare global {
  interface Window {
    piwright: PiwrightApi
  }
}

export {}
