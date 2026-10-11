const RONE_API = 'https://arena.rone.dev/api';
const API_TIMEOUT_MS = 12000;

export async function apiFetch(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    return await fetch(RONE_API + path, {
      ...options,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'SEGA-Stats-Bot/1.0',
        ...(options.headers || {})
      },
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function apiJson(path, options = {}) {
  const response = await apiFetch(path, options);
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

export function isApiSuccess(body) {
  return body?.code === 0 || body?.code === '0';
}

export function apiErrorMessage(body) {
  return body?.msg || body?.message || body?.detail || '';
}

export function authHeaders(jwt) {
  return { Authorization: 'Bearer ' + jwt };
}

export function profileName(data) {
  const value = data?.name || data?.nickname || data?.nick || data?.player_name || null;
  const name = String(value || '').trim();
  return name || null;
}

function sameId(a, b) {
  return String(a ?? '').trim() === String(b ?? '').trim();
}

export async function battleBelongsToPlayer(jwt, roleId, zoneId, battleId) {
  if (!battleId) return { verified: false, reason: 'battle_id_not_detected' };

  try {
    const season = await apiJson('/user/season?lang=pt', { headers: authHeaders(jwt) });
    const sids = Array.isArray(season.body?.data?.sids) ? season.body.data.sids : [];
    if (!season.response.ok || !isApiSuccess(season.body) || !sids.length) {
      return { verified: false, reason: 'history_api_unavailable' };
    }

    // O endpoint direto reduz drasticamente a quantidade de páginas necessárias.
    for (const sid of sids.slice(0, 3)) {
      const direct = await apiJson(
        '/user/matches/' + encodeURIComponent(String(battleId)) +
        '?sid=' + encodeURIComponent(sid) + '&lang=pt',
        { headers: authHeaders(jwt) }
      );

      if (direct.response.ok && isApiSuccess(direct.body)) {
        const participants = Array.isArray(direct.body?.data?.result)
          ? direct.body.data.result
          : [];
        const owner = participants.find(row =>
          sameId(row.rid, roleId) && sameId(row.zid, zoneId)
        );
        if (owner) {
          return {
            verified: true,
            reason: 'battle_and_account_confirmed',
            sid,
            matchId: String(battleId),
            match: owner
          };
        }
      }
    }

    // Fallback limitado às temporadas recentes: no máximo 24 páginas sequenciais.
    for (const sid of sids.slice(0, 3)) {
      let cursor = '';
      for (let page = 0; page < 8; page += 1) {
        const query =
          '/user/matches?sid=' + encodeURIComponent(sid) +
          '&limit=50' +
          (cursor ? '&last_cursor=' + encodeURIComponent(cursor) : '') +
          '&lang=pt';

        const response = await apiJson(query, { headers: authHeaders(jwt) });
        if (!response.response.ok || !isApiSuccess(response.body)) break;

        const rows = Array.isArray(response.body?.data?.result) ? response.body.data.result : [];
        const match = rows.find(row => sameId(row.bid_s ?? row.bid, battleId));

        if (match) {
          const matchId = String(match.bid_s ?? match.bid ?? battleId);
          const details = await apiJson(
            '/user/matches/' + encodeURIComponent(matchId) +
            '?sid=' + encodeURIComponent(sid) + '&lang=pt',
            { headers: authHeaders(jwt) }
          );

          if (!details.response.ok || !isApiSuccess(details.body)) {
            return { verified: false, reason: 'match_details_unavailable', sid, matchId };
          }

          const participants = Array.isArray(details.body?.data?.result)
            ? details.body.data.result
            : [];
          const owner = participants.find(row =>
            sameId(row.rid, roleId) && sameId(row.zid, zoneId)
          );

          if (!owner) return { verified: false, reason: 'account_not_in_match', sid, matchId };

          return {
            verified: true,
            reason: 'battle_and_account_confirmed',
            sid,
            matchId,
            match: owner
          };
        }

        const pageInfo = response.body?.data?.pageInfo || {};
        if (!pageInfo.hasNext || !pageInfo.nextCursor) break;
        cursor = String(pageInfo.nextCursor);
      }
    }

    return { verified: false, reason: 'battle_id_not_found' };
  } catch (error) {
    console.error('❌ Falha ao validar Battle ID:', error);
    return { verified: false, reason: 'history_api_error' };
  }
}

export function normalizeVerifiedMatch(owner, battleId, ocrParsed) {
  const result = Number(owner?.res);
  const scoreRaw = Number(owner?.s);
  const hero = owner?.hid_e?.n || owner?.hid_e?.name || null;

  return {
    ...ocrParsed,
    battleId: String(battleId),
    source: 'rone_api',
    result: result === 1 ? 'win' : result === 0 ? 'loss' : ocrParsed.result,
    kda: {
      kills: Number(owner?.k || 0),
      deaths: Number(owner?.d || 0),
      assists: Number(owner?.a || 0)
    },
    score: Number.isFinite(scoreRaw) ? (scoreRaw > 20 ? scoreRaw / 100 : scoreRaw) : ocrParsed.score,
    mvp: Number(owner?.mvp) === 1,
    hero
  };
}

export async function fetchPlayerOverview(jwt) {
  const result = { stats: null, matches: [], errors: [] };
  const headers = authHeaders(jwt);
  try {
    const response = await apiJson('/user/stats?lang=pt', { headers });
    if (response.response.ok && isApiSuccess(response.body) && response.body.data) result.stats = response.body.data;
    else result.errors.push('stats_http_' + response.response.status);
  } catch (error) { result.errors.push('stats_' + (error?.name || 'error')); }
  try {
    const seasons = await apiJson('/user/season?lang=pt', { headers });
    const sids = seasons.body?.data?.sids;
    if (!seasons.response.ok || !isApiSuccess(seasons.body) || !Array.isArray(sids) || !sids.length) {
      result.errors.push('seasons_unavailable');
      return result;
    }
    for (const sid of sids.slice(0, 2)) {
      let cursor = '';
      for (let page = 0; page < 2; page++) {
        const path = '/user/matches?sid=' + encodeURIComponent(sid) + '&limit=50&lang=pt' +
          (cursor ? '&last_cursor=' + encodeURIComponent(cursor) : '');
        const response = await apiJson(path, { headers });
        if (!response.response.ok || !isApiSuccess(response.body)) {
          result.errors.push('matches_http_' + response.response.status);
          break;
        }
        const rows = response.body?.data?.result;
        if (!Array.isArray(rows)) break;
        for (const row of rows) {
          // IDs de batalha têm mais de 15 dígitos: jamais converter bid_s em Number.
          const battleId = String(row?.bid_s || '');
          if (!/^\d{10,20}$/.test(battleId)) continue;
          result.matches.push(normalizeVerifiedMatch(row, battleId, {}));
        }
        const info = response.body?.data?.pageInfo;
        if (!info?.hasNext || !info?.nextCursor || String(info.nextCursor) === cursor) break;
        cursor = String(info.nextCursor);
      }
    }
  } catch (error) { result.errors.push('matches_' + (error?.name || 'error')); }
  return result;
}
