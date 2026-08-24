export type MessageResponder = (response: unknown) => void;

export type MessageHandler<TMessage extends { type: string }> = (
  message: TMessage,
  sendResponse: MessageResponder,
) => Promise<void> | void;

export type MessageHandlerMap<TMessage extends { type: string }> = Partial<{
  [TType in TMessage["type"]]: MessageHandler<
    Extract<TMessage, { type: TType }>
  >;
}>;

export function createMessageRouter<TMessage extends { type: string }>(
  handlers: MessageHandlerMap<TMessage>,
): MessageHandler<TMessage> {
  return async (message, sendResponse) => {
    const handler = handlers[message.type as TMessage["type"]] as
      | MessageHandler<TMessage>
      | undefined;
    if (!handler) {
      sendResponse({ error: "Unknown message type" });
      return;
    }

    await handler(message, sendResponse);
  };
}
