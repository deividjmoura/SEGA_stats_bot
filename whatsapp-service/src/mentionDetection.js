// Detect WhatsApp mentions in the *current* message, without matching quoted
// messages or unrelated historical mentions. No contact numbers are persisted.
const JID = /^[0-9]+(?::[0-9]+)?@(s\.whatsapp\.net|lid)$/;

export function collectMentionJids(message, visibleText = '') {
  let current = message || {};
  for (let i = 0; i < 6; i += 1) {
    const next = current?.ephemeralMessage?.message ||
      current?.viewOnceMessage?.message ||
      current?.viewOnceMessageV2?.message ||
      current?.viewOnceMessageV2Extension?.message ||
      current?.documentWithCaptionMessage?.message ||
      current?.editedMessage?.message?.protocolMessage?.editedMessage ||
      current?.protocolMessage?.editedMessage;
    if (!next) break;
    current = next;
  }

  const jids = [];
  const children = [
    current, current?.extendedTextMessage, current?.imageMessage,
    current?.videoMessage, current?.documentMessage,
    current?.buttonsResponseMessage, current?.listResponseMessage,
  ];
  for (const child of children) {
    const contexts = [child?.contextInfo, child?.messageContextInfo];
    for (const context of contexts) {
      for (const value of context?.mentionedJid || []) {
        if (typeof value === 'string' && JID.test(value)) jids.push(value);
      }
    }
  }

  // Some WhatsApp clients forward a real @mention as a numeric visible token
  // but omit mentionedJid. This fallback restores playful mention replies
  // without responding to ordinary @names or a phone number not prefixed by @.
  for (const match of String(visibleText || '').matchAll(/(?:^|\s)@([0-9]{8,20})(?=$|\s|[,!?;:.])/g)) {
    const number = match[1];
    if (jids.some(jid => jid.split('@')[0].split(':')[0] === number)) continue;
    jids.push(number + (number.length >= 14 ? '@lid' : '@s.whatsapp.net'));
  }

  return [...new Set(jids)];
}
