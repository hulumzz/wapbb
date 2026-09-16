const RETRYABLE_DELIVERY_STATUSES = new Set(['ERROR', 'UNKNOWN'])

export function canRetryCampaignJob(status: string, deliveryStatus: string | null): boolean {
  return status === 'FAILED'
    || (status === 'SENT' && deliveryStatus !== null && RETRYABLE_DELIVERY_STATUSES.has(deliveryStatus))
}

export function shouldResumeCampaign(status: string): boolean {
  return status === 'COMPLETED'
}