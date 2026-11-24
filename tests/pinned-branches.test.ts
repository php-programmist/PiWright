import { describe, expect, it } from 'vitest'
import { mergePinnedBranches, setPinnedBranches, sortBranches } from '../src/shared/pinned-branches'
import { DEFAULT_SETTINGS } from '../src/main/settings/settings'

describe('mergePinnedBranches', () => {
  it('сохраняет строковые ключи с массивами непустых строк, дубли срезает', () => {
    const out = mergePinnedBranches({ 'dir\u0000D:\\proj': ['feat/x', 'main', 'feat/x', ''] })
    expect(out).toEqual({ 'dir\u0000D:\\proj': ['feat/x', 'main'] })
  })

  it('битые значения отбрасывает', () => {
    const out = mergePinnedBranches({ k: 'nope', empty: [], bad: [1, null], ok: ['a'] })
    expect(out).toEqual({ ok: ['a'] })
  })

  it('не-объект → пустая карта', () => {
    expect(mergePinnedBranches(null)).toEqual({})
    expect(mergePinnedBranches(['a'])).toEqual({})
    expect(mergePinnedBranches('x')).toEqual({})
  })
})

describe('setPinnedBranches', () => {
  it('пишет список и удаляет ключ при пустом/null', () => {
    const base = { ...DEFAULT_SETTINGS }
    const withPin = setPinnedBranches(base, 'k', ['main'])
    expect(withPin.pinnedBranches).toEqual({ k: ['main'] })
    const removed = setPinnedBranches({ ...base, pinnedBranches: { k: ['main'] } }, 'k', null)
    expect(removed.pinnedBranches).toEqual({})
    const emptied = setPinnedBranches({ ...base, pinnedBranches: { k: ['main'] } }, 'k', [])
    expect(emptied.pinnedBranches).toEqual({})
  })
})

describe('sortBranches', () => {
  it('закреплённые в порядке закрепления, затем main/master, затем алфавит', () => {
    const out = sortBranches(['zeta', 'feature', 'master', 'dev', 'main', 'alpha'], ['dev', 'zeta'])
    expect(out).toEqual(['dev', 'zeta', 'main', 'master', 'alpha', 'feature'])
  })

  it('без закреплённых main первый, master второй', () => {
    expect(sortBranches(['master', 'b', 'main', 'a'], [])).toEqual(['main', 'master', 'a', 'b'])
  })

  it('не мутирует входной массив', () => {
    const list = ['main', 'x']
    sortBranches(list, [])
    expect(list).toEqual(['main', 'x'])
  })
})
