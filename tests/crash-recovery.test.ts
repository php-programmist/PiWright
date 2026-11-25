import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { appendCrashLog, crashDialogPlan, clearSandboxOverride, isRecoverableCrash, readSandboxOverride, writeSandboxOverride } from '../src/main/crash-recovery'

describe('isRecoverableCrash', () => {
  it('accepts sandbox-crash reasons', () => {
    expect(isRecoverableCrash('crashed')).toBe(true)
    expect(isRecoverableCrash('oom')).toBe(true)
    expect(isRecoverableCrash('launch-failed')).toBe(true)
    expect(isRecoverableCrash('integrity-failure')).toBe(true)
  })

  it('ignores normal termination reasons', () => {
    expect(isRecoverableCrash('clean-exit')).toBe(false)
    expect(isRecoverableCrash('killed')).toBe(false)
    expect(isRecoverableCrash('abnormal-exit')).toBe(false)
    expect(isRecoverableCrash('unknown')).toBe(false)
  })
})

describe('sandbox override', () => {
  let dir = ''

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'piwright-crash-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('roundtrips write/read/clear', () => {
    expect(readSandboxOverride(dir)).toBeNull()
    writeSandboxOverride(dir, 'crashed (exitCode -1073741819)')
    const override = readSandboxOverride(dir)
    expect(override?.noSandbox).toBe(true)
    expect(override?.reason).toBe('crashed (exitCode -1073741819)')
    expect(override?.since).not.toBe('')
    clearSandboxOverride(dir)
    expect(readSandboxOverride(dir)).toBeNull()
    expect(existsSync(join(dir, 'sandbox-override.json'))).toBe(false)
  })

  it('returns null for corrupt or wrong-shaped files', () => {
    writeFileSync(join(dir, 'sandbox-override.json'), '{not json', 'utf8')
    expect(readSandboxOverride(dir)).toBeNull()
    writeFileSync(join(dir, 'sandbox-override.json'), '{"noSandbox": false}', 'utf8')
    expect(readSandboxOverride(dir)).toBeNull()
    writeFileSync(join(dir, 'sandbox-override.json'), '{"noSandbox": true, "reason": 42}', 'utf8')
    const override = readSandboxOverride(dir)
    expect(override?.noSandbox).toBe(true)
    expect(override?.reason).toBe('')
  })
})

describe('appendCrashLog', () => {
  let dir = ''

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'piwright-crash-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('creates and appends', () => {
    appendCrashLog(dir, 'line-1')
    appendCrashLog(dir, 'line-2')
    const text = readFileSync(join(dir, 'crash-log.txt'), 'utf8')
    expect(text).toBe('line-1\nline-2\n')
  })

  it('resets the log when it exceeds the cap', () => {
    appendCrashLog(dir, 'old')
    writeFileSync(join(dir, 'crash-log.txt'), 'x'.repeat(600 * 1024), 'utf8')
    appendCrashLog(dir, 'fresh')
    const text = readFileSync(join(dir, 'crash-log.txt'), 'utf8')
    expect(text).toBe('fresh\n')
  })
})

describe('crashDialogPlan', () => {
  it('offers the no-sandbox fallback when the sandbox is on', () => {
    const plan = crashDialogPlan('ru', false, 'crashed', -1073741819)
    expect(plan.buttons).toEqual(['Перезагрузить', 'Перезапустить без песочницы', 'Закрыть'])
    expect(plan.restartNoSandboxIndex).toBe(1)
    expect(plan.detail).toContain('crashed')
    expect(plan.detail).toContain('-1073741819')
  })

  it('drops the fallback when the sandbox is already disabled', () => {
    const plan = crashDialogPlan('ru', true, 'crashed', 1)
    expect(plan.buttons).toEqual(['Перезагрузить', 'Закрыть'])
    expect(plan.restartNoSandboxIndex).toBe(-1)
    expect(plan.detail).toContain('уже отключена')
  })

  it('localizes to English', () => {
    const plan = crashDialogPlan('en', false, 'oom', 1)
    expect(plan.buttons).toEqual(['Reload', 'Restart without sandbox', 'Quit'])
    expect(plan.detail).toContain('oom')
  })
})
