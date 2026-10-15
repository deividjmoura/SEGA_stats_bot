// Strict group reply policy: natural group chat must never trigger a NOX reply.
// Only explicit commands, bot-directed questions and real WhatsApp mentions do.
const NOX_QUESTION = /@nox(?:[ _]?stats)?(?:[ _]?bot)?\b/i;
const DIRECT_COMMAND = /^(?:(?:[!\/]\s*)?(?:nox|agenda|sugestao)|[!\/]\s*(?:stats|ranking|highlights|ajuda|cadastrar)|cadastrar|[!\/]\s*battle(?:\s+.*)?)$/i;

export function isExplicitGroupInteraction(text, mentions = [], menuActive = false) {
  const value = String(text || '').trim();
  if (Array.isArray(mentions) && mentions.length > 0) return true;
  if (NOX_QUESTION.test(value)) return true;
  if (menuActive && /^[1-5]$/.test(value)) return true;
  return DIRECT_COMMAND.test(value);
}
