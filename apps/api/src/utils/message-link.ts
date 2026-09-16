const HTTPS_URL = /https:\/\/[^\s<>"']+/i
const TRAILING_PUNCTUATION = /[.,!?;:]+$/

export function extractHttpsUrl(text: string): string | undefined {
  const candidate = text.match(HTTPS_URL)?.[0]?.replace(TRAILING_PUNCTUATION, '')
  if (!candidate) return undefined

  try {
    const parsed = new URL(candidate)
    return parsed.protocol === 'https:' ? parsed.toString() : undefined
  } catch {
    return undefined
  }
}
