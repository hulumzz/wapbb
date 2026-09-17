import { createHash } from 'node:crypto'

type CampaignRequest = {
  name: string
  templateId?: string
  content?: string
  contactIds?: string[]
  batchSize: number
  useBanner: boolean
  useInteractiveCta: boolean
}

export function createCampaignRequestHash(input: CampaignRequest): string {
  return createHash('sha256').update(JSON.stringify({
    ...input,
    contactIds: input.contactIds ? [...new Set(input.contactIds)].sort() : undefined,
  })).digest('hex')
}
