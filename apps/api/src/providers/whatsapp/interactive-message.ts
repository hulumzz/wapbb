import { extractUrlFromText, proto } from '@whiskeysockets/baileys'

export function extractInteractiveCtaUrl(text: string): string | undefined {
  const url = extractUrlFromText(text)
  if (!url) return undefined

  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' ? parsed.toString() : undefined
  } catch {
    return undefined
  }
}

type InteractiveCtaInput = {
  text: string
  url: string
  label: string
  footer: string
  imageMessage?: proto.Message.IImageMessage
}

export function createInteractiveCtaMessage(input: InteractiveCtaInput): proto.IMessage {
  const interactiveMessage = proto.Message.InteractiveMessage.create({
    header: proto.Message.InteractiveMessage.Header.create({
      hasMediaAttachment: Boolean(input.imageMessage),
      imageMessage: input.imageMessage,
    }),
    body: proto.Message.InteractiveMessage.Body.create({ text: input.text }),
    footer: proto.Message.InteractiveMessage.Footer.create({ text: input.footer }),
    nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
      messageVersion: 1,
      messageParamsJson: '',
      buttons: [proto.Message.InteractiveMessage.NativeFlowMessage.NativeFlowButton.create({
        name: 'cta_url',
        buttonParamsJson: JSON.stringify({
          display_text: input.label,
          url: input.url,
          merchant_url: input.url,
        }),
      })],
    }),
  })

  return proto.Message.create({
    messageContextInfo: proto.MessageContextInfo.create({
      deviceListMetadata: {},
      deviceListMetadataVersion: 2,
    }),
    viewOnceMessage: proto.Message.FutureProofMessage.create({
      message: proto.Message.create({ interactiveMessage }),
    }),
  })
}
