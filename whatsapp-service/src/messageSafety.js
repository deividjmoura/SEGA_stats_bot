// WhatsApp can echo "fromMe" sends back before sendMessage returns an ID.
export function createOutgoingEchoGuard(now = () => Date.now(), ttlMs = 120000) {
  const fingerprints = new Map();
  const ids = new Set();
  function prune() {
    for (const [key, until] of fingerprints) if (until < now()) fingerprints.delete(key);
    if (ids.size > 1200) for (const id of [...ids].slice(0, 400)) ids.delete(id);
  }
  const fingerprint = (jid, text) => String(jid || '') + '\u0000' + String(text || '').trim();
  return {
    reserve(jid, text) {
      prune();
      const key = fingerprint(jid, text);
      fingerprints.set(key, now() + ttlMs);
      return () => fingerprints.delete(key);
    },
    rememberId(id) { if (id) { ids.add(id); prune(); } },
    isEcho(key, text) {
      if (key?.id && ids.has(key.id)) return true;
      if (!key?.fromMe || !text) return false;
      prune();
      return (fingerprints.get(fingerprint(key.remoteJid, text)) || 0) >= now();
    }
  };
}

// Only explicit test questions in the verified owner's self-chat. Never
// read or process other private chats and never parse multi-line bot help.
export function ownerKnowledgeQuestion(text) {
  const raw = String(text || '').trim();
  if (!raw || raw.length > 260 || /[\r\n]/.test(raw) || /^[!/]/.test(raw)) return null;
  const prefix = /^\s*(?:@nox(?:[ _]?stats)?(?:[ _]?bot)?|nox)\b[\s,:;.!?-]*/i;
  const prefixed = prefix.test(raw);
  const clean = prefixed ? raw.replace(prefix, '').trim() : raw;
  if (!clean) return null;
  if (!prefixed && !/^(?:quem|qual|quais|como|o que|me diz|me fala|counter|couter|cauter|coun|build|melhor|dicas?|itens?)\b/i.test(clean)) return null;
  return {question:clean,prefixed};
}
