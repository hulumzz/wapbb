import { lookup } from 'node:dns/promises'
import { request as httpsRequest } from 'node:https'
import { request as httpRequest } from 'node:http'
import ipaddr from 'ipaddr.js'
import sharp from 'sharp'
import { getPreviewFromContent } from 'link-preview-js'
import { prepareWAMessageMedia, type WAUrlInfo, type WAMediaUploadFunction } from '@whiskeysockets/baileys'

export function isPublicAddress(address: string): boolean {
  try { return ipaddr.process(address).range() === 'unicast' } catch { return false }
}

// Pin the validated DNS result to the actual connection, including every redirect.
// Untrusted og:image URLs must not be handed directly to Baileys' HTTP downloader.
async function download(url: string, deadline: number, maxBytes: number, redirects = 0): Promise<{ data: Buffer; contentType: string; url: string }> {
  const target = new URL(url)
  if (!['https:', 'http:'].includes(target.protocol) || target.username || target.password || (target.port && !['80','443'].includes(target.port))) throw new Error('Unsafe preview URL')
  const hostname = target.hostname.replace(/^\[|\]$/g, '')
  const addresses = await lookup(hostname, { all: true })
  if (!addresses.length || addresses.some((address) => !isPublicAddress(address.address)) || Date.now() >= deadline) throw new Error('Unsafe preview address')
  const selected = addresses[0]
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => req.destroy(new Error('Preview timeout')), Math.max(1, deadline - Date.now()))
    const req = (target.protocol === 'https:' ? httpsRequest : httpRequest)(target, {
      headers: { 'user-agent': 'SIDDes/1.0 link preview', 'accept-encoding': 'identity' },
      lookup: (_name, options, callback) => { if (options.all) callback(null, [selected]); else callback(null, selected.address, selected.family) },
    }, (response) => {
      if ((response.statusCode ?? 0) >= 300 && (response.statusCode ?? 0) < 400) {
        response.resume(); clearTimeout(timer)
        if (!response.headers.location || redirects >= 3) return reject(new Error('Preview redirect limit'))
        void download(new URL(response.headers.location, target).href, deadline, maxBytes, redirects + 1).then(resolve, reject)
        return
      }
      if (response.statusCode !== 200) { response.resume(); clearTimeout(timer); reject(new Error('Preview source unavailable')); return }
      let length = 0; const chunks: Buffer[] = []
      response.on('data', (chunk: Buffer) => { length += chunk.length; if (length > maxBytes) req.destroy(new Error('Preview too large')); else chunks.push(chunk) })
      response.on('error', (error) => { clearTimeout(timer); reject(error) })
      response.on('end', () => { clearTimeout(timer); resolve({ data: Buffer.concat(chunks), contentType: String(response.headers['content-type'] ?? ''), url: target.href }) })
    })
    req.on('error', (error) => { clearTimeout(timer); reject(error) }); req.end()
  })
}

export async function generateSafeLinkPreview(url: string, upload: WAMediaUploadFunction): Promise<WAUrlInfo | undefined> {
  try {
    const deadline = Date.now() + 3000
    const page = await download(url, deadline, 1024 * 1024)
    if (!page.contentType.startsWith('text/html')) return undefined
    const info = await getPreviewFromContent({ url: page.url, headers: { 'content-type': page.contentType }, data: page.data.toString('utf8') })
    if (!('title' in info) || !info.title) return undefined
    const preview: WAUrlInfo = { 'canonical-url': page.url, 'matched-text': url, title: info.title, description: info.description }
    try {
      if (info.images[0] && Date.now() < deadline) {
        const image = await download(new URL(info.images[0], page.url).href, deadline, 2 * 1024 * 1024)
        if (!/^image\/(png|jpeg|webp)(;|$)/i.test(image.contentType)) return preview
        const thumbnail = await sharp(image.data, { limitInputPixels: 10_000_000 }).resize(192, 192, { fit: 'inside', withoutEnlargement: true }).jpeg().toBuffer()
        const prepared = await prepareWAMessageMedia({ image: thumbnail }, { upload, mediaTypeOverride: 'thumbnail-link', mediaUploadTimeoutMs: 3000 })
        preview.jpegThumbnail = prepared.imageMessage?.jpegThumbnail ? Buffer.from(prepared.imageMessage.jpegThumbnail) : undefined
        preview.highQualityThumbnail = prepared.imageMessage ?? undefined
      }
    } catch { /* Thumbnail failures preserve the text/link metadata. */ }
    return preview
  } catch { return undefined }
}
