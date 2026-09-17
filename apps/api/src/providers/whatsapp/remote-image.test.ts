import assert from 'node:assert/strict'
import test from 'node:test'
import { createImageMessageContent, fetchRemoteImage, RemoteImageError } from './remote-image.js'

test('mengambil image dan membentuk payload Baileys image + caption', async () => {
  const bytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])
  const image = await fetchRemoteImage('https://media.example/banner.png', {
    fetchImpl: async () => new Response(bytes, {
      status: 200,
      headers: { 'content-type': 'image/png', 'content-length': String(bytes.length) },
    }),
  })

  const content = createImageMessageContent(image, 'Halo Ahmad, ini pengingat PBB.')
  assert.deepEqual(image.data, Buffer.from(bytes))
  assert.equal(image.mimetype, 'image/png')
  assert.ok('image' in content)
  assert.equal(content.caption, 'Halo Ahmad, ini pengingat PBB.')
  assert.equal(content.mimetype, 'image/png')
  assert.ok(Buffer.isBuffer(content.image))
})

test('menolak respons banner yang bukan image dengan error permanen yang jelas', async () => {
  await assert.rejects(
    fetchRemoteImage('https://media.example/banner.png', {
      fetchImpl: async () => new Response('<html>error</html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    }),
    (error: unknown) => error instanceof RemoteImageError
      && error.code === 'BANNER_INVALID_CONTENT_TYPE'
      && error.retryable === false,
  )
})

test('menandai kegagalan server sumber banner sebagai retryable', async () => {
  await assert.rejects(
    fetchRemoteImage('https://media.example/banner.png', {
      fetchImpl: async () => new Response(null, { status: 503 }),
    }),
    (error: unknown) => error instanceof RemoteImageError
      && error.code === 'BANNER_FETCH_HTTP_ERROR'
      && error.retryable === true,
  )
})

test('menghentikan chunked banner sebelum buffer melewati batas', async () => {
  let cancelled = false
  const stream = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(1024)) }, cancel() { cancelled = true } })
  await assert.rejects(fetchRemoteImage('https://media.example/image.png', { maxBytes: 1500, fetchImpl: async () => new Response(stream, { headers: { 'content-type': 'image/png' } }) }), (e: unknown) => e instanceof RemoteImageError && e.code === 'BANNER_TOO_LARGE')
  assert.equal(cancelled, true)
})
test('body yang rusak dicatat sebagai error media retryable', async () => {
  const stream = new ReadableStream({ start(controller) { controller.error(new Error('connection lost')) } })
  await assert.rejects(fetchRemoteImage('https://media.example/image.png', { fetchImpl: async () => new Response(stream, { headers: { 'content-type': 'image/png' } }) }), (e: unknown) => e instanceof RemoteImageError && e.code === 'BANNER_BODY_FAILED')
})
