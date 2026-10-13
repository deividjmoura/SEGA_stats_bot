// The device owner must be verified by a phone-number JID, never by a LID.
// The +55 mobile ninth digit can be absent from older Brazilian WhatsApp JIDs.
function phoneFromJid(value) {
  const match = /^(\d+)(?::\d+)?@(s\.whatsapp\.net|c\.us)$/i.exec(String(value || '').trim());
  return match?.[1] || null;
}

export function ownerIdentityMatchesPhone(jids, configuredPhone) {
  const expected = String(configuredPhone || '').replace(/\D/g, '');
  if (!/^\d{10,15}$/.test(expected)) return false;
  const accepted = new Set([expected]);
  if (/^55\d{2}9\d{8}$/.test(expected)) {
    accepted.add(expected.slice(0, 4) + expected.slice(5));
  }
  return (Array.isArray(jids) ? jids : []).some(jid => {
    const candidate = phoneFromJid(jid);
    return candidate !== null && accepted.has(candidate);
  });
}
