export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderRanking(ranking) {
  const lines = ranking.slice(0, 10).map((player, index) => {
    const medal = ['🥇', '🥈', '🥉'][index] || '🏅';
    return medal + ' <b>' + (index + 1) + '. ' + escapeHtml(player.name) + '</b>\n' +
      '   📈 ' + player.winRate.toFixed(1) + '% WR  •  🏆 ' +
      player.wins + '/' + player.verifiedMatches +
      (player.averageScore > 0 ? '  •  ⭐ ' + player.averageScore.toFixed(1) : '');
  });

  return '🏆 <b>RANKING SEGA</b>\n\n' +
    lines.join('\n\n') +
    '\n\n<i>Ranking calculado exclusivamente com partidas verificadas a partir dos prints salvos.</i>';
}

export function renderPlayerStats(summary, playerName = null) {
  const kda = summary.kills + '/' + summary.deaths + '/' + summary.assists;
  const name = playerName ? ' • ' + escapeHtml(playerName) : '';

  return '📊 <b>SUAS ESTATÍSTICAS' + name + '</b>\n\n' +
    '⚔️ Partidas verificadas: <b>' + summary.verifiedMatches + '</b>\n' +
    '🏆 Vitórias: <b>' + summary.wins + '</b>\n' +
    '💀 Derrotas: <b>' + summary.losses + '</b>\n' +
    '📈 Win rate: <b>' + summary.winRate.toFixed(1) + '%</b>\n' +
    '⚔️ K/D/A somado: <b>' + kda + '</b>\n' +
    (summary.averageScore > 0 ? '⭐ Pontuação média: <b>' + summary.averageScore.toFixed(1) + '</b>\n' : '') +
    (summary.mvps > 0 ? '👑 MVPs detectados: <b>' + summary.mvps + '</b>\n' : '') +
    '\n<i>Dados calculados somente a partir dos prints verificados e armazenados pelo bot.</i>';
}
