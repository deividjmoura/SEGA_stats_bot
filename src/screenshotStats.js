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

function parseTsvWords(tsv) {
  return String(tsv || '')
    .split(/\r?\n/)
    .slice(1)
    .map(line => line.split('\t'))
    .filter(parts => parts.length >= 12)
    .map(parts => ({
      block: Number(parts[2]),
      paragraph: Number(parts[3]),
      line: Number(parts[4]),
      left: Number(parts[6]),
      top: Number(parts[7]),
      width: Number(parts[8]),
      height: Number(parts[9]),
      confidence: Number(parts[10]),
      text: String(parts[11] || '').trim()
    }))
    .filter(word =>
      Number.isFinite(word.left) &&
      Number.isFinite(word.top) &&
      word.width > 0 &&
      word.height > 0 &&
      word.text
    );
}

function normalizeNickForOcr(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\\u0300-\\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function levenshteinSimilarity(a, b) {
  const left = String(a || '');
  const right = String(b || '');
  if (!left || !right) return 0;
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);

  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + cost
      );
    }
    previous.splice(0, previous.length, ...current);
  }

  return 1 - previous[right.length] / Math.max(left.length, right.length);
}

function findPlayerOcrLine(tsv, expectedNick) {
  const target = normalizeNickForOcr(expectedNick);
  if (!target || target.length < 3) return null;

  const words = parseTsvWords(tsv);
  const groups = new Map();

  for (const word of words) {
    const key = [word.block, word.paragraph, word.line].join(':');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(word);
  }

  const candidates = [...groups.values()]
    .map(group => {
      group.sort((a, b) => a.left - b.left);
      const text = group.map(word => word.text).join(' ');
      const compact = normalizeNickForOcr(text);
      const targetIndex = compact.indexOf(target);
      let similarity = targetIndex >= 0 ? 1 : 0;
      if (targetIndex < 0 && compact) {
        const minWindow = Math.max(3, target.length - 2);
        const maxWindow = Math.min(compact.length, target.length + 4);
        for (let size = minWindow; size <= maxWindow; size += 1) {
          for (let start = 0; start + size <= compact.length; start += 1) {
            similarity = Math.max(similarity, levenshteinSimilarity(target, compact.slice(start, start + size)));
          }
        }
      }
      return {
        words: group,
        text,
        compact,
        targetIndex,
        similarity,
        confidence: group.reduce((sum, word) => sum + (Number.isFinite(word.confidence) ? word.confidence : 0), 0) / group.length
      };
    })
    .filter(group => group.targetIndex >= 0 || group.similarity >= 0.58);

  if (!candidates.length) return null;

  candidates.sort((a, b) => {
    const aExact = a.compact === target ? 1 : 0;
    const bExact = b.compact === target ? 1 : 0;
    return bExact - aExact || b.similarity - a.similarity || b.confidence - a.confidence;
  });

  const best = candidates[0];
  const left = Math.min(...best.words.map(word => word.left));
  const top = Math.min(...best.words.map(word => word.top));
  const right = Math.max(...best.words.map(word => word.left + word.width));
  const bottom = Math.max(...best.words.map(word => word.top + word.height));

  return {
    ...best,
    left,
    top,
    right,
    bottom,
    height: Math.max(1, bottom - top)
  };
}

async function readHighlightedPlayerRow(worker, imagePath, tsv, expectedNick) {
  const line = findPlayerOcrLine(tsv, expectedNick);
  if (!line) return null;

  const metadata = await sharp(imagePath).metadata();
  const imageWidth = metadata.width || line.right;
  const imageHeight = metadata.height || line.bottom;

  // A linha do jogador é a região mais confiável para o K/D/A.
  // Abrimos um pouco acima/abaixo para capturar nome, K/D/A e o restante da linha.
  const verticalPadding = Math.max(24, Math.round(line.height * 1.35));
  const left = 0;
  const top = Math.max(0, line.top - verticalPadding);
  const width = imageWidth;
  const height = Math.min(imageHeight - top, Math.max(line.height * 3.2, 100));

  const cropPath = imagePath.replace(/\.png$/i, '.player-row.png');

  try {
    await sharp(imagePath)
      .extract({ left, top, width, height })
      .resize({ width: Math.max(width, 2600), withoutEnlargement: false })
      .normalize()
      .sharpen()
      .png()
      .toFile(cropPath);

    await worker.setParameters({
      tessedit_pageseg_mode: '6',
      preserve_interword_spaces: '1',
      tessedit_char_whitelist: ''
    });

    const result = await worker.recognize(cropPath, {}, { text: true, tsv: true });
    const text = String(result.data?.text || '').trim();

    return {
      text,
      kda: parseScreenshotStats(text, expectedNick).kda || parseScreenshotStats(text, null).kda,
      lineText: line.text,
      confidence: line.confidence,
      similarity: line.similarity,
      bounds: { left, top, width, height }
    };
  } finally {
    await worker.setParameters({
      tessedit_pageseg_mode: '6',
      preserve_interword_spaces: '0',
      tessedit_char_whitelist: ''
    }).catch(() => {});
    await fs.unlink(cropPath).catch(() => {});
  }
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
    readHighlightedPlayerRow(worker, processedPath, result.data?.tsv, player.name)
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
      item.verification === 'verified_match' &&
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
  const validMatches = list.filter(item => item.verification === 'verified_match');
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
