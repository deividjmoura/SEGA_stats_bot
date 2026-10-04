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
    const rawLine = String(line || '');
    const compactLine = normalizeNick(rawLine);

    // O OCR pode colar o nome do clã, separadores ou símbolos ao nick
    // (ex.: "SEGA | Deivid", "SEGA_Deivid", "SEGADeivid").
    // Se o nick confirmado aparecer dentro da linha, consideramos a identidade
    // encontrada. O Battle ID + Role ID continuam sendo a segunda barreira.
    if (compactLine.includes(target)) return true;

    return rawLine
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .map(normalizeNick)
      .filter(Boolean)
      .some(token => token === target || token.includes(target));
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
  const rawLines = String(text || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  const parseLine = (rawLine) => {
    const line = rawLine
      .replace(/[Oo]/g, '0')
      .replace(/[Il]/g, '1');

    let match = line.match(/\b(\d{1,2})\s*[/:|\\-]\s*(\d{1,2})\s*[/:|\\-]\s*(\d{1,2})\b/);
    if (!match) {
      match = line.match(/\b(\d{1,2})\s+(\d{1,2})\s+(\d{1,2})\b/);
    }
    if (!match) return null;

    const values = [Number(match[1]), Number(match[2]), Number(match[3])];
    if (values.some(value => value > 99)) return null;

    return {
      kills: values[0],
      deaths: values[1],
      assists: values[2]
    };
  };

  if (expectedNick) {
    const target = normalizeNick(expectedNick);
    const nickLineIndexes = rawLines
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => normalizeNick(line).includes(target))
      .map(item => item.index);

    const nearbyMatches = [];
    for (const nickIndex of nickLineIndexes) {
      for (let lineIndex = 0; lineIndex < rawLines.length; lineIndex += 1) {
        const parsed = parseLine(rawLines[lineIndex]);
        if (!parsed) continue;
        nearbyMatches.push({
          distance: Math.abs(lineIndex - nickIndex),
          ...parsed
        });
      }
    }

    if (nearbyMatches.length) {
      nearbyMatches.sort((a, b) => a.distance - b.distance);
      const best = nearbyMatches[0];
      return {
        kills: best.kills,
        deaths: best.deaths,
        assists: best.assists
      };
    }
  }

  const lineMatches = rawLines
    .map(parseLine)
    .filter(Boolean);

  if (lineMatches.length) return lineMatches[0];

  // Fallback global para OCR que devolve o placar numa única linha.
  const matches = [...source.matchAll(/\b(\d{1,2})\s*[/:|\\-]\s*(\d{1,2})\s*[/:|\\-]\s*(\d{1,2})\b/g)];
  if (!matches.length) return null;

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

  // Alguns placares finais do MLBB usam uma arte/bandeira que o OCR não
  // reconhece como "VICTORY/DEFEAT". Se já temos o padrão forte de uma tela
  // final — Battle ID longo + K/D/A — não descarte a imagem como "unknown".
  // A verificação da partida continua sendo feita pela API usando o Battle ID.
  if (battleId && kda) {
    parsed.kind = 'match_result';
  }

  if (/\b(victory|vitória)\b/i.test(source)) parsed.result = 'win';
  else if (/\b(defeat|derrota)\b/i.test(source)) parsed.result = 'loss';

  const scoreMatch = source.match(/(?:score|rating|grade|pontua[cç][aã]o)\s*[:=]?\s*(\d{1,3}(?:[.,]\d{1,2})?)/i);
  if (scoreMatch) parsed.score = Number(scoreMatch[1].replace(',', '.'));

  return parsed;
}
