import { Markup } from 'telegraf';

export const BUTTONS = {
  register: '📝 Cadastrar jogador',
  stats: '📊 Minhas stats',
  ranking: '🏆 Ranking',
  clan: '👥 Clã SEGA',
  help: '❓ Ajuda',
  lore: '📜 Lore'
};

export const BUTTON_LABELS = new Set(Object.values(BUTTONS));

export const startMessage = `🎮 <b>SEGA STATS</b>

⚡ <b>Bem-vindo à arena, guerreiro!</b> 👊

Bot oficial do clã <b>SEGA</b>.

Na jornada pelo <b>Land of Dawn</b>, seus números contam a história da sua batalha. Aqui você pode:

🏆 Consultar o ranking do clã
⚔️ Ver suas partidas e desempenho
🛡️ Conferir sua rota mais jogada
📊 Acompanhar seus pontos e estatísticas
👥 Comparar seu desempenho com a galera do clã

<b>Para começar:</b>
👉 Use <code>/cadastrar</code> para vincular seu jogador.

⚔️ <i>Entre na arena. Analise a batalha. Evolua.</i> 🔥`;

export const helpMessage = `📚 <b>COMANDOS DO SEGA STATS</b>

🎮 <code>/start</code> — abrir o menu principal
📝 <code>/cadastrar</code> — vincular seu jogador (só na primeira vez)
🔑 <code>/entrar</code> — reconectar sem redigitar seus IDs
📊 <code>/stats</code> — suas estatísticas
🏆 <code>/ranking</code> — ranking do clã
👥 <code>/clan</code> — painel do clã SEGA
📜 <code>/lore</code> — crônicas e heróis
❌ <code>/cancelar</code> — cancelar o cadastro em andamento
🚪 <code>/sair</code> — desvincular sua conta
❓ <code>/ajuda</code> — mostrar esta ajuda

⚠️ <b>Para o /stats e o /ranking funcionarem</b>, seu <b>histórico de batalhas precisa estar público</b> no Mobile Legends:
<i>Perfil → ⚙️ Configurações → Privacidade → Histórico de Batalhas → Público</i>

⏳ A consulta pode levar <b>alguns minutos</b>: a API do MLBB é lenta. Mande o comando uma vez e aguarde.

🔒 O bot <b>nunca</b> pede sua senha ou e-mail. A verificação usa apenas o código enviado ao correio interno do Mobile Legends.`;

export const loreMessage = `📜 <b>CRÔNICAS DO SEGA</b>

🌎 O Land of Dawn reúne heróis, regiões, ordens e conflitos que se cruzam em novas batalhas.

⚔️ <b>Saber</b> — precisão e evolução.
🛡️ <b>Tigreal</b> — liderança e união.
🔥 <b>Alucard</b> — persistência diante da adversidade.
🎯 <b>Layla</b> — alcance e poder de fogo.

No SEGA, cada jogador escreve sua própria história e o clã escreve o capítulo inteiro.

✨ <i>Da arena para o placar. Do jogador para a lenda.</i>`;

/** Aviso reaproveitado: sem histórico público a API não devolve nada. */
export const privacyNotice =
  '⚠️ <b>Importante:</b> seu <b>histórico de batalhas precisa estar público</b> no jogo.\n' +
  '<i>Mobile Legends → Perfil → ⚙️ Configurações → Privacidade → Histórico de Batalhas → Público</i>';

export const loadingStatsMessage =
  '📊 <b>Buscando suas estatísticas...</b>\n\n' +
  privacyNotice +
  '\n\n⏳ <b>Isso pode levar alguns minutos.</b> A API do MLBB costuma demorar para responder — ' +
  'pode deixar o Telegram de lado que eu te aviso assim que terminar. Não precisa mandar o comando de novo.';

export const loadingRankingMessage =
  '🏆 <b>Calculando o ranking do SEGA...</b>\n\n' +
  '⚔️ Consultando os dados de cada jogador vinculado.\n\n' +
  privacyNotice +
  '\n\n⏳ <b>Isso pode levar alguns minutos</b>, principalmente com muitos jogadores no clã. ' +
  'Só quem está com o histórico público aparece na lista.';

export function mainKeyboard() {
  return Markup.keyboard([
    [BUTTONS.register, BUTTONS.stats],
    [BUTTONS.ranking, BUTTONS.clan],
    [BUTTONS.help, BUTTONS.lore]
  ])
    .resize()
    .persistent();
}

export function quickActionsKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback(BUTTONS.register, 'register')],
    [Markup.button.callback(BUTTONS.stats, 'stats'), Markup.button.callback(BUTTONS.ranking, 'ranking')],
    [Markup.button.callback(BUTTONS.clan, 'clan'), Markup.button.callback(BUTTONS.lore, 'lore')],
    [Markup.button.callback(BUTTONS.help, 'help')]
  ]);
}

export function html(extra = {}) {
  return { parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...extra };
}

export function renderStats(s, playerName) {
  const title = playerName ? `📊 <b>ESTATÍSTICAS DE ${escapeHtml(playerName).toUpperCase()}</b>` : '📊 <b>SUAS ESTATÍSTICAS</b>';
  const lines = [
    title,
    '',
    `🎮 Partidas: <b>${s.matches}</b>`,
    `🏆 Vitórias: <b>${s.wins}</b>`,
    `💀 Derrotas: <b>${s.losses}</b>`,
    `📈 Win rate: <b>${s.winRate.toFixed(1)}%</b>`
  ];

  if (s.hasKda) {
    const kda = s.deaths > 0 ? ((s.kills + s.assists) / s.deaths).toFixed(2) : '∞';
    const scope = s.recent ? ` <i>(${s.recent} recentes)</i>` : '';
    lines.push(`⚔️ K/D/A: <b>${s.kills}/${s.deaths}/${s.assists}</b> (KDA ${kda})${scope}`);
  }

  lines.push(`⭐ Pontuação média: <b>${s.avgScore != null ? s.avgScore.toFixed(1) : 'N/D'}</b>`);
  lines.push(`👑 MVPs: <b>${s.mvps}</b>`);
  if (s.winStreak) lines.push(`🔥 Maior sequência de vitórias: <b>${s.winStreak}</b>`);
  if (s.mostPlayed) lines.push(`🎯 Herói mais usado: <b>${escapeHtml(s.mostPlayed)}</b>`);
  if (s.mostPlayedLane) lines.push(`🛡️ Rota mais jogada: <b>${escapeHtml(s.mostPlayedLane)}</b>`);
  if (s.hours) lines.push(`⏱️ Tempo de jogo: <b>${Number(s.hours).toFixed(0)}h</b>`);

  lines.push('', '<i>SEGA: cada partida escreve uma linha da história.</i>');
  return lines.join('\n');
}

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
