import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { createWorker } from 'tesseract.js';
import { readJson, updateJson, quarantineJson } from './storage/jsonStore.js';
import { normalizeOcrText, parseScreenshotStats } from './ocr.js';

const DATA_DIR = process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || './data';
const SCREENSHOT_DIR = path.join(DATA_DIR, 'screenshots');
const MATCHES_FILE = path.join(DATA_DIR, 'matches.json');

let workerPromise = null;
let ocrQueue = Promise.resolve();

async function ensureStorage() {
  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
}

async function loadMatches() {
  try {
    const rows = await readJson(MATCHES_FILE, {});
    return rows && typeof rows === 'object' && !Array.isArray(rows) ? rows : {};
  } catch (error) {
    console.error('❌ matches.json corrompido; preservando cópia antes de continuar:', error);
    await quarantineJson(MATCHES_FILE).catch(() => {});
    return {};
  }
}


function withOcrLock(task) {
  const next = ocrQueue
    .catch(() => {})
    .then(task);
  ocrQueue = next.catch(() => {});
  return next;
}

async function getWorker() {
  if (!workerPromise) {
    workerPromise = createWorker('eng').catch(error => {
      workerPromise = null;
      throw error;
    });
  }
  return workerPromise;
}

async function preprocessImage(inputPath, outputPath) {
  await sharp(inputPath)
    .grayscale()
    .resize({ width: 2200, withoutEnlargement: false })
    .normalize()
    .sharpen()
    .png()
    .toFile(outputPath);
}

const SCOREBOARD_ROW_CENTERS = [0.2683, 0.3984, 0.5271, 0.6558, 0.7859];
const SCOREBOARD_SIDES = [
  { side: 'left', leftRatio: 0.025, widthRatio: 0.47 },
  { side: 'right', leftRatio: 0.505, widthRatio: 0.47 }
];

function normalizeNickForRow(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\\u0300-\\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function levenshteinDistance(a, b) {
  const left = String(a || '');
  const right = String(b || '');
  if (!left) return right.length;
  if (!right) return left.length;

  let previous = Array.from({ length: right.length + 1 }, (_, i) => i);
  for (let i = 0; i < left.length; i += 1) {
    const current = [i + 1];
    for (let j = 0; j < right.length; j += 1) {
      const insert = current[j] + 1;
      const remove = previous[j + 1] + 1;
      const replace = previous[j] + (left[i] === right[j] ? 0 : 1);
      current.push(Math.min(insert, remove, replace));
    }
    previous = current;
  }
  return previous[right.length];
}

function similarity(a, b) {
  const left = normalizeNickForRow(a);
  const right = normalizeNickForRow(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.includes(right) || right.includes(left)) {
    return Math.min(0.98, Math.max(left.length, right.length) / Math.min(left.length, right.length) >= 1.5 ? 0.76 : 0.92);
  }
  const distance = levenshteinDistance(left, right);
  return Math.max(0, 1 - distance / Math.max(left.length, right.length));
}

function scoreRowIdentity(text, expectedNick) {
  const target = normalizeNickForRow(expectedNick);
  if (!target) return 0;
  const raw = String(text || '');
  const compact = normalizeNickForRow(raw);
  if (compact.includes(target)) return 1;

  const tokens = raw
    .split(/[^\\p{L}\\p{N}]+/u)
    .map(normalizeNickForRow)
    .filter(token => token.length >= 2);

  let best = similarity(compact, target);
  for (const token of tokens) best = Math.max(best, similarity(token, target));

  // Tesseract pode separar o nick em dois blocos; também testamos pares
  // consecutivos sem espaço.
  for (let i = 0; i < tokens.length - 1; i += 1) {
    best = Math.max(best, similarity(tokens[i] + tokens[i + 1], target));
  }

  return best;
}

function parseTsvWords(tsv) {
  return String(tsv || '')
    .split(/\\r?\\n/)
    .slice(1)
    .map(line => line.split('\\t'))
    .filter(parts => parts.length >= 12)
    .map(parts => ({
      level: Number(parts[0]),
      page: Number(parts[1]),
      block: Number(parts[2]),
      paragraph: Number(parts[3]),
      line: Number(parts[4]),
      word: Number(parts[5]),
      left: Number(parts[6]),
      top: Number(parts[7]),
      width: Number(parts[8]),
      height: Number(parts[9]),
      confidence: Number(parts[10]),
      text: parts.slice(11).join('\\t').trim()
    }))
    .filter(word => word.text && Number.isFinite(word.left) && Number.isFinite(word.top));
}

function findPlayerOcrLine(tsv, expectedNick) {
  const words = parseTsvWords(tsv);
  const target = normalizeNickForRow(expectedNick);
  if (!target || !words.length) return null;

  const grouped = new Map();
  for (const word of words) {
    const key = [word.block, word.paragraph, word.line].join(':');
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(word);
  }

  let best = null;
  for (const lineWords of grouped.values()) {
    lineWords.sort((a, b) => a.left - b.left);
    const text = lineWords.map(word => word.text).join(' ');
    const rowScore = scoreRowIdentity(text, expectedNick);
    if (!best || rowScore > best.similarity) {
      const left = Math.min(...lineWords.map(word => word.left));
      const top = Math.min(...lineWords.map(word => word.top));
      const right = Math.max(...lineWords.map(word => word.left + word.width));
      const bottom = Math.max(...lineWords.map(word => word.top + word.height));
      best = {
        text,
        left,
        top,
        right,
        bottom,
        height: Math.max(1, bottom - top),
        confidence: lineWords.reduce((sum, word) => sum + Math.max(0, word.confidence || 0), 0) / lineWords.length,
        similarity: rowScore
      };
    }
  }

  return best && best.similarity >= 0.55 ? best : null;
}

async function ocrScoreboardRow(worker, imagePath, bounds, expectedNick) {
  const basePath = imagePath.replace(/\\.(?:png|jpg|jpeg)$/i, '') +
    `.row-${bounds.side}-${bounds.rowIndex}`;
  const cropPath = basePath + '.png';
  const invertedPath = basePath + '.inv.png';

  try {
    const margin = 8;
    const metadata = await sharp(imagePath).metadata();
    const imageWidth = metadata.width || 1600;
    const imageHeight = metadata.height || 738;
    const left = Math.max(0, Math.round(bounds.left) - margin);
    const top = Math.max(0, Math.round(bounds.top) - margin);
    const right = Math.min(imageWidth, Math.round(bounds.left + bounds.width) + margin);
    const bottom = Math.min(imageHeight, Math.round(bounds.top + bounds.height) + margin);
    const width = Math.max(20, right - left);
    const height = Math.max(20, bottom - top);

    const common = sharp(imagePath)
      .extract({ left, top, width, height })
      .resize({ width: Math.max(2200, width * 3), withoutEnlargement: false })
      .grayscale()
      .normalize()
      .sharpen()
      .extend({ top: 10, bottom: 10, left: 10, right: 10, background: '#ffffff' });

    await common.clone().png().toFile(cropPath);

    await worker.setParameters({
      tessedit_pageseg_mode: '7',
      preserve_interword_spaces: '1',
      tessedit_char_whitelist: '',
      user_defined_dpi: '300'
    });

    const first = await worker.recognize(cropPath, {}, { text: true });
    const firstText = normalizeOcrText(first.data?.text || '');
    const firstScore = scoreRowIdentity(firstText, expectedNick);

    let bestText = firstText;
    let bestScore = firstScore;

    // Segunda leitura invertida: no placar do MLBB o nick costuma ser texto
    // claro sobre fundo escuro. O Tesseract tende a funcionar melhor quando
    // recebe texto escuro sobre fundo claro.
    if (firstScore < 0.9) {
      await common.clone()
        .negate()
        .threshold(150)
        .png()
        .toFile(invertedPath);

      const second = await worker.recognize(invertedPath, {}, { text: true });
      const secondText = normalizeOcrText(second.data?.text || '');
      const secondScore = scoreRowIdentity(secondText, expectedNick);
      if (secondScore > bestScore) {
        bestText = secondText;
        bestScore = secondScore;
      }
    }

    const kda = parseScreenshotStats(bestText, expectedNick).kda ||
      parseScreenshotStats(bestText, null).kda;

    return {
      side: bounds.side,
      rowIndex: bounds.rowIndex,
      text: bestText.slice(0, 700),
      identityScore: Number(bestScore.toFixed(3)),
      kda,
      bounds: { left, top, width, height }
    };
  } finally {
    await fs.unlink(cropPath).catch(() => {});
    await fs.unlink(invertedPath).catch(() => {});
  }
}

async function readHighlightedPlayerRow(worker, imagePath, tsv, expectedNick) {
  const metadata = await sharp(imagePath).metadata();
  const imageWidth = metadata.width || 1600;
  const imageHeight = metadata.height || 738;
  const candidates = [];

  for (const side of SCOREBOARD_SIDES) {
    for (let rowIndex = 0; rowIndex < SCOREBOARD_ROW_CENTERS.length; rowIndex += 1) {
      const centerY = Math.round(imageHeight * SCOREBOARD_ROW_CENTERS[rowIndex]);
      const rowHeight = Math.max(48, Math.round(imageHeight * 0.105));
      const bounds = {
        side: side.side,
        rowIndex,
        left: Math.round(imageWidth * side.leftRatio),
        top: Math.max(0, centerY - Math.round(rowHeight / 2)),
        width: Math.round(imageWidth * side.widthRatio),
        height: Math.min(rowHeight, imageHeight - Math.max(0, centerY - Math.round(rowHeight / 2)))
      };

      try {
        const candidate = await ocrScoreboardRow(worker, imagePath, bounds, expectedNick);
        candidates.push(candidate);
      } catch (error) {
        console.warn('⚠️ Falha no OCR da linha ' + side.side + '/' + (rowIndex + 1) + ':', error?.message || error);
      }
    }
  }

  // Se o OCR de uma linha isolada não achou o nick, tentamos o TSV global como
  // segunda chance. Isso mantém compatibilidade com prints com layout diferente.
  const tsvLine = findPlayerOcrLine(tsv, expectedNick);
  if (tsvLine) {
    candidates.push({
      side: 'tsv',
      rowIndex: null,
      text: tsvLine.text,
      identityScore: Number(tsvLine.similarity.toFixed(3)),
      kda: parseScreenshotStats(tsvLine.text, expectedNick).kda || parseScreenshotStats(tsvLine.text, null).kda,
      bounds: { left: tsvLine.left, top: tsvLine.top, width: tsvLine.right - tsvLine.left, height: tsvLine.height }
    });
  }

  candidates.sort((a, b) => b.identityScore - a.identityScore);
  const best = candidates[0] || null;
  const second = candidates[1] || null;

  if (!best) return null;

  const gap = best.identityScore - (second?.identityScore || 0);
  const accepted = best.identityScore >= 0.68 && (gap >= 0.06 || best.identityScore >= 0.92);

  return {
    text: best.text,
    kda: best.kda,
    lineText: best.text,
    confidence: Math.round(Math.max(0, Math.min(1, best.identityScore)) * 1000) / 10,
    similarity: best.identityScore,
    selectedByMissingHeart: false,
    selectedSide: best.side,
    selectedRowIndex: best.rowIndex,
    bounds: best.bounds,
    candidates: candidates.slice(0, 10).map(item => ({
      side: item.side,
      rowIndex: item.rowIndex,
      identityScore: item.identityScore,
      kda: item.kda,
      text: item.text
    })),
    accepted,
    runnerUpScore: second?.identityScore || 0
  };
}

async function improveBattleId(worker, imagePath, initialText, tsv) {
  const initial = String(initialText || '').match(/\b\d{14,18}\b/g);
  if (initial?.length) return initial.sort((a, b) => b.length - a.length)[0];

  const numericWords = parseTsvWords(tsv)
    .map(word => ({
      ...word,
      normalized: word.text.replace(/[^0-9OoIl]/g, '').replace(/[Oo]/g, '0').replace(/[Il]/g, '1')
    }))
    .filter(word => /^\d{1,18}$/.test(word.normalized));

  const candidate = numericWords.find(word => word.normalized.length >= 8);

  // Alguns prints fazem o Tesseract separar o Battle ID em vários blocos.
  // Tentamos juntar blocos numéricos que estejam na mesma linha e próximos.
  if (!candidate && numericWords.length) {
    const sorted = numericWords.slice().sort((a, b) => {
      const lineDistance = Math.abs(a.top - b.top);
      return lineDistance || a.left - b.left;
    });

    for (let i = 0; i < sorted.length; i += 1) {
      let combined = sorted[i].normalized;
      let last = sorted[i];

      for (let j = i + 1; j < sorted.length; j += 1) {
        const next = sorted[j];
        const sameLine = Math.abs(next.top - last.top) <= Math.max(last.height, next.height) * 0.8;
        const closeEnough = next.left - (last.left + last.width) <= Math.max(120, last.height * 2.5);
        if (!sameLine || !closeEnough) break;

        combined += next.normalized;
        last = next;

        if (combined.length >= 10 && combined.length <= 18) {
          return combined;
        }
        if (combined.length > 18) break;
      }
    }
  }

  let targetPath = imagePath;
  let cropPath = null;

  try {
    if (candidate) {
      const metadata = await sharp(imagePath).metadata();
      const margin = 40;
      const left = Math.max(0, candidate.left - margin);
      const top = Math.max(0, candidate.top - margin);
      const right = Math.min(metadata.width || candidate.left + candidate.width, candidate.left + candidate.width + margin);
      const bottom = Math.min(metadata.height || candidate.top + candidate.height, candidate.top + candidate.height + margin);
      const width = Math.max(1, right - left);
      const height = Math.max(1, bottom - top);
      cropPath = imagePath.replace(/\.png$/i, '.battle.png');
      await sharp(imagePath).extract({ left, top, width, height }).resize({ width: Math.max(width * 3, 900) }).png().toFile(cropPath);
      targetPath = cropPath;
    }

    await worker.setParameters({ tessedit_char_whitelist: '0123456789' });
    const result = await worker.recognize(targetPath);
    await worker.setParameters({ tessedit_char_whitelist: '' });

    const text = normalizeOcrText(result.data?.text || '');
    const ids = text.match(/\b\d{10,18}\b/g) || [];
    return ids.sort((a, b) => b.length - a.length)[0] || null;
  } finally {
    await worker.setParameters({ tessedit_char_whitelist: '' }).catch(() => {});
    if (cropPath) await fs.unlink(cropPath).catch(() => {});
  }
}

async function downloadTelegramFile(ctx, fileId, filePath) {
  const url = await ctx.telegram.getFileLink(fileId);
  const response = await fetch(url.href || String(url));
  if (!response.ok) throw new Error('Falha ao baixar a imagem do Telegram: HTTP ' + response.status);
  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(filePath, buffer);
}

export async function processScreenshot(ctx, player) {
  await ensureStorage();

  const message = ctx.message || {};
  const photos = Array.isArray(message.photo) ? message.photo : [];
  const document = message.document;
  if (!photos.length && !(document?.mime_type || '').startsWith('image/')) {
    throw new Error('Nenhuma imagem recebida.');
  }

  const id = crypto.randomUUID();
  const originalName = document?.file_name || '';
  const extension = photos.length
    ? '.jpg'
    : (path.extname(originalName).toLowerCase() || '.jpg');
  const imagePath = path.join(SCREENSHOT_DIR, id + extension);

  const fileId = photos.length ? photos[photos.length - 1].file_id : document.file_id;
  await downloadTelegramFile(ctx, fileId, imagePath);

  const imageBuffer = await fs.readFile(imagePath);
  const imageHash = crypto.createHash('sha256').update(imageBuffer).digest('hex');

  const worker = await getWorker();
  const processedPath = path.join(SCREENSHOT_DIR, id + '-ocr.png');
  await preprocessImage(imagePath, processedPath);

  const result = await withOcrLock(() => worker.recognize(processedPath, {}, { text: true, tsv: true }));
  const rawOcrText = String(result.data?.text || '');
  const ocrText = normalizeOcrText(rawOcrText);
  const ocrLines = rawOcrText
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .slice(0, 120);

  const parsed = parseScreenshotStats(rawOcrText, player.name);

  // O placar final do MLBB organiza cada jogador em uma linha horizontal.
  // O TSV do Tesseract traz posição/linha de cada palavra; usamos o nick
  // cadastrado para localizar exatamente a linha selecionada e fazemos uma
  // segunda leitura focada nessa faixa. Isso evita misturar o K/D/A de outro
  // jogador com o nick correto.
  const highlightedRow = await withOcrLock(() =>
    readHighlightedPlayerRow(worker, imagePath, result.data?.tsv, player.name)
  );

  if (highlightedRow?.text) {
    parsed.playerRowOcr = highlightedRow.text.slice(0, 1200);
    parsed.playerRowFound = true;
    parsed.playerRowIdentityScore = Number.isFinite(highlightedRow.similarity)
      ? Number(highlightedRow.similarity.toFixed(3))
      : null;
    parsed.playerRowConfidence = Number.isFinite(highlightedRow.confidence)
      ? Number(highlightedRow.confidence.toFixed(1))
      : null;
    parsed.playerRowSelectedByMissingHeart = Boolean(highlightedRow.selectedByMissingHeart);
    parsed.playerRowSelectedSide = highlightedRow.selectedSide || null;
    parsed.playerRowIndex = Number.isInteger(highlightedRow.selectedRowIndex)
      ? highlightedRow.selectedRowIndex
      : null;

    if (highlightedRow.kda) {
      parsed.kda = highlightedRow.kda;
      parsed.kdaSource = 'highlighted_player_row';
    }
  }

  if (!parsed.battleId) {
    parsed.battleId = await withOcrLock(() =>
      improveBattleId(worker, processedPath, rawOcrText, result.data?.tsv)
    );
  }

  // Se o OCR inicial não encontrou o Battle ID, a segunda leitura pode tê-lo
  // encontrado. Reclassificamos a tela aqui para não descartá-la como unknown.
  if (parsed.battleId && parsed.kda) parsed.kind = 'match_result';

  if (highlightedRow) {
    parsed.playerRowAccepted = Boolean(highlightedRow.accepted);
    parsed.playerRowRunnerUpScore = Number(highlightedRow.runnerUpScore || 0);
    parsed.playerRowCandidates = highlightedRow.candidates || [];
  }

  await fs.unlink(processedPath).catch(() => {});

  // Uma tela que não foi reconhecida com segurança não deve ser persistida.
  if (parsed.kind === 'unknown') {
    await fs.unlink(imagePath).catch(() => {});
    return {
      id,
      ignored: true,
      reason: 'unknown_screenshot',
      parsed
    };
  }

  let createdRecord = null;
  await updateJson(MATCHES_FILE, {}, matches => {
    const telegramId = String(ctx.from.id);
    if (!Array.isArray(matches[telegramId])) matches[telegramId] = [];

    // Só uma partida já contabilizável pode bloquear uma nova tentativa.
    // Registros rejeitados ou pendentes não são duplicados: o usuário pode reenviar.
    const duplicate = matches[telegramId].find(item => {
      if (!['verified_match', 'verified_ocr'].includes(item.verification)) return false;
      return (
        (item.imageHash && item.imageHash === imageHash) ||
        (parsed.battleId && item.parsed?.battleId && String(item.parsed.battleId) === String(parsed.battleId))
      );
    });

    createdRecord = {
      id,
      telegramId: ctx.from.id,
      roleId: player.roleId,
      zoneId: player.zoneId,
      playerName: player.name || null,
      createdAt: new Date().toISOString(),
      imageFile: path.relative(DATA_DIR, imagePath),
      imageHash,
      kind: parsed.kind,
      parsed,
      verification: duplicate ? 'duplicate' : 'pending',
      duplicateOf: duplicate?.id || null,
      duplicate: Boolean(duplicate),
      ocrText: ocrText.slice(0, 2500),
      ocrLines
    };

    matches[telegramId].push(createdRecord);
    return matches;
  });

  return createdRecord;
}

export async function cleanupScreenshots() {
  const retentionDays = Math.max(1, Number(process.env.SCREENSHOT_RETENTION_DAYS || 90));
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const referenced = new Set();

  await updateJson(MATCHES_FILE, {}, async matches => {
    for (const [telegramId, records] of Object.entries(matches || {})) {
      if (!Array.isArray(records)) continue;
      const kept = [];

      for (const record of records) {
        const createdAt = Date.parse(record.createdAt || '');
        if (Number.isFinite(createdAt) && createdAt < cutoff) {
          if (record.imageFile) {
            await fs.unlink(path.join(DATA_DIR, record.imageFile)).catch(() => {});
          }
          continue;
        }
        if (record.imageFile) referenced.add(path.resolve(DATA_DIR, record.imageFile));
        kept.push(record);
      }

      matches[telegramId] = kept;
    }
    return matches;
  });

  const files = await fs.readdir(SCREENSHOT_DIR).catch(() => []);
  for (const file of files) {
    if (!/\.(?:jpg|jpeg|png|webp)$/i.test(file)) continue;
    const fullPath = path.resolve(SCREENSHOT_DIR, file);
    if (referenced.has(fullPath)) continue;
    const stat = await fs.stat(fullPath).catch(() => null);
    if (stat?.mtimeMs && stat.mtimeMs < cutoff) {
      await fs.unlink(fullPath).catch(() => {});
    }
  }
}

export async function recordVerifiedBattle(telegramId, player, parsed) {
  const id = crypto.randomUUID();
  const battleId = String(parsed?.battleId || '').trim();
  if (!battleId) throw new Error('Battle ID ausente.');

  let createdRecord = null;
  await updateJson(MATCHES_FILE, {}, matches => {
    const key = String(telegramId);
    if (!Array.isArray(matches[key])) matches[key] = [];

    const duplicate = matches[key].find(item =>
      ['verified_match', 'verified_ocr'].includes(item.verification) &&
      item.parsed?.battleId &&
      String(item.parsed.battleId) === battleId
    );

    createdRecord = {
      id,
      telegramId: Number(telegramId),
      roleId: player.roleId,
      zoneId: player.zoneId,
      playerName: player.name || null,
      createdAt: new Date().toISOString(),
      imageFile: null,
      imageHash: null,
      inputType: 'battle_id',
      kind: 'match_result',
      parsed,
      verification: duplicate ? 'duplicate' : 'verified_match',
      duplicateOf: duplicate?.id || null,
      duplicate: Boolean(duplicate),
      ocrText: '',
      ocrLines: [],
      verificationReason: duplicate ? 'battle_id_already_verified' : 'battle_and_account_confirmed',
      verifiedAt: duplicate ? null : new Date().toISOString()
    };

    matches[key].push(createdRecord);
    return matches;
  });

  return createdRecord;
}

export async function getPlayerScreenshots(telegramId) {
  const matches = await loadMatches();
  return Array.isArray(matches[String(telegramId)]) ? matches[String(telegramId)] : [];
}

export function summarizePlayerScreenshots(records) {
  const list = Array.isArray(records) ? records : [];
  const validMatches = list.filter(item => ['verified_match', 'verified_ocr'].includes(item.verification));
  const wins = validMatches.filter(item => item.parsed?.result === 'win').length;
  const losses = validMatches.filter(item => item.parsed?.result === 'loss').length;
  const kdas = validMatches.map(item => item.parsed?.kda).filter(Boolean);
  const kills = kdas.reduce((sum, kda) => sum + Number(kda.kills || 0), 0);
  const deaths = kdas.reduce((sum, kda) => sum + Number(kda.deaths || 0), 0);
  const assists = kdas.reduce((sum, kda) => sum + Number(kda.assists || 0), 0);
  const scores = validMatches.map(item => Number(item.parsed?.score)).filter(Number.isFinite);
  const averageScore = scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : 0;
  const mvps = validMatches.filter(item => item.parsed?.mvp === true).length;
  const matches = validMatches.length;
  const winRate = matches > 0 ? (wins / matches) * 100 : 0;

  return {
    screenshots: list.length,
    verifiedMatches: matches,
    pendingMatches: list.filter(item => ['pending_api_confirmation', 'pending_name_confirmation', 'pending'].includes(item.verification)).length,
    rejectedMatches: list.filter(item => item.verification === 'rejected_name_mismatch').length,
    duplicates: list.filter(item => item.verification === 'duplicate').length,
    verifiedProfiles: list.filter(item => item.verification === 'verified_profile').length,
    matchResults: wins + losses,
    wins, losses, kills, deaths, assists, averageScore, mvps, winRate
  };
}

export async function getAllPlayerScreenshotSummaries() {
  const matches = await loadMatches();
  return Object.entries(matches).map(([telegramId, records]) => {
    const list = Array.isArray(records) ? records : [];
    const latestNamed = [...list].reverse().find(item => item.playerName);
    return { telegramId: Number(telegramId), name: latestNamed?.playerName || null, summary: summarizePlayerScreenshots(list) };
  });
}

export async function updateScreenshotVerification(telegramId, recordId, verification, patch = {}) {
  let updatedRecord = null;
  await updateJson(MATCHES_FILE, {}, matches => {
    const list = Array.isArray(matches[String(telegramId)]) ? matches[String(telegramId)] : [];
    const record = list.find(item => item.id === recordId);
    if (!record) return matches;
    Object.assign(record, patch, { verification });
    updatedRecord = { ...record };
    return matches;
  });
  return updatedRecord;
}
