import { describe, expect, it } from 'vitest'
import { mergePanelPrefs } from '../src/shared/panel-prefs'
import { DEFAULT_SETTINGS } from '../src/main/settings/settings'
import type { Settings } from '../src/shared/ipc-contracts'

const BASE: Settings = {
  ...DEFAULT_SETTINGS,
  panels: { git: { open: true, width: 340 } }
}

describe('mergePanelPrefs', () => {
  it('merges patch into one panel, keeping others', () => {
    const patch = mergePanelPrefs(BASE, 'git', { width: 500 })
    expect(patch.panels?.git).toEqual({ open: true, width: 500 })
    expect(patch.panels?.files).toBeUndefined()
  })

  it('does not mutate source settings', () => {
    mergePanelPrefs(BASE, 'files', { open: true })
    expect(BASE.panels.files).toBeUndefined()
    expect(BASE.panels.git?.width).toBe(340)
  })

  it('creates panel entry from empty panels', () => {
    const patch = mergePanelPrefs({ ...DEFAULT_SETTINGS }, 'terminal', { open: true })
    expect(patch.panels?.terminal).toEqual({ open: true })
  })
})
