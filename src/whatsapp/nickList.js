/**
 * Monta e publica a lista de nicks cadastrados no grupo do WhatsApp.
 *
 * A função é independente do Telegraf e não inicia conexão com o WhatsApp.
 * A integração de transporte deve fornecer um cliente compatível com
 * sock.sendMessage(jid, { text }).
 */

export function buildNickListMessage(players) {
  const uniqueNames = [...new Set(
    (Array.isArray(players) ? players : [])
      .map((player) => String(player?.name || '').trim())
      .filter(Boolean)
  )].sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));

  if (uniqueNames.length === 0) {
    return '🎮 *Jogadores cadastrados do clã SEGA*\n\nAinda não há nicks disponíveis para exibir.';
  }

  return [
    '🎮 *Jogadores cadastrados do clã SEGA*',
    '',
    ...uniqueNames.map((name, index) => `${index + 1}. ${name}`),
    '',
    `Total: ${uniqueNames.length} jogador(es).`
  ].join('\n');
}

/**
 * Publica a lista no grupo indicado pelo JID do WhatsApp.
 * O cliente e o grupo são injetados para facilitar testes e manter
 * esta função desacoplada da sessão/implementação do WhatsApp.
 */
export async function publishNickList({ client, groupJid, players }) {
  if (!client || typeof client.sendMessage !== 'function') {
    throw new TypeError('É necessário fornecer um cliente com sendMessage().');
  }
  if (typeof groupJid !== 'string' || !groupJid.trim()) {
    throw new TypeError('É necessário informar o identificador do grupo do WhatsApp.');
  }

  const text = buildNickListMessage(players);
  return client.sendMessage(groupJid, { text });
}
