const VARIABLE_PATTERN = /{{\s*([^{}]+?)\s*}}/g

export function validateMessageTemplate(content: string): void {
  const unsupported = [...content.matchAll(VARIABLE_PATTERN)]
    .map((match) => match[1].trim().toLowerCase())
    .filter((name) => name !== 'nama')
  if (unsupported.length) {
    const error = new Error(`Variabel template tidak didukung: ${[...new Set(unsupported)].join(', ')}`) as Error & { statusCode: number }
    error.statusCode = 400
    throw error
  }
}

export function renderMessageTemplate(content: string, variables: { nama: string }): string {
  validateMessageTemplate(content)
  return content.replace(/{{\s*nama\s*}}/gi, variables.nama)
}
