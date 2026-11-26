import { describe, expect, it } from 'vitest'
import { mergeBackgroundSessions } from '../src/renderer/src/lib/bg-sessions'
import type { SessionRow } from '../src/renderer/src/stores/sessions'
import type { DaemonStatus, ProjectEntry, SessionDot } from '../src/shared/ipc-contracts'

/** mergeBackgroundSessions: daemon-сессии + eject-строки панели, дедуп по файлу сессии. */

const project: ProjectEntry = { kind: 'native', dir: 'D:\\tmp\\proj' }

function row(overrides: Partial<SessionRow>): SessionRow {
  return {
    hostId: 'h1',
    project,
    title: 'Session',
    dot: 'idle',
    state: 'idle',
    sessionId: null,
    sessionFile: 'C:/s/a.jsonl',
    telegram: false,
    shared: false,
    background: false,
    ...overrides
  }
}

function daemonStatus(sessions: DaemonStatus['sessions']): DaemonStatus {
  return { alive: true, background: sessions.length, skew: null, sessions }
}

describe('mergeBackgroundSessions', () => {
  it('daemon-сессии проходят насквозь, eject-строки добавляются после них', () => {
    const daemonRow = {
      sessionKey: 's1',
      sessionFile: 'C:/s/daemon.jsonl',
      mode: 'native' as const,
      projectDir: 'D:\\tmp\\other',
      title: 'Daemon session',
      streaming: true
    }
    const result = mergeBackgroundSessions(daemonStatus([daemonRow]), [
      row({ hostId: 'h2', background: true, title: 'Ejected', sessionFile: 'C:/s/ejected.jsonl' })
    ])
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ sessionKey: 's1', streaming: true })
    expect(result[1]).toMatchObject({
      sessionKey: 'host:h2',
      sessionFile: 'C:/s/ejected.jsonl',
      mode: 'native',
      projectDir: 'D:\\tmp\\proj',
      title: 'Ejected',
      hostId: 'h2'
    })
  })

  it('строки без флага background не попадают в список', () => {
    const result = mergeBackgroundSessions(daemonStatus([]), [row({ background: false, dot: 'busy' })])
    expect(result).toHaveLength(0)
  })

  it('streaming eject-строки — ход идёт (busy/confirm/waiting), error и idle — нет', () => {
    const dots: SessionDot[] = ['busy', 'confirm', 'question', 'waiting', 'idle', 'error']
    const rows = dots.map((dot, i) => row({ hostId: `h${i}`, background: true, dot }))
    const result = mergeBackgroundSessions(daemonStatus([]), rows)
    expect(result.map((s) => s.streaming)).toEqual([true, true, true, true, false, false])
  })

  it('eject-строка с файлом, уже упомянутым демоном, вытесняется демон-строкой', () => {
    const daemonRow = {
      sessionKey: 's1',
      sessionFile: 'C:/s/a.jsonl',
      mode: 'native' as const,
      projectDir: 'D:\\tmp\\proj',
      title: null,
      streaming: false
    }
    const result = mergeBackgroundSessions(daemonStatus([daemonRow]), [
      row({ background: true, sessionFile: 'C:/s/a.jsonl' }),
      row({ hostId: 'h2', background: true, sessionFile: 'C:/s/b.jsonl' })
    ])
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ sessionKey: 's1' })
    expect(result[1]).toMatchObject({ sessionKey: 'host:h2', sessionFile: 'C:/s/b.jsonl' })
  })

  it('eject-строка без файла сессии остаётся в списке (аттач по живому хосту)', () => {
    const result = mergeBackgroundSessions(daemonStatus([]), [
      row({ background: true, sessionFile: null, dot: 'busy' })
    ])
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ sessionKey: 'host:h1', sessionFile: null, streaming: true, hostId: 'h1' })
  })
})
