import { afterEach, describe, expect, test } from "bun:test"
import { ApiError, apiRequest } from "../src/helpers"

// The body reader is bounded by a stream accumulator, not response.text() plus a
// slice: a huge or hostile body must not fill memory. A successful body over the
// cap is an error, never a truncated body that then fails to parse; an error
// body keeps only its first 500 characters and stops reading.

const originalFetch = globalThis.fetch
const originalSetTimeout = globalThis.setTimeout

afterEach(() => {
  globalThis.fetch = originalFetch
  globalThis.setTimeout = originalSetTimeout
})

/** Serve `chunk` exactly `chunks` times, and note whether the reader was cancelled. */
function streamedResponse(chunk: string, chunks: number, status = 200): { response: Response; state: { cancelled: boolean; chunksRead: number } } {
  const state = { cancelled: false, chunksRead: 0 }
  let sent = 0
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= chunks) {
        controller.close()
        return
      }
      sent++
      state.chunksRead++
      controller.enqueue(encoder.encode(chunk))
    },
    cancel() {
      state.cancelled = true
    },
  })
  return { response: new Response(stream, { status }), state }
}

describe("bounded response body", () => {
  test("a successful body past 20 MB is HTTP_ERROR, not a truncated parse", async () => {
    // 21 chunks of 1,000,000 characters: past the 20,000,000-character cap.
    const { response } = streamedResponse("x".repeat(1_000_000), 21)
    globalThis.fetch = (async () => response) as unknown as typeof fetch
    let err: unknown
    try {
      await apiRequest("/datasets/x/items", { token: "t" })
    } catch (e) {
      err = e
    }
    expect(err instanceof ApiError).toBe(true)
    expect((err as ApiError).code).toBe("HTTP_ERROR")
    expect((err as ApiError).message).toContain("exceeded")
  })

  test("a successful body within the cap is returned whole", async () => {
    const body = JSON.stringify({ data: { id: "r1", status: "SUCCEEDED" } })
    const encoder = new TextEncoder()
    const parts = [body.slice(0, 10), body.slice(10, 20), body.slice(20)]
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const part of parts) controller.enqueue(encoder.encode(part))
        controller.close()
      },
    })
    globalThis.fetch = (async () => new Response(stream, { status: 200 })) as unknown as typeof fetch
    expect(await apiRequest("/x", { token: "t" })).toBe(body)
  })

  test("an error body keeps only the first 500 characters and cancels the stream", async () => {
    const { response, state } = streamedResponse("E".repeat(1000), 10, 400)
    globalThis.fetch = (async () => response) as unknown as typeof fetch
    let err: ApiError | undefined
    try {
      await apiRequest("/x", { token: "t" })
    } catch (e) {
      err = e as ApiError
    }
    expect(err?.code).toBe("HTTP_ERROR")
    // The message is the status line plus at most the 500-character body.
    expect(err!.message.endsWith("E".repeat(500))).toBe(true)
    expect(err!.message).not.toContain("E".repeat(501))
    // Reading stopped early instead of draining all ten chunks.
    expect(state.cancelled).toBe(true)
    expect(state.chunksRead).toBeLessThan(10)
  })

  test("multi-byte characters split across chunks decode intact", async () => {
    const encoder = new TextEncoder()
    const bytes = encoder.encode('{"t":"中文"}')
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        // One byte per chunk: every multi-byte character is split.
        for (const b of bytes) controller.enqueue(new Uint8Array([b]))
        controller.close()
      },
    })
    globalThis.fetch = (async () => new Response(stream, { status: 200 })) as unknown as typeof fetch
    expect(await apiRequest("/x", { token: "t" })).toBe('{"t":"中文"}')
  })
})
