import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { SessionHost } from '../src/main/pi/session-host'
import type { SessionHostListener } from '../src/main/pi/session-host'
import type { PiStatus, ProjectEntry, Settings } from '../src/shared/ipc-contracts'
import type { UiEvent } from '../src/shared/agent-events'

/** Живой smoke против настоящего pi: PIWRIGHT_LIVE_SMOKE=1 npx vitest run tests/live-smoke.test.ts.
 *  Полный круг «prompt → стрим → agent_settled» на обоих бэкендах (критерий фазы 1). */
const enabled = process.env['PIWRIGHT_LIVE_SMOKE'] === '1'

async function runSmoke(kind: 'native' | 'wsl'): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'piwright-smoke-'))
  const settings: Settings = { wslDistro: '', piPathNative: '', piPathWsl: '', projects: [] }
  const project: ProjectEntry = { kind, dir }
  const events: UiEvent[] = []
  const statuses: PiStatus[] = []
  const listener: SessionHostListener = {
    onEvent: (e) => events.push(e),
    onStatus: (s) => statuses.push(s)
  }
  const host = new SessionHost(() => settings, listener, project)
  try {
    const result = await host.prompt('Reply with exactly one word: ping')
    expect(result.ok, result.error ?? 'prompt failed').toBe(true)
    await vi
      .waitFor(
        () => {
          expect(events.some((e) => e.type === 'turn_end')).toBe(true)
        },
        { timeout: 150_000, interval: 500 }
      )
    let text = ''
    for (const e of events) {
      if (e.type === 'assistant_delta') text += e.text
    }
    expect(text.trim().length).toBeGreaterThan(0)
    expect(statuses.some((s) => s.state === 'ready')).toBe(true)
    return text.trim()
  } finally {
    host.dispose()
  }
}

describe.skipIf(!enabled)('live smoke against real pi', () => {
  it(
    'native backend: prompt streams to agent_settled',
    async () => {
      const text = await runSmoke('native')
      console.log('native reply:', text)
    },
    180_000
  )

  it(
    'wsl backend: prompt streams to agent_settled',
    async () => {
      const text = await runSmoke('wsl')
      console.log('wsl reply:', text)
    },
    180_000
  )
})
