import type { AnyMessageContent } from '@whiskeysockets/baileys'

const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024

export type RemoteImage = {
  data: Buffer
  mimetype: string
}

export class RemoteImageError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(message)
    this.name = 'RemoteImageError'
  }
}

type FetchImageOptions = {
  timeoutMs?: number
  maxBytes?: number
  fetchImpl?: typeof fetch
}

export async function fetchRemoteImage(url: string, options: FetchImageOptions = {}): Promise<RemoteImage> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  const fetchImpl = options.fetchImpl ?? fetch
  let response: Response

  try {
    response = await fetchImpl(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'user-agent': 'WAPBB/1.0 WhatsApp banner fetcher' },
    })
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
    throw new RemoteImageError(
      timedOut ? 'Pengambilan banner melewati batas waktu' : 'Banner campaign tidak dapat diambil dari sumber media',
      timedOut ? 'BANNER_FETCH_TIMEOUT' : 'BANNER_FETCH_FAILED',
      true,
    )
  }

  if (!response.ok) {
    throw new RemoteImageError(
      `Sumber banner merespons HTTP ${response.status}`,
      'BANNER_FETCH_HTTP_ERROR',
      response.status >= 500 || response.status === 429,
    )
  }

  const mimetype = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() ?? ''
  if (!mimetype.startsWith('image/')) {
    throw new RemoteImageError('Sumber banner tidak mengembalikan media gambar', 'BANNER_INVALID_CONTENT_TYPE', false)
  }

  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new RemoteImageError('Ukuran banner melebihi batas 5 MB', 'BANNER_TOO_LARGE', false)
  }

  const data = Buffer.from(await response.arrayBuffer())
  if (!data.length) throw new RemoteImageError('Sumber banner mengembalikan file kosong', 'BANNER_EMPTY', false)
  if (data.length > maxBytes) throw new RemoteImageError('Ukuran banner melebihi batas 5 MB', 'BANNER_TOO_LARGE', false)

  return { data, mimetype }
}

export function createImageMessageContent(image: RemoteImage, caption: string): AnyMessageContent {
  return {
    image: image.data,
    mimetype: image.mimetype,
    caption,
  }
}
