export const CLAUDE_URL = 'https://api.anthropic.com/v1/messages'

export function claudeHeaders(apiKey: string): Record<string, string> {
  return {
    'x-api-key':                                 apiKey,
    'anthropic-version':                         '2023-06-01',
    'content-type':                              'application/json',
    'anthropic-dangerous-direct-browser-access': 'true',
  }
}
