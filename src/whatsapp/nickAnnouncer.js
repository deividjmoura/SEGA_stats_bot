/**
 * Identifica o jogador somente na primeira mensagem após um período de silêncio.
 * Não altera mensagens, não lê histórico e não responde a mensagens do próprio bot.
 */
export const DEFAULT_INACTIVITY_MS = 15 * 60 * 1000;

export function createNickAnnouncer({ lookupNick, inactivityMs = DEFAULT_INACTIVITY_MS, now = Date.now } = {}) {
  if (typeof lookupNick !== 'function') throw new TypeError('lookupNick deve ser uma função');
  if (!Number.isFinite(inactivityMs) || inactivityMs <= 0) throw new TypeError('inactivityMs inválido');
  const lastMessageBySender = new Map();

  async function handle({ groupJid, senderJid, message, fromMe = false, isHistory = false, sendReply }) {
    if (fromMe || isHistory || !groupJid?.endsWith('@g.us') || !senderJid || !message) return false;
    if (typeof sendReply !== 'function') throw new TypeError('sendReply deve ser uma função');
    const timestamp = now();
    const key = groupJid + ':' + senderJid;
    const previous = lastMessageBySender.get(key);
    // A atividade é registrada mesmo sem nick, para não anunciar repetidamente após cadastro.
    lastMessageBySender.set(key, timestamp);
    if (previous !== undefined && timestamp - previous < inactivityMs) return false;
    const nick = await lookupNick(senderJid, groupJid);
    if (typeof nick !== 'string' || !nick.trim()) return false;
    await sendReply({ groupJid, message, text: nick.trim() + ' disse:' });
    return true;
  }

  return { handle };
}
