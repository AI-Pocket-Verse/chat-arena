import { beforeAll, describe, expect, it } from 'vitest'
import { buildRunName, buildVersionLabel, ensurePinyinLoaded, NAME_ALLOWED_RE, nextVersion, todayStamp, toSlug } from './naming'

const D = new Date(2026, 5, 7) // 2026-06-07（月份 0-based，5 = 六月）

// 拼音词典按需懒加载——断言中文转换前先确保已加载。
beforeAll(async () => { await ensurePinyinLoaded() })

describe('toSlug', () => {
  it('中文转无声调拼音', () => {
    expect(toSlug('诺拉')).toBe('nuola')
    expect(toSlug('小美')).toBe('xiaomei')
  })
  it('非中文保留、清掉非字母数字、转小写', () => {
    expect(toSlug('Test-1')).toBe('test1')
    expect(toSlug('张三test')).toBe('zhangsantest')
    expect(toSlug('')).toBe('')
  })
})

describe('todayStamp', () => {
  it('YYYYMMDD（补零）', () => {
    expect(todayStamp(D)).toBe('20260607')
    expect(todayStamp(new Date(2026, 11, 1))).toBe('20261201')
  })
})

describe('nextVersion', () => {
  it('无匹配返回 1', () => {
    expect(nextVersion('xiaomei-nuola', [])).toBe(1)
    expect(nextVersion('xiaomei-nuola', ['other-v3-x', null, undefined])).toBe(1)
  })
  it('取已有最大 v + 1（忽略日期后缀）', () => {
    expect(nextVersion('xiaomei-nuola', [
      'xiaomei-nuola-v1-20260601',
      'xiaomei-nuola-v2-20260605',
      'xiaomei-nuola-v2-20260606', // 同 v2 不影响
    ])).toBe(3)
  })
  it('空 base 返回 1', () => {
    expect(nextVersion('', ['a-v9-x'])).toBe(1)
  })
})

describe('buildRunName', () => {
  it('人设-角色-vN-日期', () => {
    expect(buildRunName('小美', '诺拉', [], D)).toBe('xiaomei-nuola-v1-20260607')
  })
  it('在已有基础上自增 v', () => {
    expect(buildRunName('小美', '诺拉', ['xiaomei-nuola-v1-20260601'], D)).toBe('xiaomei-nuola-v2-20260607')
  })
  it('缺人设或角色时仍生成可用名', () => {
    expect(buildRunName('', '诺拉', [], D)).toBe('nuola-v1-20260607')
    expect(buildRunName('', '', [], D)).toBe('')
  })
})

describe('buildVersionLabel', () => {
  it('角色-vN-日期', () => {
    expect(buildVersionLabel('诺拉', [], D)).toBe('nuola-v1-20260607')
    expect(buildVersionLabel('诺拉', ['nuola-v4-20260101'], D)).toBe('nuola-v5-20260607')
  })
})

describe('NAME_ALLOWED_RE', () => {
  it('允许英文/数字/ - _ .', () => {
    expect(NAME_ALLOWED_RE.test('xiaomei-nuola-v1-20260607')).toBe(true)
    expect(NAME_ALLOWED_RE.test('a_b.c-1')).toBe(true)
    expect(NAME_ALLOWED_RE.test('')).toBe(true)
  })
  it('拒绝中文/空格/其它符号', () => {
    expect(NAME_ALLOWED_RE.test('中文')).toBe(false)
    expect(NAME_ALLOWED_RE.test('a b')).toBe(false)
    expect(NAME_ALLOWED_RE.test('a/b')).toBe(false)
  })
})
