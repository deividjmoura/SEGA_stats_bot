// Safety boundary for an account that is used for personal WhatsApp chats.
// Never inspect or respond to unrelated one-to-one conversations.
export function normalizeAccountJid(jid) {
  const value = String(jid || '').trim().toLowerCase();
  const at = value.indexOf('@');
  if (at < 0) return '';
  const username = value.slice(0, at).split(':')[0];
  const domain = value.slice(at + 1);
  return username && domain ? username + '@' + domain : '';
}

export function isOwnPrivateChat(remoteJid, ownJids = []) {
  const remote = normalizeAccountJid(remoteJid);
  if (!remote || remote.endsWith('@g.us')) return false;
  return ownJids.some(jid => normalizeAccountJid(jid) === remote);
}

export function shouldProcessPrivateMessage(message, ownJids = []) {
  const key = message?.key || {};
  return Boolean(
    key.id && message?.message && !key.remoteJid?.endsWith('@g.us')
    && isOwnPrivateChat(key.remoteJid, ownJids)
  );
}
