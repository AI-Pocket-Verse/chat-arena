import { describe, expect, it } from 'vitest'
import { detectSystemLang, format } from './lang'
import { AREAS, en, zh } from './messages'

const PREFIXES: Record<string, string[]> = {
  common: ['app.', 'nav.', 'identity.', 'lang.', 'menu.', 'common.', 'naming.', 'error.'],
}

// 比较占位符名称的集合：英文复数写法 `{n} {n|turn|turns}` 会让同一个名字出现两次
const placeholders = (s: string) => [...new Set([...s.matchAll(/\{(\w+)(?:\|[^}]*)?\}/g)].map((m) => m[1]))].sort()

describe('messages', () => {
  it('area keys carry their area prefix and never collide across areas', () => {
    const seen = new Map<string, string>()
    for (const [area, mod] of Object.entries(AREAS)) {
      const prefixes = PREFIXES[area] ?? [`${area}.`]
      for (const key of Object.keys(mod.zh)) {
        expect(prefixes.some((p) => key.startsWith(p)), `${area}: ${key}`).toBe(true)
        expect(seen.get(key), `duplicate key ${key}`).toBeUndefined()
        seen.set(key, area)
      }
    }
  })

  it('every key has a non-empty English text with the same placeholders', () => {
    for (const key of Object.keys(zh) as Array<keyof typeof zh>) {
      expect(en[key], key).toBeTruthy()
      expect(placeholders(en[key]), key).toEqual(placeholders(zh[key]))
    }
  })
})

describe('lang helpers', () => {
  it('detects zh / en from the browser language list, falling back to English', () => {
    expect(detectSystemLang(['zh-CN', 'en'])).toBe('zh')
    expect(detectSystemLang(['en-US'])).toBe('en')
    expect(detectSystemLang(['fr-FR', 'zh-TW'])).toBe('zh')
    expect(detectSystemLang(['fr-FR'])).toBe('en')
  })
  it('formats placeholders and English plurals', () => {
    expect(format('{n} {n|turn|turns}', { n: 1 })).toBe('1 turn')
    expect(format('{n} {n|turn|turns}', { n: 3 })).toBe('3 turns')
    expect(format('hi {name}', {})).toBe('hi {name}')
  })
})
