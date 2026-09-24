import { DEEPSEEK_URL, DEFAULT_DEEPSEEK_KEY, DEFAULT_DEEPSEEK_MODEL, deepseekHeaders } from './deepseek'

export const CLAUDE_URL = DEEPSEEK_URL
export const DEFAULT_AI_KEY = DEFAULT_DEEPSEEK_KEY
export const DEFAULT_AI_MODEL = DEFAULT_DEEPSEEK_MODEL

export function claudeHeaders(apiKey: string): Record<string, string> {
  return deepseekHeaders(apiKey || DEFAULT_DEEPSEEK_KEY)
}

export * from './deepseek'
