// WhatsApp native-flow menu, available only through the owner's private !noxmenu command.
export const NOX_MENU_OPTIONS = Object.freeze([
  { id: '!stats', title: '📊 Minhas estatísticas' },
  { id: '!ranking', title: '🏆 Ranking do clã' },
  { id: '!highlights', title: '🌟 Destaques' },
  { id: '!cadastrar', title: '🎮 Cadastrar jogador' },
  { id: '!agenda', title: '📅 Agenda do clã' },
  { id: '!sugestao', title: '💡 Sugestões' },
  { id: '!ajuda', title: '❓ Ajuda' },
]);

export function buildNoxClickableMenu() {
  return {
    interactiveMessage: {
      header: { title: '🎮 NOX — MENU PRINCIPAL', hasMediaAttachment: false },
      body: { text: 'Escolha uma opção no botão abaixo:' },
      footer: { text: '🐺 Clã Tenebrozos' },
      nativeFlowMessage: {
        buttons: [{
          name: 'single_select',
          buttonParamsJson: JSON.stringify({
            title: '📋 ABRIR MENU',
            sections: [{
              title: 'Funcionalidades',
              rows: NOX_MENU_OPTIONS.map(({ id, title }) => ({ id, title, description: '' })),
            }],
          }),
        }],
        messageParamsJson: '{}',
        messageVersion: 1,
      },
    },
  };
}

export function resolveNoxMenuSelection(value) {
  return NOX_MENU_OPTIONS.some(option => option.id === value) ? value : null;
}

export function buildNoxNativeFlowRelayNodes(now = Date.now()) {
  return [
    { tag: 'bot', attrs: { biz_bot: '1' } },
    {
      tag: 'biz',
      attrs: {
        actual_actors: '2',
        host_storage: '2',
        privacy_mode_ts: String(Math.floor(now / 1000) - 77980457),
      },
      content: [
        {
          tag: 'interactive',
          attrs: { type: 'native_flow', v: '1' },
          content: [{ tag: 'native_flow', attrs: { v: '9', name: 'mixed' } }],
        },
        { tag: 'quality_control', attrs: { source_type: 'third_party' } },
      ],
    },
  ];
}

export async function sendPrivateNoxMenuPrototype(sock, jid, generateWAMessageFromContent) {
  if (!/^\d+@(s\.whatsapp\.net|lid)$/.test(jid)) {
    throw new Error('Menu clicável permitido somente em chat privado');
  }
  if (!sock?.user?.id || typeof sock.relayMessage !== 'function' || typeof generateWAMessageFromContent !== 'function') {
    throw new Error('Transporte Baileys não está disponível');
  }
  const message = generateWAMessageFromContent(jid, buildNoxClickableMenu(), { userJid: sock.user.id });
  if (!message?.key?.id || !message.message) throw new Error('Falha ao gerar mensagem interativa');
  await sock.relayMessage(jid, message.message, {
    messageId: message.key.id,
    additionalNodes: buildNoxNativeFlowRelayNodes(),
  });
  return message;
}
