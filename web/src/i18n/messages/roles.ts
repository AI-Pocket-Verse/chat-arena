// 「roles」区域的界面文案。key 一律以 `roles.` 开头；中文是原有文案（与改造前逐字一致），英文逐条对应。
// en 的类型是 Record<keyof typeof zh, string>：漏翻一条会直接编译失败。

export const zh = {
  'roles.title': '角色库',
  'roles.loading': '加载中…',
  'roles.loadFailed': '角色库加载失败',
  'roles.empty': '暂无角色数据。',

  'roles.gender.male': '男',
  'roles.gender.female': '女',
  'roles.age': '{age} 岁',

  'roles.anchor.persona': '完整设定',
  'roles.anchor.rendered': '完整渲染',
  'roles.anchor.chat': '聊天人设',

  'roles.section.persona': '完整设定（7 段基础 prompt）',
  'roles.section.rendered': '完整渲染 prompt',
  'roles.section.chat': '聊天人设',

  'roles.persona.identityBase': '你是谁',
  'roles.persona.relationshipBase': '关系定位',
  'roles.persona.dailyStyle': '日常风格',
  'roles.persona.emotionSupport': '情绪陪伴',
  'roles.persona.mediaPolicy': '图片表达',
  'roles.persona.realityBoundary': '现实边界',
  'roles.persona.safetyBoundary': '安全边界',
} satisfies Record<string, string>

export const en: Record<keyof typeof zh, string> = {
  'roles.title': 'AI roles',
  'roles.loading': 'Loading…',
  'roles.loadFailed': 'Failed to load roles',
  'roles.empty': 'No roles yet.',

  'roles.gender.male': 'Male',
  'roles.gender.female': 'Female',
  'roles.age': '{age} yrs',

  'roles.anchor.persona': 'Full persona',
  'roles.anchor.rendered': 'Rendered prompt',
  'roles.anchor.chat': 'Chat persona',

  'roles.section.persona': 'Full persona (7 base prompt sections)',
  'roles.section.rendered': 'Rendered prompt',
  'roles.section.chat': 'Chat persona',

  'roles.persona.identityBase': 'Who you are',
  'roles.persona.relationshipBase': 'Relationship',
  'roles.persona.dailyStyle': 'Daily style',
  'roles.persona.emotionSupport': 'Emotional support',
  'roles.persona.mediaPolicy': 'Image expression',
  'roles.persona.realityBoundary': 'Reality boundary',
  'roles.persona.safetyBoundary': 'Safety boundary',
}
