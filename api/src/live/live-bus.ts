import type { LiveEvent } from '../engine/live-events'

interface SocketLike {
  readyState: number
  send: (data: string) => void
}

export class LiveBus {
  private byRun = new Map<string, Set<SocketLike>>()
  private watchMap = new Map<SocketLike, string>()   // socket → watched sessionId
  // track which runId each socket belongs to, for GC in unsubscribe
  private socketRun = new Map<SocketLike, string>()

  subscribe(runId: string, socket: SocketLike): void {
    let set = this.byRun.get(runId)
    if (!set) {
      set = new Set()
      this.byRun.set(runId, set)
    }
    set.add(socket)
    this.socketRun.set(socket, runId)
  }

  // client sends {type:'watch',sessionId} → server calls setWatch
  setWatch(socket: SocketLike, sessionId: string): void {
    this.watchMap.set(socket, sessionId)
  }

  // unsubscribe cleans up byRun Set when empty; also clears socketRun
  unsubscribe(socket: SocketLike): void {
    const runId = this.socketRun.get(socket)
    if (runId !== undefined) {
      const set = this.byRun.get(runId)
      if (set) {
        set.delete(socket)
        if (set.size === 0) this.byRun.delete(runId)
      }
      this.socketRun.delete(socket)
    } else {
      // fallback: scan all runs (handles sockets subscribed before this fix)
      for (const [rid, set] of this.byRun) {
        set.delete(socket)
        if (set.size === 0) this.byRun.delete(rid)
      }
    }
    this.watchMap.delete(socket)
  }

  emit(runId: string, event: LiveEvent): void {
    const set = this.byRun.get(runId)
    if (!set) return
    const payload = JSON.stringify(event)
    for (const s of set) {
      if (s.readyState !== 1) continue
      // delta events filtered per-connection watch state
      if (event.type === 'turn.target.delta') {
        const watched = this.watchMap.get(s)
        if (watched !== event.sessionId) continue
      }
      // on session.started, auto-assign watch for sockets that have no watch yet
      if (event.type === 'session.started') {
        if (!this.watchMap.has(s)) {
          this.watchMap.set(s, event.sessionId)
        }
      }
      try {
        s.send(payload)
      } catch {
        /* disconnect handled by ws 'close' / 'error' event */
      }
    }
  }
}

export const liveBus = new LiveBus()
