const stopped = new Set<string>()

export const stopRegistry = {
  request: (runId: string) => stopped.add(runId),
  isStopped: (runId: string) => stopped.has(runId),
  clear: (runId: string) => stopped.delete(runId),
}
