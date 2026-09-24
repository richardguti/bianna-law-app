import { DEEPSEEK_URL, DEFAULT_DEEPSEEK_KEY, deepseekHeaders, type DeepSeekMessage } from './deepseek'

/**
 * Streaming bridge for DeepSeek R1.
 *
 * R1 turns take 30–90s, so a silent request makes the app look frozen. This
 * exposes two things the UI needs:
 *   1. `onContent`  — answer tokens as they are produced (live typing).
 *   2. `onReasoning` — the model's `reasoning_content` chain-of-thought, which is
 *      genuinely instructive for law students ("show your work").
 *
 * In Electron the main process owns the SSE connection and pushes deltas over IPC
 * (preload channels ai-response-chunk / ai-response-reasoning). In a plain browser
 * dev build we stream directly instead.
 *
 * Contract: callbacks receive DELTAS; the resolved `content` is the authoritative
 * full text. Callers should render deltas live and replace with the final value.
 */
export interface StreamOptions {
  /** Full multi-turn conversation. A leading system message receives grounding context. */
  messages?: DeepSeekMessage[]
  /** Single-prompt mode (Electron composes grounding context from this). */
  prompt?: string
  systemPrompt?: string
  mode?: string
  apiKey?: string
  model?: string
  maxTokens?: number
  /** Supply your own id so the Stop button can abort this exact stream. */
  streamId?: string
  onContent?: (delta: string) => void
  onReasoning?: (delta: string) => void
  /**
   * Fired when the pipeline replaces the draft it has been streaming — the first pass
   * truncated mid-document, or ignored the house stylesheet. `reset: true` means
   * discard whatever has already been typed before accepting what arrives next.
   */
  onStage?: (stage: string, reset: boolean) => void
  /**
   * Require the finished artifact to match the house four-tier stylesheet (outlines).
   * The main process always formats when this is set, because the reasoning model does
   * not honour the tier styles on its own.
   */
  formatStrict?: boolean
}

export interface StreamOutcome {
  content: string
  reasoning: string
  /** true when the user pressed Stop — `content` holds whatever had arrived */
  aborted?: boolean
  streamId?: string
  error?: string
}

/** Unique id for a stream request (used to abort it later). */
export function newStreamId(): string {
  return `ui-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/** Ask the main process to cancel an in-flight stream (Stop button). */
export async function abortStream(streamId: string | null | undefined): Promise<void> {
  if (!streamId) return
  try { await window.seniorPartner?.aiAbort?.(streamId) } catch { /* already finished */ }
}

type Handler = { onContent?: (delta: string) => void; onReasoning?: (delta: string) => void; onStage?: (stage: string, reset: boolean) => void }

let bridgeReady = false
let active: Handler = {}

/** Register the IPC listeners once and route them to the in-flight request. */
function ensureBridge(): void {
  if (bridgeReady) return
  const sp = typeof window !== 'undefined' ? window.seniorPartner : undefined
  if (!sp?.onAiChunk || !sp?.onAiReasoning) return
  sp.onAiChunk(({ delta }) => { active.onContent?.(delta) })
  sp.onAiReasoning(({ delta }) => { active.onReasoning?.(delta) })
  // Optional: older preloads have no onAiStage, in which case the reset notice is
  // simply unavailable and the final response is still correct.
  sp.onAiStage?.(({ stage, reset }) => { if (reset) active.onStage?.(stage, true) })
  bridgeReady = true
}

/** Direct SSE consumption — used when the Electron bridge is unavailable. */
async function streamDirect(options: StreamOptions): Promise<StreamOutcome> {
  const key = options.apiKey || DEFAULT_DEEPSEEK_KEY
  const messages = options.messages?.length
    ? options.messages
    : [
        { role: 'system' as const, content: options.systemPrompt ?? '' },
        { role: 'user' as const, content: options.prompt ?? '' },
      ]

  let res: Response
  try {
    res = await fetch(DEEPSEEK_URL, {
      method: 'POST',
      headers: deepseekHeaders(key),
      body: JSON.stringify({
        model: options.model ?? 'deepseek-reasoner',
        messages,
        max_tokens: options.maxTokens ?? 16384,
        stream: true,
      }),
    })
  } catch {
    return { content: '', reasoning: '', error: 'Network error — could not reach DeepSeek API.' }
  }

  if (!res.ok || !res.body) {
    let message = `API error ${res.status}`
    try { message = (await res.json())?.error?.message ?? message } catch { /* ignore */ }
    return { content: '', reasoning: '', error: message }
  }

  const reader  = res.body.getReader()
  const decoder = new TextDecoder('utf8')
  let buffer = '', content = '', reasoning = ''

  const handleLine = (line: string) => {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) return
    const payload = trimmed.slice(5).trim()
    if (!payload || payload === '[DONE]') return
    let json: { choices?: { delta?: { content?: string; reasoning_content?: string } }[] }
    try { json = JSON.parse(payload) } catch { return }
    const delta = json.choices?.[0]?.delta
    if (!delta) return
    if (delta.reasoning_content) { reasoning += delta.reasoning_content; options.onReasoning?.(delta.reasoning_content) }
    if (delta.content) { content += delta.content; options.onContent?.(delta.content) }
  }

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let nl: number
    while ((nl = buffer.indexOf('\n')) >= 0) {
      handleLine(buffer.slice(0, nl))
      buffer = buffer.slice(nl + 1)
    }
  }
  if (buffer) handleLine(buffer)

  if (!content.trim() && !reasoning.trim()) {
    return { content: '', reasoning: '', error: 'DeepSeek returned an empty answer. Try again.' }
  }
  return { content, reasoning }
}

/** Stream a completion, using the Electron IPC bridge when available. */
export async function streamAi(options: StreamOptions): Promise<StreamOutcome> {
  const sp = typeof window !== 'undefined' ? window.seniorPartner : undefined

  if (!sp?.aiPromptStream) return streamDirect(options)

  ensureBridge()
  active = { onContent: options.onContent, onReasoning: options.onReasoning, onStage: options.onStage }
  const streamId = options.streamId ?? newStreamId()
  try {
    const res = await sp.aiPromptStream({
      prompt: options.prompt,
      systemPrompt: options.systemPrompt,
      messages: options.messages?.map(({ role, content }) => ({ role, content })),
      mode: options.mode,
      maxTokens: options.maxTokens,
      streamId,
      formatStrict: options.formatStrict,
    })
    if (!res.success) {
      return { content: '', reasoning: res.reasoning ?? '', streamId, error: res.error ?? 'DeepSeek request failed.' }
    }
    return {
      content: res.response ?? '',
      reasoning: res.reasoning ?? '',
      aborted: !!res.aborted,
      streamId: res.streamId ?? streamId,
    }
  } catch (err) {
    const msg = (err as Error).message
    if (/failed to fetch|network|load failed/i.test(msg)) {
      return { content: '', reasoning: '', streamId, error: 'Network error — could not reach DeepSeek API.' }
    }
    return { content: '', reasoning: '', streamId, error: msg }
  } finally {
    active = {}
  }
}
