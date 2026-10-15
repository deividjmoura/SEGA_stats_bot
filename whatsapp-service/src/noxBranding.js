// Common presentation layer: NOX speaks through the owner's WhatsApp account.
// Keep every bot-generated message distinguishable from the owner's own messages.
export const NOX_BOT_SIGNATURE = '🤖 _NOX bot_';
export const NOX_MENU_HEADER = '🤖 NOX bot';

export function brandNoxText(value) {
  const content = String(value ?? '');
  // Idempotent: never stack signatures if the caller has already added one.
  return content.startsWith(NOX_BOT_SIGNATURE)
    ? content
    : NOX_BOT_SIGNATURE + '\n\n' + content;
}

export function brandNoxInteractiveTitle(title, body) {
  // WhatsApp can render interactive titles before bodies. Put the identity in
  // the first visible line, while keeping the original menu title immediately
  // below so all flows retain their context.
  const heading = String(title ?? '').trim();
  const details = String(body ?? '');
  return {
    headerTitle: NOX_MENU_HEADER,
    bodyText: heading ? heading + '\n\n' + details : details,
  };
}
