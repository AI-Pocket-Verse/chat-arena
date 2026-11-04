// 「dashboard」区域的界面文案（含 charts.tsx 的图表空态）。key 一律以 `dashboard.` 开头；中文是原有文案（与改造前逐字一致），英文逐条对应。
// en 的类型是 Record<keyof typeof zh, string>：漏翻一条会直接编译失败。

export const zh = {
  'dashboard.title': '数据看板',
  'dashboard.runPlaceholder': '选择要查看的评测',
  'dashboard.noRun': '暂无选中的评测。从右上角选择一次评测，或先在配置页创建。',
  'dashboard.loadFailed': '看板数据加载失败',

  'dashboard.dim.personaFit': '人设贴合',
  'dashboard.dim.empathy': '情感共情',
  'dashboard.dim.memoryAccuracy': '记忆准确',
  'dashboard.dim.safety': '安全合规',
  'dashboard.dim.naturalness': '自然流畅',
  'dashboard.dim.relevance': '相关性',

  'dashboard.grade.excellent': '优秀 (≥8)',
  'dashboard.grade.good': '良好 [6,8)',
  'dashboard.grade.fair': '一般 [4,6)',
  'dashboard.grade.weak': '偏弱 (<4)',

  'dashboard.metric.sessions': '会话数',
  'dashboard.metric.turns': '总轮数',
  'dashboard.metric.scoreCoverage': '评分覆盖',
  'dashboard.metric.avgOverall': '平均综合分',
  'dashboard.metric.maxScore': '最高分',
  'dashboard.metric.minScore': '最低分',
  'dashboard.metric.avgFirstToken': '平均首字延迟',
  'dashboard.metric.avgTurnTime': '平均单轮耗时',
  'dashboard.metric.avgReplyLen': '平均回复字数',
  'dashboard.metric.memoryHit': '记忆命中',
  'dashboard.metric.errorRate': '报错率',
  'dashboard.metric.violations': '违规数',

  'dashboard.card.scoreTrend': '每轮综合分趋势',
  'dashboard.card.scoreTrendHint': '{n} 个有效评分 · 满分 10',
  'dashboard.card.gradeShare': '评分档位占比',
  'dashboard.card.gradeShareHint': '共 {n} 轮',
  'dashboard.card.avgScore': '平均分',
  'dashboard.card.dimMeans': '各维度均值',
  'dashboard.card.dimMeansHint': '满分 10',
  'dashboard.card.latencyTrend': '首字延迟趋势',
  'dashboard.card.latencyTrendHint': '{n} 轮 · 单位 ms',

  'dashboard.chart.noData': '暂无数据',
  'dashboard.chart.noScoreData': '暂无评分数据',
  'dashboard.chart.noDims': '暂无足够维度',
} satisfies Record<string, string>

export const en: Record<keyof typeof zh, string> = {
  'dashboard.title': 'Dashboard',
  'dashboard.runPlaceholder': 'Select an evaluation to view',
  'dashboard.noRun': 'No evaluation selected. Pick one at the top right, or create one on the New evaluation page first.',
  'dashboard.loadFailed': 'Failed to load dashboard data',

  'dashboard.dim.personaFit': 'Persona fit',
  'dashboard.dim.empathy': 'Empathy',
  'dashboard.dim.memoryAccuracy': 'Memory accuracy',
  'dashboard.dim.safety': 'Safety',
  'dashboard.dim.naturalness': 'Naturalness',
  'dashboard.dim.relevance': 'Relevance',

  'dashboard.grade.excellent': 'Great (≥8)',
  'dashboard.grade.good': 'Good [6,8)',
  'dashboard.grade.fair': 'Fair [4,6)',
  'dashboard.grade.weak': 'Weak (<4)',

  'dashboard.metric.sessions': 'Sessions',
  'dashboard.metric.turns': 'Total turns',
  'dashboard.metric.scoreCoverage': 'Scored',
  'dashboard.metric.avgOverall': 'Avg. overall',
  'dashboard.metric.maxScore': 'Highest',
  'dashboard.metric.minScore': 'Lowest',
  'dashboard.metric.avgFirstToken': 'Avg. first-token latency',
  'dashboard.metric.avgTurnTime': 'Avg. turn time',
  'dashboard.metric.avgReplyLen': 'Avg. reply length',
  'dashboard.metric.memoryHit': 'Memory hits',
  'dashboard.metric.errorRate': 'Error rate',
  'dashboard.metric.violations': 'Violations',

  'dashboard.card.scoreTrend': 'Overall score per turn',
  'dashboard.card.scoreTrendHint': 'Valid scores: {n} · max 10',
  'dashboard.card.gradeShare': 'Score distribution',
  'dashboard.card.gradeShareHint': 'Total turns: {n}',
  'dashboard.card.avgScore': 'Avg. score',
  'dashboard.card.dimMeans': 'Average by dimension',
  'dashboard.card.dimMeansHint': 'Max 10',
  'dashboard.card.latencyTrend': 'First-token latency',
  'dashboard.card.latencyTrendHint': 'Turns: {n} · unit: ms',

  'dashboard.chart.noData': 'No data',
  'dashboard.chart.noScoreData': 'No score data',
  'dashboard.chart.noDims': 'Not enough dimensions',
}
