import assert from 'node:assert/strict'
import test from 'node:test'
import { renderMessageTemplate, validateMessageTemplate } from './template.js'

test('merender semua variasi whitespace dan huruf pada nama', () => {
  assert.equal(renderMessageTemplate('Halo {{ nama }} / {{NAMA}}', { nama: 'Siti' }), 'Halo Siti / Siti')
})

test('menolak variabel di luar scope V1', () => {
  assert.throws(() => validateMessageTemplate('Tagihan {{nominal}}'), /nominal/)
  assert.throws(() => validateMessageTemplate('Halo {{nama | script}}'), /nama \| script/)
})
