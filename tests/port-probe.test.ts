/** Проверка занятости порта (пробный listen на 0.0.0.0 — как биндит remote-мост). */
import { createServer } from 'node:net'
import type { AddressInfo } from 'node:net'
import { describe, expect, it } from 'vitest'
import { isPortBusy } from '../src/main/remote/server'

describe('isPortBusy', () => {
  it('занятый порт → true, свободный → false', async () => {
    const server = createServer()
    const port = await new Promise<number>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '0.0.0.0', () => resolve((server.address() as AddressInfo).port))
    })
    try {
      expect(await isPortBusy(port)).toBe(true)
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
    expect(await isPortBusy(port)).toBe(false)
  })
})
