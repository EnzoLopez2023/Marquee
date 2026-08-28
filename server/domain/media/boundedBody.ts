export async function readBoundedResponseBody(response: Response, maxBytes: number) {
  if (!response.body) return Buffer.alloc(0)
  const reader = response.body.getReader()
  const chunks: Buffer[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel('response body exceeds limit')
        throw new Error('RESPONSE_BODY_TOO_LARGE')
      }
      chunks.push(Buffer.from(value))
    }
    return Buffer.concat(chunks, total)
  } finally {
    reader.releaseLock()
  }
}

export async function cancelResponseBody(response: Response) {
  if (!response.body) return
  try {
    await response.body.cancel('response rejected before consumption')
  } catch {
    // A body already closed by the upstream implementation needs no cleanup.
  }
}
