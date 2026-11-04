// 界面文案字典：按区域拆成 messages/<区域>.ts，各区域 key 带区域前缀，在这里合并。
// 约定：
//  - 中文是原有文案（必须与改造前逐字一致），英文逐条对应；
//  - 变量用 `{name}` 占位，英文单复数用 `{n|turn|turns}`；
//  - 每个区域的 en 类型是 Record<keyof typeof zh, string>，漏翻一条会直接编译失败。

import * as common from './messages/common'
import * as compare from './messages/compare'
import * as config from './messages/config'
import * as dashboard from './messages/dashboard'
import * as history from './messages/history'
import * as observe from './messages/observe'
import * as personas from './messages/personas'
import * as reports from './messages/reports'
import * as roles from './messages/roles'

export const AREAS = { common, compare, config, dashboard, history, observe, personas, reports, roles }

export const zh = {
  ...common.zh, ...compare.zh, ...config.zh, ...dashboard.zh, ...history.zh,
  ...observe.zh, ...personas.zh, ...reports.zh, ...roles.zh,
}

export type MessageKey = keyof typeof zh

export const en: Record<MessageKey, string> = {
  ...common.en, ...compare.en, ...config.en, ...dashboard.en, ...history.en,
  ...observe.en, ...personas.en, ...reports.en, ...roles.en,
}

export const MESSAGES = { zh, en } as const
