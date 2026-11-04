import type { FastifyInstance } from 'fastify'
import { liveBus } from '../live/live-bus'

export async function wsRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { id: string } }>('/ws/runs/:id', { websocket: true }, (socket, req) => {
    const runId = req.params.id
    liveBus.subscribe(runId, socket as unknown as { readyState: number; send: (s: string) => void })

    socket.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as { type?: string; sessionId?: string }
        // client sends {type:'watch',sessionId} to switch observed session
        if (msg.type === 'watch' && typeof msg.sessionId === 'string') {
          liveBus.setWatch(socket as never, msg.sessionId)
        }
      } catch { /* ignore malformed */ }
    })

    socket.on('close', () => liveBus.unsubscribe(socket as never))
    // handle socket errors so the connection is cleaned up even on abrupt disconnect
    socket.on('error', () => liveBus.unsubscribe(socket as never))
  })
}
