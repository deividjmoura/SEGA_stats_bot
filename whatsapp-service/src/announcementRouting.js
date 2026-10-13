// A group post is an announcement only when it is a new, user-authored message
// in the configured announcements group. Reactions, edits and history are ignored.
export const ANNOUNCEMENT_NOTICE = '📢 *Novo comunicado SEGA!*\nConfira o grupo de Avisos Oficiais.';

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


// Build real WhatsApp @mentions for every Geral member. Group metadata is
// fetched fresh before the announcement is sent, never from stale nick caches.
// Fail closed rather than claiming to alert "everyone" with a partial list.
export function buildAnnouncementMentionMessage(generalMetadata, expectedGroupJid) {
  if (!expectedGroupJid?.endsWith('@g.us') ||
      generalMetadata?.id !== expectedGroupJid ||
      !Array.isArray(generalMetadata?.participants) ||
      generalMetadata.participants.length === 0) return null;

  const mentions = [];
  const seen = new Set();
  for (const participant of generalMetadata.participants) {
    const candidates = [
      participant?.id, participant?.jid, participant?.lid,
      participant?.phoneNumberJid
    ];
    const jid = candidates.map(value => String(value || '').trim())
      .find(value => /^\d+(?::\d+)?@(s\.whatsapp\.net|lid)$/.test(value));
    if (!jid) return null;
    const normalized = jid.replace(/:\d+@/, '@');
    if (!seen.has(normalized)) {
      seen.add(normalized);
      mentions.push(normalized);
    }
  }
  if (!mentions.length) return null;
  // Visible @identifiers are paired with the JIDs WhatsApp needs to deliver
  // genuine mention notifications (plain '@todos' alone does not do this).
  const tags = mentions.map(jid => '@' + jid.split('@')[0]).join(' ');
  return {
    text: ANNOUNCEMENT_NOTICE + '\n\n👥 *Atenção, integrantes do Geral:*\n' + tags,
    mentions
  };
}
