// A group post is an announcement only when it is a new, user-authored message
// in the configured announcements group. Reactions, edits and history are ignored.
export const ANNOUNCEMENT_NOTICE = '📢 *Novo comunicado SEGA!*\nConfira o grupo de Avisos Oficiais.';

export function isAnnouncementPost(message, type, groupJid) {
  const key = message?.key;
  if (!groupJid?.endsWith('@g.us') || type !== 'notify'
      || key?.remoteJid !== groupJid || key?.fromMe || !key?.id) return false;
  let content = message?.message;
  for (let i = 0; i < 3; i++) {
    const nested = content?.ephemeralMessage?.message
      || content?.viewOnceMessage?.message
      || content?.viewOnceMessageV2?.message;
    if (!nested) break;
    content = nested;
  }
  if (!content) return false;
  const allowed = [
    'conversation', 'extendedTextMessage', 'imageMessage', 'videoMessage',
    'documentMessage', 'audioMessage', 'stickerMessage', 'pollCreationMessage',
    'locationMessage', 'contactMessage', 'contactsArrayMessage'
  ];
  return allowed.some(type => Object.prototype.hasOwnProperty.call(content, type));
}
