// WhatsApp native-flow menus. Callers enforce chat permissions before sending.
export const NOX_MENU_OPTIONS = Object.freeze([
  { id: '!stats', title: '📊 Minhas estatísticas' },
  { id: '!ranking', title: '🏆 Ranking do clã' },
  { id: '!highlights', title: '🌟 Destaques' },
  { id: '!cadastrar', title: '🎮 Cadastrar jogador' },
  { id: '!agenda', title: '📅 Agenda do clã' },
  { id: '!sugestao', title: '💡 Sugestões' },
  { id: '!ajuda', title: '❓ Ajuda' },
]);

export function buildInteractiveList({ title, body, buttonText, rows }) {
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 10) {
    throw new Error('A lista interativa precisa de 1 a 10 opções');
  }
  if (new Set(rows.map(row => row.id)).size !== rows.length) {
    throw new Error('A lista interativa possui opções duplicadas');
  }
  return {
    interactiveMessage: {
      header: { title, hasMediaAttachment: false },
      body: { text: body },
      footer: { text: '🐺 Clã Tenebrozos' },
      nativeFlowMessage: {
        buttons: [{
          name: 'single_select',
          buttonParamsJson: JSON.stringify({
            title: buttonText,
            sections: [{ title: 'Escolha uma opção', rows: rows.map(row => ({
              id: row.id,
              title: row.title,
              description: row.description || '',
            })) }],
          }),
        }],
        messageParamsJson: '{}',
        messageVersion: 1,
      },
    },
  };
}

export function buildNoxClickableMenu() {
  return buildInteractiveList({
    title: '🎮 NOX — MENU PRINCIPAL',
    body: 'Escolha uma opção no botão abaixo:',
    buttonText: '📋 ABRIR MENU',
    rows: NOX_MENU_OPTIONS,
  });
}

// Pagination ensures that every page fits WhatsApp's 10-row single-select limit.
export function buildAgendaEventChoices(events, mode, page = 0) {
  const perPage = 8;
  const totalPages = Math.max(1, Math.ceil(events.length / perPage));
  if (!Number.isInteger(page) || page < 0 || page >= totalPages) throw new Error('Página inválida');
  const from = page * perPage;
  const rows = events.slice(from, from + perPage).map(event => ({
    id: 'nox:event:' + event.id,
    title: String(event.title || 'Evento').slice(0, 24),
    description: new Date(event.date).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }).slice(0, 72),
  }));
  if (page > 0) rows.push({ id: 'nox:page:' + (page - 1), title: '⬅️ Página anterior' });
  if (page + 1 < totalPages) rows.push({ id: 'nox:page:' + (page + 1), title: '➡️ Próxima página' });
  return buildInteractiveList({
    title: mode === 'editarevento' ? '✏️ EDITAR EVENTO' : '❌ CANCELAR EVENTO',
    body: 'Selecione o evento (página ' + (page + 1) + ' de ' + totalPages + '). Envie !sair para desistir.',
    buttonText: '📅 ESCOLHER EVENTO',
    rows,
  });
}

export function buildAgendaConfirmationChoice(event) {
  return buildInteractiveList({
    title: '❌ CONFIRMAR EXCLUSÃO',
    body: 'Deseja realmente cancelar "' + String(event.title).slice(0, 100) + '"?',
    buttonText: '⚠️ CONFIRMAR',
    rows: [
      { id: 'nox:confirm:sim', title: '✅ Sim, excluir evento' },
      { id: 'nox:confirm:nao', title: '↩️ Não, manter evento' },
    ],
  });
}

// The "bot" flag on a message may cause WhatsApp to display thumbs up/down
// feedback controls. Keep only the native-flow metadata required for interaction.
export function buildNoxNativeFlowRelayNodes(now = Date.now()) {
  return [{
    tag: 'biz',
    attrs: {
      actual_actors: '2',
      host_storage: '2',
      privacy_mode_ts: String(Math.floor(now / 1000) - 77980457),
    },
    content: [{
      tag: 'interactive',
      attrs: { type: 'native_flow', v: '1' },
      content: [{ tag: 'native_flow', attrs: { v: '9', name: 'mixed' } }],
    }],
  }];
}

export async function sendNoxInteractiveMenu(sock, jid, generateWAMessageFromContent, menu, allowedGroupJids = []) {
  const privateJid = /^\d+@(s\.whatsapp\.net|lid)$/.test(jid);
  const approvedGroup = jid?.endsWith('@g.us') && allowedGroupJids.includes(jid);
  if (!privateJid && !approvedGroup) throw new Error('Destino do menu não autorizado');
  if (!sock?.user?.id || typeof sock.relayMessage !== 'function' || typeof generateWAMessageFromContent !== 'function') {
    throw new Error('Transporte Baileys não está disponível');
  }
  const message = generateWAMessageFromContent(jid, menu, { userJid: sock.user.id });
  if (!message?.key?.id || !message.message) throw new Error('Falha ao gerar mensagem interativa');
  await sock.relayMessage(jid, message.message, {
    messageId: message.key.id,
    additionalNodes: buildNoxNativeFlowRelayNodes(),
  });
  return message;
}

export function isInteractiveChoice(message) {
  for (let current = message, i = 0; current && i < 6; i++) {
    if (current.interactiveResponseMessage?.nativeFlowResponseMessage ||
        current.listResponseMessage?.singleSelectReply) return true;
    current = current.ephemeralMessage?.message || current.viewOnceMessage?.message ||
      current.viewOnceMessageV2?.message || current.viewOnceMessageV2Extension?.message;
  }
  return false;
}

// Compatibility during rollout: keep existing production imports working.
export function sendPrivateNoxMenuPrototype(sock, jid, generator) {
  return sendNoxInteractiveMenu(sock, jid, generator, buildNoxClickableMenu());
}
