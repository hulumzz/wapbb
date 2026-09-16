import { proto, type BinaryNode } from '@whiskeysockets/baileys'

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
    // Patch multi-device yang dipakai klien WhatsApp untuk payload interactive.
    documentWithCaptionMessage: proto.Message.FutureProofMessage.create({
      message: proto.Message.create({ interactiveMessage }),
    }),
  })
}

export function createInteractiveCtaRelayNodes(): BinaryNode[] {
  return [
    {
      tag: 'biz',
      attrs: {},
      content: [{
        tag: 'interactive',
        attrs: { type: 'native_flow', v: '1' },
        content: [{
          tag: 'native_flow',
          attrs: { v: '9', name: 'mixed' },
        }],
      }],
    },
    // Chat 1:1 membutuhkan penanda bot bisnis agar native-flow dirender.
    { tag: 'bot', attrs: { biz_bot: '1' } },
  ]
}
