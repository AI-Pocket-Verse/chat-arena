// 「observe」区域的界面文案。key 一律以 `observe.` 开头；中文是原有文案（与改造前逐字一致），英文逐条对应。
// en 的类型是 Record<keyof typeof zh, string>：漏翻一条会直接编译失败。

export const zh = {
  'observe.title': '实时评测',
  'observe.badge.replay': '历史回放',
  'observe.defaultUser': '用户',
  'observe.defaultTarget': '被测 AI',

  'observe.turn.label': '对话 · 第 {n} 轮',
  'observe.score.title': '评分',
  'observe.score.pending': '评分中…',
  'observe.score.judgeError': '裁判异常：{error}',
  'observe.score.violation': '违规',
  'observe.score.suggestion': '改进',

  'observe.stop': '终止',
  'observe.stopping': '终止中…',
  'observe.stop.confirmTitle': '终止本次评测？',
  'observe.stop.confirmMessage': '已产生的对话与评分会保留，未跑完的会话将停止。',

  'observe.multi.start': '生成图片',
  'observe.multi.selected': '已选 {n} 条',
  'observe.multi.selectAll': '全选',
  'observe.multi.clear': '清空',
  'observe.multi.generating': '生成中…',
  'observe.multi.exit': '退出',
  'observe.multi.hint': '多选模式：点击对话卡片勾选要导出的内容，选好后点右上角「生成图片」。',
  'observe.multi.notExportable': '回复生成中，暂不可导出',

  'observe.ws.disconnected': '实时连接已断开，正在依赖轮询兜底；后台尝试重连中…',

  'observe.cta.title': '当前没有正在进行的评测',
  'observe.cta.hintNew': '去「新建评测」设置参数并开启一次新的评测吧。',
  'observe.cta.hintHistory': '想回看已结束的对话，可在「评测记录」页选择。',
  'observe.cta.button': '新建评测',

  'observe.failed.title': '本次运行失败',
  'observe.failed.noTurns': '未产生任何对话。',
  'observe.failed.hint': '常见原因：所选「模拟用户模型 / 裁判模型」在当前环境不可用，或被测 AI 连接失败。请回到配置页改用已配置 key 的模型后重试。',
  'observe.finishedEmpty.title': '本次运行已结束，但没有产生任何对话',
  'observe.finishedEmpty.hint': '通常是所选模型不可用或被测 AI 连接失败。请在配置页检查模型与连接后重试。',
  'observe.waiting': '运行中，正在等待第一条消息…（首轮需依次生成用户消息 → 角色回复 → 评分，稍候即可；若长时间无任何内容，多为模型调用慢/失败或实时连接异常）',
  'observe.empty': '在配置页创建一个 Run 后，对话将在这里实时显示',

  'observe.scroll.top': '回到顶部',
  'observe.scroll.bottom': '回到底部',
  'observe.scroll.bottomNew': '有新回复 · 回到底部',

  'observe.gen.allStreaming': '所选轮次均在生成中，请等待回复完成后再导出',
  'observe.gen.nodeNotReady': '生成失败：导出节点未就绪，请重试',
  'observe.gen.noBlob': '生成失败：浏览器未能导出图片，请重试或减少选中条数',
  'observe.gen.failed': '生成失败：{error}',

  'observe.tooTall.title': '内容过多，超出单张图片高度上限',
  'observe.tooTall.message': '当前选中 {count} 条，预估高度约 {height}px，超过单张图片上限 {max}px。',
  'observe.tooTall.hint': '请取消勾选几条后，再点击「生成图片」重新生成。',
  'observe.tooTall.confirm': '去取消勾选',

  'observe.export.title': '模拟评测',
  'observe.export.total': '共 {n} 条',
  'observe.preview.title': '图片已生成（{n} 条）',
  'observe.preview.alt': '评测内容图片',
  'observe.preview.copied': '已复制 ✓',
  'observe.preview.copy': '复制图片',
  'observe.preview.download': '下载',
  'observe.preview.copyUnsupported': '当前浏览器不支持复制图片，请改用「下载」或右键图片另存。',
  'observe.preview.rightClick': '右键图片可另存',
  'observe.preview.fileCount': '{n}条',
} satisfies Record<string, string>

export const en: Record<keyof typeof zh, string> = {
  'observe.title': 'Live evaluation',
  'observe.badge.replay': 'Replay',
  'observe.defaultUser': 'User',
  'observe.defaultTarget': 'AI under test',

  'observe.turn.label': 'Chat · Turn {n}',
  'observe.score.title': 'Score',
  'observe.score.pending': 'Scoring…',
  'observe.score.judgeError': 'Judge error: {error}',
  'observe.score.violation': 'Violation',
  'observe.score.suggestion': 'Suggestion',

  'observe.stop': 'Stop',
  'observe.stopping': 'Stopping…',
  'observe.stop.confirmTitle': 'Stop this evaluation?',
  'observe.stop.confirmMessage': 'Existing chats and scores are kept. Unfinished sessions will be stopped.',

  'observe.multi.start': 'Export image',
  'observe.multi.selected': '{n} selected',
  'observe.multi.selectAll': 'Select all',
  'observe.multi.clear': 'Clear',
  'observe.multi.generating': 'Generating…',
  'observe.multi.exit': 'Exit',
  'observe.multi.hint': 'Multi-select mode: click chat cards to pick what to export, then click "Export image" at the top right.',
  'observe.multi.notExportable': 'Reply is still being generated and cannot be exported yet',

  'observe.ws.disconnected': 'Live connection lost. Falling back to polling and trying to reconnect in the background…',

  'observe.cta.title': 'No evaluation is running',
  'observe.cta.hintNew': 'Go to "New evaluation" to set parameters and start one.',
  'observe.cta.hintHistory': 'To revisit finished chats, pick one on the "Runs" page.',
  'observe.cta.button': 'New evaluation',

  'observe.failed.title': 'This run failed',
  'observe.failed.noTurns': 'No chats were produced.',
  'observe.failed.hint': 'Common causes: the selected user simulator or judge model is unavailable in this environment, or the connection to the AI under test failed. Go back to the config page, pick a model with a configured key, and try again.',
  'observe.finishedEmpty.title': 'This run finished without producing any chats',
  'observe.finishedEmpty.hint': 'Usually the selected model is unavailable or the connection to the AI under test failed. Check the models and connection on the config page and try again.',
  'observe.waiting': 'Running, waiting for the first message… (the first turn generates the user message, the role reply and the score in order, so please wait a moment; if nothing shows up for a long time, the model call is likely slow or failing, or the live connection is down)',
  'observe.empty': 'Create a run on the config page and its chats will show up here in real time',

  'observe.scroll.top': 'Back to top',
  'observe.scroll.bottom': 'Back to bottom',
  'observe.scroll.bottomNew': 'New replies · Back to bottom',

  'observe.gen.allStreaming': 'All selected turns are still being generated. Wait for the replies to finish before exporting.',
  'observe.gen.nodeNotReady': 'Export failed: the export node is not ready. Please try again.',
  'observe.gen.noBlob': 'Export failed: the browser could not render the image. Try again or select fewer turns.',
  'observe.gen.failed': 'Export failed: {error}',

  'observe.tooTall.title': 'Too much content for one image',
  'observe.tooTall.message': 'Selected: {count}. Estimated height about {height}px, over the single-image limit of {max}px.',
  'observe.tooTall.hint': 'Deselect a few turns, then click "Export image" again.',
  'observe.tooTall.confirm': 'Deselect turns',

  'observe.export.title': 'Chat Arena',
  'observe.export.total': 'Total: {n}',
  'observe.preview.title': 'Image generated ({n})',
  'observe.preview.alt': 'Evaluation content image',
  'observe.preview.copied': 'Copied ✓',
  'observe.preview.copy': 'Copy image',
  'observe.preview.download': 'Download',
  'observe.preview.copyUnsupported': 'This browser cannot copy images. Use "Download" or right-click the image to save it.',
  'observe.preview.rightClick': 'Right-click the image to save it',
  'observe.preview.fileCount': '{n}-turns',
}
