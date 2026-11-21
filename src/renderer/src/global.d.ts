import type { PiWrightApi } from '../../shared/ipc-contracts'

declare global {
  interface Window {
    piwright: PiWrightApi
  }
}

export {}
