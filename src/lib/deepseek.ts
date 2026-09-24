export const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions'
// The key is NOT stored in source. It is injected at build time from a gitignored
// .env.local (local builds) or the DEEPSEEK_KEY repository secret (CI) -- see
// .env.example. Vite inlines VITE_* values into the bundle; nothing lands in git.
// If no key was injected, this is empty and the student can paste her own in
// Settings, which is the correct fallback rather than a credential in the repo.
export const DEFAULT_DEEPSEEK_KEY = import.meta.env.VITE_DEEPSEEK_KEY ?? ''
export const DEFAULT_DEEPSEEK_MODEL = 'deepseek-reasoner' // DeepSeek R1 reasoning model

export function deepseekHeaders(apiKey: string): Record<string, string> {
  const key = apiKey || DEFAULT_DEEPSEEK_KEY
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${key.trim()}`,
  }
}

export interface DeepSeekMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface CallDeepSeekOptions {
  apiKey?: string
  messages: DeepSeekMessage[]
  model?: string
  maxTokens?: number
  temperature?: number
}

export async function callDeepSeek(options: CallDeepSeekOptions): Promise<{
  content: string
  reasoningContent?: string
}> {
  const {
    apiKey = DEFAULT_DEEPSEEK_KEY,
    messages,
    model = DEFAULT_DEEPSEEK_MODEL,
    maxTokens = 8192,
  } = options

  // DeepSeek R1 (deepseek-reasoner) writes an internal chain-of-thought to
  // `reasoning_content` before emitting the final `content`. On some prompts the
  // reasoning pass consumes the whole output budget and the turn comes back with
  // empty `content`. Retry once with an escalated budget, then fall back to the
  // tail of the reasoning trace so callers always receive usable text.
  const budgets = [maxTokens, Math.min(maxTokens * 2, 32768)]
  let lastReasoning = ''

  for (const budget of budgets) {
    const res = await fetch(DEEPSEEK_URL, {
      method: 'POST',
      headers: deepseekHeaders(apiKey),
      body: JSON.stringify({
        model,
        messages,
        max_tokens: budget,
      }),
    })

    if (!res.ok) {
      let errMsg = `API error ${res.status}`
      try {
        const errData = await res.json()
        errMsg = errData.error?.message || errMsg
      } catch { /* empty */ }
      throw new Error(errMsg)
    }

    const data = await res.json()
    const choice = data.choices?.[0]?.message
    if (choice?.content) {
      return { content: choice.content, reasoningContent: choice.reasoning_content }
    }
    lastReasoning = choice?.reasoning_content || lastReasoning
  }

  const trace = lastReasoning.trim()
  if (trace) {
    return { content: trace.length > 12000 ? trace.slice(-12000) : trace, reasoningContent: trace }
  }

  throw new Error('Empty response from DeepSeek API.')
}

/**
 * Convenience wrapper around callDeepSeek that returns only the final answer
 * text. Keeps every caller on the same hardened path (budget escalation +
 * reasoning-trace salvage) instead of hand-rolling a bare fetch.
 */
export async function deepseekComplete(
  messages: DeepSeekMessage[],
  options: { apiKey?: string; model?: string; maxTokens?: number } = {},
): Promise<string> {
  const { content } = await callDeepSeek({ ...options, messages })
  return content
}
