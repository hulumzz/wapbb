const OMIT = new Set(['jpegThumbnail', 'thumbnail', 'thumbnailDirectPath', 'thumbnailSha256', 'thumbnailEncSha256'])
export function stripMediaBytes<T>(value: T): T {
  if (value instanceof Uint8Array) return value
  if (Array.isArray(value)) return value.map(stripMediaBytes) as T
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).filter(([key]) => !OMIT.has(key)).map(([key, child]) => [key, stripMediaBytes(child)])) as T
}
