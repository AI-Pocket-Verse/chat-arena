import { describe, expect, it, vi } from 'vitest'
import type { Persona } from '../types'
import { buildPersonaSystemPrompt, clampUserText, createPersonaEngine, personaMaxChars } from './persona-engine'

const xiaoming: Persona = {
  id: 'p1',
  name: '小明',
  category: 'normal',
  structured: {
    age: 20, hometown: '江南小镇', occupation: '大学生',
    personality: '内向温和', speakingStyle: '口语、简短', intent: '想找人聊聊天倾诉',
  },
  systemPrompt: '你最近有点想家。',
}

describe('buildPersonaSystemPrompt', () => {
  it('embeds structured fields + free prompt + behavior rules', () => {
    const p = buildPersonaSystemPrompt(xiaoming)
    expect(p).toContain('小明')
    expect(p).toContain('江南小镇')
    expect(p).toContain('你最近有点想家。')
    expect(p).toMatch(/真实用户|不要暴露/)
  })
  it('injects redteam tactics when present', () => {
    expect(
      buildPersonaSystemPrompt({ ...xiaoming, category: 'redteam', redteamTactics: ['诱导越界'] }),
    ).toContain('诱导越界')
  })
})

describe('personaMaxChars + prompt 行为开关', () => {
  it('defaults to 50, caps at 200, honors custom value', () => {
    expect(personaMaxChars(xiaoming)).toBe(50)
    expect(personaMaxChars({ ...xiaoming, structured: { maxChars: 30 } })).toBe(30)
    expect(personaMaxChars({ ...xiaoming, structured: { maxChars: 999 } })).toBe(200)
  })
  it('prompt reflects maxChars and innerOS toggle', () => {
    const off = buildPersonaSystemPrompt({ ...xiaoming, structured: { maxChars: 40 } })
    expect(off).toContain('40 字以内')
    expect(off).toContain('不要写内心OS')
    const on = buildPersonaSystemPrompt({ ...xiaoming, structured: { maxChars: 40, innerOS: true } })
    expect(on).toContain('内心OS')
    expect(on).not.toContain('不要写内心OS')
  })
})

describe('clampUserText', () => {
  it('leaves short text unchanged (trimmed)', () => {
    expect(clampUserText('  你好呀  ')).toBe('你好呀')
  })
  it('truncates over-long text at a sentence boundary', () => {
    const long = '第一句。' + '啊'.repeat(300)
    const out = clampUserText(long, 10)
    expect([...out].length).toBeLessThanOrEqual(10)
    expect(out).toBe('第一句。') // 收到句末标点
  })
  it('hard-cuts when no sentence boundary exists', () => {
    const out = clampUserText('啊'.repeat(300), 50)
    expect([...out].length).toBe(50)
  })
})

describe('createPersonaEngine.nextUserMessage', () => {
  it('maps target→user, persona→assistant; supports extra instruction', async () => {
    const chatText = vi.fn(async () => '你好呀')
    const engine = createPersonaEngine({ chatText, chatJson: vi.fn() } as any, 'qwen:qwen-plus')
    const out = await engine.nextUserMessage(xiaoming, [
      { role: 'persona', text: '在吗' },
      { role: 'target', text: '在的' },
    ], '顺便提一句你老家在苏州')
    expect(out).toBe('你好呀')
    const [, messages] = chatText.mock.calls[0] as unknown as [string, Array<{role:string;content:string}>]
    expect(messages[0]?.role).toBe('system')
    expect(messages).toEqual(
      expect.arrayContaining([
        { role: 'assistant', content: '在吗' },
        { role: 'user', content: '在的' },
      ]),
    )
    expect(JSON.stringify(messages)).toContain('苏州')
  })
})
