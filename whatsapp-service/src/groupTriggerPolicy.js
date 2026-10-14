// Strict group reply policy: natural group chat must never trigger a SEGA reply.
// Only explicit commands, bot-directed questions and real WhatsApp mentions do.
const SEGA_QUESTION = /@sega(?:[ _]?stats)?(?:[ _]?bot)?\b/i;
const DIRECT_COMMAND = /^(?:[!\/]\s*(?:sega|stats|ranking|highlights|ajuda|cadastrar)|cadastrar|[!\/]\s*battle(?:\s+.*)?)$/i;

export function isExplicitGroupInteraction(text, mentions = [], menuActive = false) {
  const value = String(text || '').trim();
  if (Array.isArray(mentions) && mentions.length > 0) return true;
  if (SEGA_QUESTION.test(value)) return true;
  if (menuActive && /^[1-5]$/.test(value)) return true;
  return DIRECT_COMMAND.test(value);
}
