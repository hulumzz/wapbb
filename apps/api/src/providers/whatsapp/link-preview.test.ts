import assert from 'node:assert/strict'
import test from 'node:test'
import { extractUrlFromText, getUrlInfo } from '@whiskeysockets/baileys'
import { getPreviewFromContent } from 'link-preview-js'

test('link-preview-js terpasang dan URL yang dideteksi Baileys dapat diparsing', async () => {
  const url = 'https://informasi-pbb.example/pengingat'
  const detected = extractUrlFromText(`Silakan cek ${url}`)
  const preview = await getPreviewFromContent({
    url,
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    data: `<!doctype html><html><head>
      <title>Informasi PBB Desa</title>
      <meta property="og:title" content="Pengingat PBB Desa">
      <meta property="og:description" content="Informasi pembayaran PBB">
    </head><body>WAPBB</body></html>`,
  })

  assert.equal(detected, url)
  assert.ok('title' in preview)
  assert.equal(preview.title, 'Pengingat PBB Desa')
  assert.equal(preview.description, 'Informasi pembayaran PBB')
})

test('pesan tanpa URL tidak menghasilkan link preview', async () => {
  const preview = await getUrlInfo('Halo Ahmad, ini pesan biasa tanpa tautan.')
  assert.equal(preview, undefined)
})
