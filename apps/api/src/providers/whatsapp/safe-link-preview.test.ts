import test from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import { prepareWAMessageMedia } from '@whiskeysockets/baileys'
import { generateSafeLinkPreview, isPublicAddress } from './safe-link-preview.js'

test('rejects loopback, private, mapped IPv6 and metadata addresses', () => {
  for (const address of ['127.0.0.1','10.0.0.1','192.168.1.1','169.254.169.254','::1','::ffff:127.0.0.1','fc00::1','fe80::1']) assert.equal(isPublicAddress(address), false, address)
  assert.equal(isPublicAddress('8.8.8.8'), true)
})
test('unsafe preview falls back without accessing private HTTP server', async () => {
  assert.equal(await generateSafeLinkPreview('http://127.0.0.1/secret', async () => { throw new Error('must not upload') }), undefined)
})
test('real Baileys image preparation encodes image and caption with installed sharp', async () => {
  const image = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#148060' } }).png().toBuffer()
  const content = await prepareWAMessageMedia({ image, caption: 'Informasi desa' }, { upload: async () => ({ mediaUrl: 'https://media.test/image', directPath: '/test' }) })
  assert.equal(content.imageMessage?.caption, 'Informasi desa')
  assert.ok(content.imageMessage?.mediaKey); assert.ok(content.imageMessage?.jpegThumbnail?.length)
})
