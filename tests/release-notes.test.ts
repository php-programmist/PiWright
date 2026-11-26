import { describe, expect, it } from 'vitest'
import { extractSection } from '../scripts/release-notes.cjs'

describe('extractSection', () => {
  const changelog = [
    '# Changelog',
    '',
    '## v0.6.0 (2026-12-01)',
    '',
    '- next feature',
    '',
    '## v0.5.0 (2026-11-26)',
    '',
    '- web mode',
    '- background sessions',
    '',
    'text after list',
    '',
    '## v0.4.0 (2026-11-01)',
    '',
    '- older'
  ].join('\n')

  it('extracts the section for the requested version until the next heading', () => {
    expect(extractSection(changelog, '0.5.0')).toBe(
      ['## v0.5.0 (2026-11-26)', '', '- web mode', '- background sessions', '', 'text after list'].join('\n')
    )
  })

  it('extracts the first section and the last section without a following heading', () => {
    expect(extractSection(changelog, '0.6.0')).toBe('## v0.6.0 (2026-12-01)\n\n- next feature')
    expect(extractSection(changelog, '0.4.0')).toBe('## v0.4.0 (2026-11-01)\n\n- older')
  })

  it('returns null when the version has no section', () => {
    expect(extractSection(changelog, '0.7.0')).toBeNull()
  })

  it('matches version inside heading with v-prefix', () => {
    const single = '# Changelog\n\n## v1.2.3\n\n- only'
    expect(extractSection(single, '1.2.3')).toBe('## v1.2.3\n\n- only')
  })
})
