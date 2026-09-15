export function renderMessageTemplate(content: string, variables: { nama: string }): string {
  return content.replace(/{{\s*nama\s*}}/gi, variables.nama)
}
