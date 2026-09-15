export function normalizeIndonesianPhone(input: string): string {
  let phone = input.trim().replace(/[\s\-().]/g, '')

  if (phone.startsWith('+')) phone = phone.slice(1)
  if (phone.startsWith('0')) phone = `62${phone.slice(1)}`
  else if (phone.startsWith('8')) phone = `62${phone}`

  if (!/^62\d{8,13}$/.test(phone)) {
    throw new Error('Nomor WhatsApp tidak valid. Gunakan nomor Indonesia yang aktif.')
  }

  return phone
}
