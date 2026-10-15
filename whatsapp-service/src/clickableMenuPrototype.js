// Experimental Baileys native-flow menu payload. Not wired to production.
// Send only to an explicitly approved private test JID; never broadcast to groups.
export const NOX_MENU_OPTIONS = Object.freeze([
  { id: '!stats', title: '📊 Minhas estatísticas' },
  { id: '!ranking', title: '🏆 Ranking do clã' },
  { id: '!highlights', title: '🌟 Destaques' },
  { id: '!agenda', title: '📅 Agenda do clã' },
  { id: '!sugestao', title: '💡 Sugestões' },
  { id: '!ajuda', title: '❓ Ajuda' },
]);

export function buildNoxClickableMenu() {
  return {
    text: '🎮 *NOX — MENU PRINCIPAL*\\nEscolha uma opção abaixo:',
    footer: '🐺 Clã Tenebrozos',
    title: 'NOX',
    buttonText: '📋 ABRIR MENU',
    sections: [{ title: 'Funcionalidades', rows: NOX_MENU_OPTIONS.map(({id, title}) => ({ rowId: id, title })) }],
  };
}

export function resolveNoxMenuSelection(value) {
  return NOX_MENU_OPTIONS.some(option => option.id === value) ? value : null;
}

export async function sendPrivateNoxMenuPrototype(sock, jid) {
  if (!/^\\d+@s\\.whatsapp\\.net$/.test(jid)) throw new Error('Protótipo permitido somente em chat privado');
  return sock.sendMessage(jid, buildNoxClickableMenu());
}
