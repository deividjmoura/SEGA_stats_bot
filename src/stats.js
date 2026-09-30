import { apiJson, authHeaders } from './api.js';

/** lid do /user/matches → nome da rota. */
export const LANES = {
  1: 'EXP',
  2: 'Meio',
  3: 'Roam',
  4: 'Selva',
  5: 'Ouro'
};

export function parseMatchStats(matches) {
  const rows = Array.isArray(matches) ? matches : [];
  const total = rows.length;

  // /user/matches usa `res` (1 = vitória). O endpoint de detalhe usa `fw`.
  const isWin = (m) => Number(m?.res ?? m?.fw ?? 0) === 1;

  const wins = rows.filter(isWin).length;
  const mvps = rows.filter((m) => Number(m?.mvp) === 1).length;
  const kills = rows.reduce((sum, m) => sum + Number(m?.k || 0), 0);
  const deaths = rows.reduce((sum, m) => sum + Number(m?.d || 0), 0);
  const assists = rows.reduce((sum, m) => sum + Number(m?.a || 0), 0);

  // `s` vem multiplicado por 100 (ex.: 1180 = 11.80).
  const scores = rows.map((m) => Number(m?.s)).filter(Number.isFinite);
  const avgScore = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length / 100 : null;

  const heroes = new Map();
  const lanes = new Map();
  for (const m of rows) {
    const heroName = m?.hid_e?.n || (m?.hid != null ? `Herói #${m.hid}` : null);
    if (heroName) heroes.set(heroName, (heroes.get(heroName) || 0) + 1);

    const lane = LANES[Number(m?.lid)];
    if (lane) lanes.set(lane, (lanes.get(lane) || 0) + 1);
  }

  const top = (map) => [...map.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;

  return {
    matches: total,
    wins,
    losses: Math.max(total - wins, 0),
    mvps,
    kills,
    deaths,
    assists,
    avgScore,
    mostPlayed: top(heroes),
    mostPlayedLane: top(lanes)
  };
}

function hasUsefulTotals(data) {
  return data && (data.tc != null || data.wc != null || data.matches != null);
}

/** Os season ids aparecem tanto em /user/season quanto dentro de /user/stats. */
function extractSids(...sources) {
  const out = [];
  for (const source of sources) {
    const sids = source?.sids;
    if (Array.isArray(sids)) out.push(...sids.map(Number).filter(Number.isFinite));
  }
  // Mais recente primeiro, sem repetição.
  return [...new Set(out)].sort((a, b) => b - a);
}

/**
 * Busca as estatísticas do jogador.
 * 1) /user/stats (totais da conta inteira)
 * 2) fallback: temporada + partidas recentes (traz KDA e rota)
 */
export async function fetchPlayerStats(jwt) {
  const headers = authHeaders(jwt);

  const direct = await apiJson('/user/stats', { headers });
  if (direct.unauthorized) {
    return { source: 'error', unauthorized: true, status: direct.status, message: direct.message };
  }

  const directData = direct.ok ? direct.body?.data : null;

  // Busca as temporadas: primeiro o que já veio em /user/stats, depois /user/season.
  let sids = extractSids(directData);
  let seasonError = null;

  if (!sids.length) {
    const season = await apiJson('/user/season', { headers });
    if (season.unauthorized) {
      return { source: 'error', unauthorized: true, status: season.status, message: season.message };
    }
    if (season.ok) {
      sids = extractSids(season.body?.data);
    } else {
      seasonError = season;
    }
  }

  // Tenta montar as stats detalhadas a partir das partidas.
  let lastMessage = '';
  let lastStatus = 0;

  for (const sid of sids.slice(0, 3)) {
    const matches = await apiJson(`/user/matches?sid=${encodeURIComponent(sid)}&limit=50`, { headers });

    if (matches.unauthorized) {
      return { source: 'error', unauthorized: true, status: matches.status, message: matches.message };
    }

    if (!matches.ok) {
      lastMessage = matches.message;
      lastStatus = matches.status;
      continue;
    }

    const rows = matches.body?.data?.result;
    if (Array.isArray(rows) && rows.length > 0) {
      const parsed = parseMatchStats(rows);
      // Os totais da conta (/user/stats) são mais completos que 50 partidas:
      // usamos eles para partidas/vitórias e as partidas para KDA/rota.
      if (hasUsefulTotals(directData)) {
        return { source: 'combined', sid, data: { ...parsed, ...pickTotals(directData), recent: parsed.matches } };
      }
      return { source: 'matches', sid, data: parsed };
    }

    lastStatus = matches.status;
    lastMessage = 'Nenhuma partida encontrada nas temporadas recentes.';
  }

  // Sem partidas, mas com totais: ainda dá para mostrar algo útil.
  if (hasUsefulTotals(directData)) {
    return { source: 'stats', data: directData };
  }

  return {
    source: 'error',
    status: lastStatus || seasonError?.status || direct.status,
    message:
      lastMessage ||
      seasonError?.message ||
      direct.message ||
      'A API não retornou estatísticas para esta conta.',
    diagnostic: direct.diagnostic || seasonError?.diagnostic
  };
}

/** Só os campos de total, para não sobrescrever o KDA vindo das partidas. */
function pickTotals(data) {
  const out = {};
  if (data.tc != null) out.matches = Number(data.tc);
  if (data.wc != null) out.wins = Number(data.wc);
  if (data.mvpc != null) out.mvps = Number(data.mvpc);
  if (data.as != null) out.totalAvgScore = Number(data.as);
  if (data.wsc != null) out.winStreak = Number(data.wsc);
  if (data.gt != null) out.hours = Number(data.gt);
  return out;
}

/** Converte qualquer um dos formatos num objeto único e previsível. */
export function normalizeStats(data) {
  const matches = Number(data.matches ?? data.tc ?? 0);
  const wins = Number(data.wins ?? data.wc ?? 0);
  const losses = Number(data.losses ?? Math.max(matches - wins, 0));
  const winRate = matches > 0 ? (wins / matches) * 100 : 0;

  // `as` da API vem em escala x100 (ex.: 762.35 = 7.62).
  let avgScore = null;
  const rawAvg = data.avgScore ?? data.totalAvgScore ?? data.as;
  if (rawAvg != null && Number.isFinite(Number(rawAvg))) {
    const value = Number(rawAvg);
    avgScore = value > 20 ? value / 100 : value;
  }

  const hasKda = data.kills != null && data.deaths != null && data.assists != null;

  return {
    matches,
    wins,
    losses,
    winRate,
    avgScore,
    mvps: Number(data.mvps ?? data.mvpc ?? 0),
    kills: Number(data.kills ?? 0),
    deaths: Number(data.deaths ?? 0),
    assists: Number(data.assists ?? 0),
    hasKda,
    winStreak: data.winStreak ?? data.wsc ?? null,
    hours: data.hours ?? data.gt ?? null,
    recent: data.recent ?? null,
    mostPlayed: data.mostPlayed || data.mo?.hid_e?.n || data.ms?.hid_e?.n || null,
    mostPlayedLane: data.mostPlayedLane || null
  };
}

/** `data` de /user/info pode vir como objeto OU string, conforme o schema. */
export function readUserName(body) {
  const data = body?.data;
  if (!data || typeof data === 'string') return null;
  return data.name || null;
}
