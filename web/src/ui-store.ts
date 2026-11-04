import { create } from 'zustand'

// 轻量 UI 状态：跨页面共享（报告页触发生成 → 左侧栏「优化报告」显示生成中红点）。
// 用 store 而非组件内 state，是为了在切走报告页后红点仍能正确反映生成进度并自动消失。
//
// runId: 当前活跃 Run 的 ID，从 sessionStorage 初始化，setter 同步写回 sessionStorage。
// 用 store 而非直接读 sessionStorage，是为了让跨页切换 run 时（History → Dashboard/Observe/Reports）
// 订阅方能响应式地重新加载数据，而 sessionStorage 写入不触发任何事件。
interface UiState {
  reportGenerating: boolean
  setReportGenerating: (v: boolean) => void
  runId: string | null
  setRunId: (id: string | null) => void
}

export const useUi = create<UiState>((set) => ({
  reportGenerating: false,
  setReportGenerating: (v) => set({ reportGenerating: v }),
  runId: sessionStorage.getItem('runId'),
  setRunId: (id) => {
    if (id === null) {
      sessionStorage.removeItem('runId')
    } else {
      sessionStorage.setItem('runId', id)
    }
    set({ runId: id })
  },
}))
