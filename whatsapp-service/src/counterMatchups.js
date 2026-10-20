// A matchup is directional: A countering B is not the same as B countering A.
// The Academy impact is measured from the queried (main) hero's point of view:
// negative impact => opponent is strong AGAINST the main hero;
// positive impact => the main hero is strong AGAINST that opponent.
export function selectAcademyMatchups(record, namesById, direction = 'against') {
  if (direction !== 'against' && direction !== 'targets') return [];
  const rows = [...(record?.sub_hero || []), ...(record?.sub_hero_last || [])];
  const selected = [];

  for (const row of rows) {
    if (row?.increase_win_rate == null) continue;
    const impact = Number(row.increase_win_rate);
    if (!Number.isFinite(impact) || impact === 0) continue;
    if (direction === 'against' ? impact >= 0 : impact <= 0) continue;
    if (String(row.heroid) === String(record.main_heroid)) continue;

    const name = namesById.get(String(row.heroid));
    if (name) selected.push({ name, edge: Math.abs(impact) });
  }

  const seen = new Set();
  return selected
    .sort((a, b) => b.edge - a.edge)
    .filter(({ name }) => {
      const key = name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 5)
    .map(({ name }) => name);
}

// Matrix documentation: counters[a][b] is the win-rate advantage of A OVER B.
// Incoming counters read the target column; outgoing counters read its row.
export function selectMatrixMatchups(live, targetId, direction = 'against') {
  if (direction !== 'against' && direction !== 'targets') return [];
  const counters = live?.matrix?.counters;
  if (!Array.isArray(live?.heroes) || !counters || targetId == null) return [];

  const namesById = new Map(live.heroes.map(hero => [String(hero.i), hero.n]));
  const opponents = direction === 'against'
    ? Object.entries(counters).map(([id, matchups]) => ({
      id, edge: Number(matchups?.[String(targetId)])
    }))
    : Object.entries(counters[String(targetId)] || {}).map(([id, value]) => ({
      id, edge: Number(value)
    }));

  const seen = new Set();
  return opponents
    .filter(({ id, edge }) => String(id) !== String(targetId) && Number.isFinite(edge) && edge > 0 && namesById.has(String(id)))
    .sort((a, b) => b.edge - a.edge)
    .filter(({ id }) => {
      if (seen.has(String(id))) return false;
      seen.add(String(id));
      return true;
    })
    .slice(0, 5)
    .map(({ id }) => namesById.get(String(id)));
}
