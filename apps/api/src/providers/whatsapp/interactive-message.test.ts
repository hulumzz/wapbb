import assert from 'node:assert/strict'
import test from 'node:test'
import { proto } from '@whiskeysockets/baileys'
import { createInteractiveCtaMessage, extractInteractiveCtaUrl } from './interactive-message.js'

test('mengambil URL HTTPS pertama untuk tombol CTA', () => {
  assert.equal(
    extractInteractiveCtaUrl('Buka informasi di https://desa.example/pbb?id=123 sekarang.'),
    'https://desa.example/pbb?id=123',
  )
  assert.equal(extractInteractiveCtaUrl('Pesan biasa tanpa tautan'), undefined)
  assert.equal(extractInteractiveCtaUrl('Alamat lokal http://localhost:3000'), undefined)
})

test('membentuk native-flow CTA URL yang dapat diencode Baileys', () => {
  const message = createInteractiveCtaMessage({
    text: 'Halo Ahmad, lihat informasi PBB berikut.',
    url: 'https://desa.example/pbb',
    label: 'Buka informasi',
    footer: 'Eksperimen WAPBB',
  })
  const interactive = message.viewOnceMessage?.message?.interactiveMessage
  const button = interactive?.nativeFlowMessage?.buttons?.[0]

  assert.equal(interactive?.body?.text, 'Halo Ahmad, lihat informasi PBB berikut.')
  assert.equal(interactive?.header?.hasMediaAttachment, false)
  assert.equal(interactive?.footer?.text, 'Eksperimen WAPBB')
  assert.equal(button?.name, 'cta_url')
  assert.deepEqual(JSON.parse(button?.buttonParamsJson ?? '{}'), {
    display_text: 'Buka informasi',
    url: 'https://desa.example/pbb',
    merchant_url: 'https://desa.example/pbb',
  })
  assert.ok(proto.Message.encode(message).finish().length > 0)
})

test('menyertakan imageMessage sebagai header media', () => {
  const imageMessage = proto.Message.ImageMessage.create({
    mimetype: 'image/png',
    directPath: '/v/t62.7118-24/example',
  })
  const message = createInteractiveCtaMessage({
    text: 'Caption banner',
    url: 'https://desa.example/pbb',
    label: 'Buka link',
    footer: 'Eksperimen WAPBB',
    imageMessage,
  })

  const header = message.viewOnceMessage?.message?.interactiveMessage?.header
  assert.equal(header?.hasMediaAttachment, true)
  assert.equal(header?.imageMessage?.mimetype, 'image/png')
})
