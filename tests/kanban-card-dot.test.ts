import { describe, expect, it } from 'vitest'
import { cardDotOf } from '../src/renderer/src/lib/kanban-card-dot'
import type { CardDotInputs } from '../src/renderer/src/lib/kanban-card-dot'
import type { KanbanCard } from '../src/shared/kanban'
import type { ProjectEntry } from '../src/shared/ipc-contracts'
import type { HostChat } from '../src/renderer/src/stores/chat'
import type { SessionRow } from '../src/renderer/src/stores/sessions'

const PROJECT = { kind: 'native', dir: 'C:/repo' } satisfies ProjectEntry
const NOW = '2026-11-24T10:00:00.000Z'

function card(sessions: Array<{ id: string; at?: string }>): KanbanCard {
  return {
    id: 'c-00000001',
    title: 'Task',
    description: '',
    columnId: 'col-1',
    order: 0,
    createdAt: NOW,
    updatedAt: NOW,
    images: [],
    comments: [],
    sessions: sessions.map((s) => ({ id: s.id, title: `S ${s.id}`, at: s.at ?? NOW })),
  }
}

function row(sessionId: string, dot: SessionRow['dot']): SessionRow {
  return {
    hostId: `h-${sessionId}`,
    project: PROJECT,
    title: 'Session',
    dot,
    state: 'ready',
    sessionId,
    sessionFile: null,
    telegram: false,
    shared: false,
  }
}

function inputs(partial: Partial<CardDotInputs> = {}): CardDotInputs {
  return { active: [], chatHosts: {}, attention: undefined, ...partial }
}

function chatHost(unread: boolean): HostChat {
  return { unread } as unknown as HostChat
}

describe('cardDotOf', () => {
  it('сессии нет — точки нет', () => {
    const bare = { ...card([{ id: 's-1' }]), sessions: undefined }
    expect(cardDotOf(bare, 'b-1', inputs())).toBeNull()
  })

  it('живая сессия — её статус', () => {
    expect(cardDotOf(card([{ id: 's-1' }]), 'b-1', inputs({ active: [row('s-1', 'busy')] }))).toEqual({ dot: 'busy', title: 'S s-1' })
  })

  it('живая idle без непрочитанного хода — точки нет', () => {
    expect(cardDotOf(card([{ id: 's-1' }]), 'b-1', inputs({ active: [row('s-1', 'idle')] }))).toBeNull()
  })

  it('живая idle с непрочитанным ходом — зелёная', () => {
    const hostId = 'h-s-1'
    const hit = cardDotOf(card([{ id: 's-1' }]), 'b-1', inputs({ active: [row('s-1', 'idle')], chatHosts: { [hostId]: chatHost(true) } }))
    expect(hit?.dot).toBe('idle')
  })

  it('закрытая сессия во внимании — зелёная, после открытия карточки — нет', () => {
    const attention = { sessions: ['s-1'], dismissed: [] }
    expect(cardDotOf(card([{ id: 's-1' }]), 'b-1', inputs({ attention }))?.dot).toBe('idle')
    const dismissed = { sessions: ['s-1'], dismissed: ['b-1\u0000c-00000001'] }
    expect(cardDotOf(card([{ id: 's-1' }]), 'b-1', inputs({ attention: dismissed }))).toBeNull()
  })

  it('из нескольких сессий берётся самая требовательная к вниманию', () => {
    const hit = cardDotOf(
      card([{ id: 's-1' }, { id: 's-2' }]),
      'b-1',
      inputs({ active: [row('s-1', 'busy'), row('s-2', 'confirm')], attention: { sessions: ['s-1'], dismissed: [] } }),
    )
    expect(hit).toEqual({ dot: 'confirm', title: 'S s-2' })
  })

  it('ожидание субагентов — waiting', () => {
    expect(cardDotOf(card([{ id: 's-1' }]), 'b-1', inputs({ active: [row('s-1', 'waiting')] }))?.dot).toBe('waiting')
  })

  it('ход с ошибкой — error, важнее busy но ниже confirm', () => {
    expect(cardDotOf(card([{ id: 's-1' }]), 'b-1', inputs({ active: [row('s-1', 'error')] }))?.dot).toBe('error')
    const hit = cardDotOf(
      card([{ id: 's-1' }, { id: 's-2' }]),
      'b-1',
      inputs({ active: [row('s-1', 'error'), row('s-2', 'confirm')] }),
    )
    expect(hit?.dot).toBe('confirm')
  })
})
