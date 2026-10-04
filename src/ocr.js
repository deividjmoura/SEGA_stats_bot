export function normalizeOcrText(text) {
  return String(text || '')
    .replace(/[|]/g, '1')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeNick(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

export function nickMatches(expected, text, lines = []) {
  const target = normalizeNick(expected);
  if (!target || target.length < 3) return false;

  const candidates = [
    ...(Array.isArray(lines) ? lines : []),
    ...String(text || '').split(/\r?\n/)
  ];

  return candidates.some(line => {
    const compactLine = normalizeNick(line);
    if (compactLine === target) return true;
    return String(line || '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .map(normalizeNick)
      .filter(Boolean)
      .includes(target);
  });
}

export function parseNumbers(text) {
  const source = normalizeOcrText(text);
  return [...source.matchAll(/\b\d{1,4}(?:[.,]\d{1,2})?\b/g)]
    .map(match => Number(match[0].replace(',', '.')))
    .filter(Number.isFinite);
}

export function parseKda(text, expectedNick = null) {
  const source = normalizeOcrText(text);
  const matches = [...source.matchAll(/\b(\d{1,2})\s*[/:|\\-]\s*(\d{1,2})\s*[/:|\\-]\s*(\d{1,2})\b/g)];
  if (!matches.length) return null;

  if (expectedNick) {
    const rawLines = String(text || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const target = normalizeNick(expectedNick);
    const nickLineIndexes = rawLines
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => normalizeNick(line).includes(target))
      .map(item => item.index);

    for (const index of nickLineIndexes) {
      const nearby = rawLines.slice(Math.max(0, index - 1), Math.min(rawLines.length, index + 3)).join(' ');
      const nearbyMatch = nearby.match(/\b(\d{1,2})\s*[/:|\\-]\s*(\d{1,2})\s*[/:|\\-]\s*(\d{1,2})\b/);
      if (nearbyMatch) {
        return {
          kills: Number(nearbyMatch[1]),
          deaths: Number(nearbyMatch[2]),
          assists: Number(nearbyMatch[3])
        };
      }
    }
  }

  return {
    kills: Number(matches[0][1]),
    deaths: Number(matches[0][2]),
    assists: Number(matches[0][3])
  };
}

export function parseWinRate(text) {
  const match = normalizeOcrText(text).match(/(\d{1,3}(?:[.,]\d{1,2})?)\s*%/);
  return match ? Number(match[1].replace(',', '.')) : null;
}

export function detectKind(text) {
  const source = normalizeOcrText(text).toLowerCase();
  const finalWords = ['victory', 'defeat', 'mvp', 'battlefield', 'result', 'vitória', 'derrota', 'resultado'];
  const profileWords = ['win rate', 'winrate', 'matches', 'games', 'heroes', 'season', 'taxa de vitória', 'partidas'];
  const battlesWords = ['batalhas', 'battles', 'battle history', 'match history', 'histórico de batalhas', 'histórico'];
  const finalScore = finalWords.filter(word => source.includes(word)).length;
  const profileScore = profileWords.filter(word => source.includes(word)).length;
  const battlesScore = battlesWords.filter(word => source.includes(word)).length;
  if (finalScore > profileScore && finalScore >= battlesScore) return 'match_result';
  if (battlesScore > profileScore) return 'battles';
  if (profileScore > 0) return 'profile';
  return 'unknown';
}

export function parseScreenshotStats(text, expectedNick = null) {
  const source = normalizeOcrText(text);
  const kda = parseKda(text, expectedNick);
  const winRate = parseWinRate(source);
  const numbers = parseNumbers(source);
  const longNumbers = source.match(/\b\d{14,18}\b/g) || [];
  const battleId = longNumbers.sort((a, b) => b.length - a.length)[0] || null;

  const parsed = {
    kind: detectKind(source),
    winRate,
    kda,
    battleId,
    mvp: /\bmvp\b/i.test(source),
    rawNumbers: numbers.slice(0, 30)
  };

  if (/\b(victory|vitória)\b/i.test(source)) parsed.result = 'win';
  else if (/\b(defeat|derrota)\b/i.test(source)) parsed.result = 'loss';

  const scoreMatch = source.match(/(?:score|rating|grade|pontua[cç][aã]o)\s*[:=]?\s*(\d{1,3}(?:[.,]\d{1,2})?)/i);
  if (scoreMatch) parsed.score = Number(scoreMatch[1].replace(',', '.'));

  return parsed;
}
