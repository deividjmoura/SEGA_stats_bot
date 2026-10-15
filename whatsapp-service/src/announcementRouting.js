// A group post is an announcement only when it is a new, user-authored message
// in the configured announcements group. Reactions, edits and history are ignored.
export const ANNOUNCEMENT_NOTICE = '📢 *Novo comunicado NOX!*\nConfira o grupo de Avisos Oficiais.';

export function isAnnouncementPost(message, type, groupJid) {
  const key = message?.key;
  if (!groupJid?.endsWith('@g.us') || !['notify', 'append'].includes(type)
      || (type === 'append' && !key?.fromMe)
      || key?.remoteJid !== groupJid || !key?.id) return false;
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


// Discover the community's *official* announcement channel, not an ordinary
// admin-only group. Fail closed if the Geral isn't linked to a community or
// there is more than one possible candidate.
export function selectCommunityAnnouncementsGroup(groups, generalMetadata) {
  const parentId = generalMetadata?.linkedParent;
  if (!parentId) return null;
  const matches = Object.values(groups || {}).filter(group =>
    group?.isCommunityAnnounce === true
    && group?.linkedParent === parentId
    && group?.id !== generalMetadata?.id
    && typeof group?.id === 'string'
    && group.id.endsWith('@g.us')
  );
  return matches.length === 1 ? matches[0].id : null;
}


// Native WhatsApp @all is resolved by WhatsApp against CURRENT membership,
// so members added or removed since the last announcement are handled automatically.
// The library's mentionAll flag is necessary; plain '@all' text won't notify.
// Metadata is verified to avoid accidentally notifying a different group.
export function buildAnnouncementMentionMessage(generalMetadata, expectedGroupJid) {
  if (!expectedGroupJid?.endsWith('@g.us') ||
      generalMetadata?.id !== expectedGroupJid ||
      !Array.isArray(generalMetadata?.participants) ||
      generalMetadata.participants.length === 0) return null;
  return {
    text: '@all\n\n' + ANNOUNCEMENT_NOTICE,
    mentionAll: true
  };
}
