import type { LiveEvent } from '@chat-arena/shared'

export interface WsHandle {
  close: () => void
  watch: (sessionId: string) => void
}

export interface WsCallbacks {
  onEvent: (e: LiveEvent) => void
  /** Called when the socket closes unexpectedly (not via handle.close()) */
  onUnexpectedClose?: () => void
  /** Called each time the socket is open (including after a reconnect) */
  onOpen?: () => void
}

// WS path is prefixed with the vite base so it still routes when the app is deployed under a sub-path;
// dev: vite proxies /ws → :4040, prod: nginx proxies /ws (see deploy/).
const WS_BASE = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '')

export function connectRunWs(runId: string, callbacks: WsCallbacks | ((e: LiveEvent) => void)): WsHandle {
  const { onEvent, onUnexpectedClose, onOpen } = typeof callbacks === 'function'
    ? { onEvent: callbacks, onUnexpectedClose: undefined, onOpen: undefined }
    : callbacks

  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  const ws = new WebSocket(`${proto}://${location.host}${WS_BASE}/ws/runs/${runId}`)
  let pendingWatch: string | null = null
  // intentional close flag — set before calling ws.close() so onclose handler knows
  let intentional = false

  ws.onopen = () => {
    if (pendingWatch !== null) {
      ws.send(JSON.stringify({ type: 'watch', sessionId: pendingWatch }))
      pendingWatch = null
    }
    onOpen?.()
  }

  ws.onmessage = (ev) => {
    try {
      onEvent(JSON.parse(ev.data as string) as LiveEvent)
    } catch {
      /* ignore */
    }
  }

  ws.onerror = () => {
    // onerror is always followed by onclose; let onclose handle the callback
  }

  ws.onclose = () => {
    if (!intentional) {
      onUnexpectedClose?.()
    }
  }

  return {
    close: () => { intentional = true; ws.close() },
    watch: (sessionId: string) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'watch', sessionId }))
      } else {
        pendingWatch = sessionId
      }
    },
  }
}
