import type { FastifyRequest } from 'fastify'

// api 侧的语言：界面通过 X-Lang 请求头告诉 api 当前语言（web/src/api.ts）。
// 用于两件事：给人看的错误提示（message）用该语言；发起评测时记到 run.lang，
// 之后这次评测里 AI 生成的内容（模拟用户台词、裁判点评、报告）都用它。

export type Lang = 'zh' | 'en'

/** 解析语言值：en* → en，其余（含缺省）→ zh，保持与改造前的默认行为一致 */
export function parseLang(v: unknown): Lang {
  return typeof v === 'string' && v.trim().toLowerCase().startsWith('en') ? 'en' : 'zh'
}

export function reqLang(req: FastifyRequest): Lang {
  return parseLang(req.headers['x-lang'])
}

/** 发给被测后端的 Accept-Language，便于后端按语言返回角色资料和回复 */
export function acceptLanguage(lang: Lang): string {
  return lang === 'en' ? 'en' : 'zh-CN'
}

/**
 * 追加在模型提示词末尾的输出语言要求。提示词本身是中文写的，模型都能读懂；
 * 只需明确要求输出语言即可（演示模型也靠这句识别英文请求）。
 */
export function outputLanguageRule(lang: Lang, what: { zh: string; en: string }): string {
  return lang === 'en'
    ? `【Output language】Write ${what.en} in English.`
    : `【输出语言】${what.zh}全部用简体中文。`
}

/** 两种语言的文案就地写成 { zh, en }，按 lang 取 */
export function pick(lang: Lang, text: { zh: string; en: string }): string {
  return text[lang]
}
