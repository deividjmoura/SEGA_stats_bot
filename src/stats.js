import { apiJson, authHeaders } from './api.js';

export function parseMatchStats(matches) {
  const rows = Array.isArray(matches) ? matches : [];
  const total = rows.length;
  const wins = rows.filter((m) => Number(m.res) === 1).length;
  const mvps = rows.filter((m) => Number(m.mvp) === 1).length;
  const kills = rows.reduce((sum, m) => sum + Number(m.k || 0), 0);
  const deaths = rows.reduce((sum, m) => sum + Number(m.d || 0), 0);
  const assists = rows.reduce((sum, m) => sum + Number(m.a || 0), 0);
  const scores = rows.map((m) => Number(m.s || 0)).filter(Number.isFinite);
  const avgScore = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length / 100 : 0;

  const heroes = new Map();
  for (const m of rows) {
    const name = m.hid_e?.n || String(m.hid || 'Desconhecido');
    heroes.set(name, (heroes.get(name) || 0) + 1);
  }
  const mostPlayed = [...heroes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;

  return {
    matches: total,
    wins,
    losses: Math.max(total - wins, 0),
    mvps,
    kills,
    deaths,
    assists,
    avgScore,
    mostPlayed
  };
}

function hasUsefulTotals(data) {
  return data && (data.tc != null || data.wc != null || data.matches != null);
}

/**
 * Busca as estatísticas do jogador.
 * 1) /user/stats (quando disponível)
 * 2) fallback: temporada + partidas recentes
 * Retorna { source: 'stats' | 'matches' | 'error', data?, status?, message? }
 */
export async function fetchPlayerStats(jwt) {
  const headers = authHeaders(jwt);

  const direct = await apiJson('/user/stats?lang=pt', { headers });
  if (direct.unauthorized) {
    return { source: 'error', unauthorized: true, status: direct.status, message: direct.message };
  }
  if (direct.ok && hasUsefulTotals(direct.body?.data)) {
    return { source: 'stats', data: direct.body.data };
  }

  // Fallback. Atenção: a API só aceita lang=pt (não pt_BR).
  const season = await apiJson('/user/season?lang=pt', { headers });
  if (season.unauthorized) {
    return { source: 'error', unauthorized: true, status: season.status, message: season.message };
  }

  const sids = Array.isArray(season.body?.data?.sids) ? season.body.data.sids : [];
  if (!season.ok || sids.length === 0) {
    return {
      source: 'error',
      status: season.status || direct.status,
      message: season.message || direct.message || 'A API não retornou temporadas para esta conta.'
    };
  }

  let lastMessage = '';
  let lastStatus = 0;

  for (const sid of sids.slice(0, 3)) {
    const matches = await apiJson(
      `/user/matches?sid=${encodeURIComponent(sid)}&limit=50&lang=pt`,
      { headers }
    );

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
      return { source: 'matches', data: parseMatchStats(rows), sid };
    }

    lastStatus = matches.status;
    lastMessage = 'Nenhuma partida encontrada nas temporadas recentes.';
  }

  // Última cartada: se /user/stats devolveu algo, mesmo incompleto, usa.
  if (direct.ok && direct.body?.data) {
    return { source: 'stats', data: direct.body.data };
  }

  return {
    source: 'error',
    status: lastStatus,
    message: lastMessage || direct.message || 'A API não retornou estatísticas.'
  };
}

/** Normaliza os dois formatos possíveis (stats direto ou derivado de partidas). */
export function normalizeStats(data) {
  const matches = Number(data.matches ?? data.tc ?? 0);
  const wins = Number(data.wins ?? data.wc ?? 0);
  const losses = Number(data.losses ?? Math.max(matches - wins, 0));
  const winRate = matches > 0 ? (wins / matches) * 100 : 0;

  let avgScore = null;
  if (data.avgScore != null && Number.isFinite(Number(data.avgScore))) {
    avgScore = Number(data.avgScore);
  } else if (data.as != null && Number.isFinite(Number(data.as))) {
    const raw = Number(data.as);
    avgScore = raw > 20 ? raw / 100 : raw;
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
    mostPlayed: data.mostPlayed || data.mo?.hid_e?.n || data.ms?.hid_e?.n || null
  };
}
