// Informações opcionais de temporada para !stats. Não modifica cadastro nem dados salvos.
// As APIs autenticadas da Rone podem falhar/desaparecer: nesse caso, não substituímos
// a ficha existente por valores calculados de uma amostra incompleta.
import { apiJson, authHeaders, isApiSuccess } from './roneApi.js';

const MAX_MATCH_PAGES = 3;
const MATCHES_PER_PAGE = 50;

function nonnegativeCount(value) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

async function safeData(path, headers, request) {
  try {
    const { response, body } = await request(path, { headers });
    return response?.ok && isApiSuccess(body) && body?.data && typeof body.data === 'object'
      ? body.data : null;
  } catch {
    return null;
  }
}

// request é injetável para testes com API simulada; nunca imprime JWT ou IDs.
export async function loadSeasonStats(jwt, request = apiJson) {
  if (!jwt) return null;
  const headers = authHeaders(jwt);
  const seasons = await safeData('/user/season?lang=pt', headers, request);
  // Escolhemos o maior SID porque a documentação não garante a ordenação.
  const sids = (Array.isArray(seasons?.sids) ? seasons.sids : [])
    .map(nonnegativeCount).filter(n => n !== null);
  if (!sids.length) return null;
  const sid = Math.max(...sids);
  const seen = new Set();
  let games = 0, wins = 0, losses = 0, mvps = 0;
  let matchesAvailable = false, complete = false;
  let cursor = '';
  const cursors = new Set();

  for (let page = 0; page < MAX_MATCH_PAGES; page += 1) {
    const path = '/user/matches?sid=' + encodeURIComponent(sid) +
      '&limit=' + MATCHES_PER_PAGE + '&lang=pt' +
      (cursor ? '&last_cursor=' + encodeURIComponent(cursor) : '');
    const data = await safeData(path, headers, request);
    if (!Array.isArray(data?.result)) break;
    matchesAvailable = true;

    for (const [index, row] of data.result.entries()) {
      if (!row || (row.res !== 0 && row.res !== 1 && row.res !== '0' && row.res !== '1')) continue;
      const id = String(row.bid_s ?? '').trim();
      const key = id || 'page' + page + ':row' + index;
      if (seen.has(key)) continue;
      seen.add(key);
      games += 1;
      if (Number(row.res) === 1) wins += 1;
      else losses += 1;
      if (Number(row.mvp) === 1) mvps += 1;
    }

    if (data.pageInfo?.hasNext === false) {
      complete = true;
      break;
    }
    const next = String(data.pageInfo?.nextCursor ?? '');
    // Sem indicação explícita do fim, os totais são apenas uma amostra.
    if (data.pageInfo?.hasNext !== true || !next || cursors.has(next)) break;
    cursors.add(next);
    cursor = next;
  }

  const heroesData = await safeData(
    '/user/heroes/frequent?sid=' + encodeURIComponent(sid) + '&limit=10&lang=pt',
    headers, request
  );
  const topHeroes = (Array.isArray(heroesData?.result) ? heroesData.result : [])
    .map(row => ({
      name: String(row?.hid_e?.n ?? row?.hid_e?.name ?? '').trim(),
      games: nonnegativeCount(row?.tc),
      wins: nonnegativeCount(row?.wc)
    }))
    .filter(hero => hero.name && hero.games !== null && hero.games > 0)
    .sort((a, b) => b.games - a.games)
    .slice(0, 3);

  if (!matchesAvailable && !topHeroes.length) return null;
  return { sid, matchesAvailable, complete, games, wins, losses, mvps, topHeroes };
}

export function formatSeasonStats(season) {
  if (!season) return [];
  const lines = ['', '📅 *TEMPORADA ' + season.sid + (season.matchesAvailable && !season.complete ? ' — AMOSTRA*' : '*')];

  if (season.matchesAvailable) {
    lines.push('⚔️ ' + (season.complete ? 'Partidas na temporada: ' : 'Partidas consultadas: ') + season.games);
    lines.push('🏆 ' + (season.complete ? 'Vitórias: ' : 'Vitórias na amostra: ') + season.wins);
    lines.push('❌ ' + (season.complete ? 'Derrotas: ' : 'Derrotas na amostra: ') + season.losses);
    if (season.games > 0) {
      lines.push('📈 ' + (season.complete ? 'Win rate da temporada: ' : 'Win rate da amostra: ') +
        (100 * season.wins / season.games).toFixed(1).replace('.', ',') + '%');
      lines.push('👑 MVPs' + (season.complete ? ': ' : ' na amostra: ') + season.mvps);
    }
    if (!season.complete) lines.push('ℹ️ Parcial: não representa todas as partidas da temporada.');
  }
  if (season.topHeroes?.length) {
    lines.push('🦸 *Heróis mais usados na temporada:*');
    for (const [i, hero] of season.topHeroes.entries()) {
      const rate = hero.wins !== null && hero.wins <= hero.games
        ? ' · ' + (100 * hero.wins / hero.games).toFixed(1).replace('.', ',') + '% WR'
        : '';
      lines.push((i + 1) + '. ' + hero.name + ' — ' + hero.games + ' partidas' + rate);
    }
  }
  return lines;
}
