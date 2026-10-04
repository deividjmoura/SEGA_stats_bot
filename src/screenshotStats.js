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

function heartPresenceScore(buffer) {
  const pixels = buffer;
  const count = pixels.length / 3;
  let mean = 0;
  let sumSq = 0;

  for (let i = 0; i < pixels.length; i += 3) {
    const gray = pixels[i] * 0.299 + pixels[i + 1] * 0.587 + pixels[i + 2] * 0.114;
    mean += gray;
    sumSq += gray * gray;
  }

  mean /= count;
  const variance = Math.max(0, sumSq / count - mean * mean);

  // O coração desenha um contorno e preenchimento dentro da pequena região.
  // A linha sem coração é muito mais uniforme. Medimos variação local e
  // bordas para distinguir "não há coração" de um coração escuro.
  let edge = 0;
  const width = Math.sqrt(count * 0.9);
  const approxWidth = Math.max(1, Math.round(width));
  const rows = Math.max(1, Math.floor(count / approxWidth));

  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < approxWidth - 1; x += 1) {
      const i = (y * approxWidth + x) * 3;
      const j = i + 3;
      if (j >= pixels.length) break;
      const a = pixels[i] * 0.299 + pixels[i + 1] * 0.587 + pixels[i + 2] * 0.114;
      const b = pixels[j] * 0.299 + pixels[j + 1] * 0.587 + pixels[j + 2] * 0.114;
      edge += Math.abs(a - b);
    }
  }

  edge /= Math.max(1, count);
  return {
    texture: Math.sqrt(variance),
    edge,
    score: Math.sqrt(variance) + edge
  };
}

async function detectSelectedRowByHeart(imagePath) {
  const metadata = await sharp(imagePath).metadata();
  const imageWidth = metadata.width || 1600;
  const imageHeight = metadata.height || 738;
  const rowCenters = [0.2683, 0.3984, 0.5271, 0.6558, 0.7859];
  const sides = [
    { side: 'left', x: 0.101 },
    { side: 'right', x: 0.895 }
  ];
  const candidates = [];

  for (const side of sides) {
    for (let rowIndex = 0; rowIndex < rowCenters.length; rowIndex += 1) {
      const centerY = Math.round(imageHeight * rowCenters[rowIndex]);
      const roiWidth = Math.max(20, Math.round(imageWidth * 0.028));
      const roiHeight = Math.max(20, Math.round(imageHeight * 0.06));
      const left = Math.max(0, Math.min(
        imageWidth - roiWidth,
        Math.round(imageWidth * side.x - roiWidth / 2)
      ));
      const top = Math.max(0, Math.min(
        imageHeight - roiHeight,
        centerY - Math.round(roiHeight / 2)
      ));

      const { data } = await sharp(imagePath)
        .extract({ left, top, width: roiWidth, height: roiHeight })
        .raw()
        .toBuffer({ resolveWithObject: true });

      const presence = heartPresenceScore(data);
      candidates.push({
        side: side.side,
        rowIndex,
        presence,
        bounds: { left, top, width: roiWidth, height: roiHeight }
      });
    }
  }

  // O jogador da conta é a linha que não oferece o botão "seguir".
  // Portanto, procuramos o menor sinal de coração entre as 10 linhas.
  const sorted = candidates.slice().sort((a, b) => a.presence.score - b.presence.score);
  const best = sorted[0];
  const second = sorted[1];

  if (!best || !second) return null;

  const gap = second.presence.score - best.presence.score;
  const ratio = best.presence.score > 0
    ? second.presence.score / best.presence.score
    : Infinity;

  // No print de referência, a linha sem coração tem textura/bordas muito
  // menores que qualquer linha que contém o botão. Exigimos uma diferença
  // clara para não escolher uma linha por ruído.
  if (best.presence.score >= 8 || (gap < 0.8 && ratio < 1.35)) {
    return null;
  }

  return {
    ...best,
    confidence: Math.min(1, Math.max(0, gap / Math.max(second.presence.score, 0.001))),
    heartPresence: best.presence,
    runnerUpPresence: second.presence
  };
}
async function readHighlightedPlayerRow(worker, imagePath, tsv, expectedNick) {
  const metadata = await sharp(imagePath).metadata();
  const imageWidth = metadata.width || 1600;
  const imageHeight = metadata.height || 738;
  const selected = await detectSelectedRowByHeart(imagePath);

  let line = null;
  if (selected) {
    const rowCenters = [0.2683, 0.3984, 0.5271, 0.6558, 0.7859];
    const centerY = Math.round(imageHeight * rowCenters[selected.rowIndex]);
    const rowHeight = Math.max(40, Math.round(imageHeight * 0.128));
    line = {
      left: 0,
      top: Math.max(0, centerY - Math.round(rowHeight / 2)),
      right: imageWidth,
      bottom: Math.min(imageHeight, centerY + Math.round(rowHeight / 2)),
      height: rowHeight,
      text: '',
      confidence: selected.confidence * 100,
      similarity: 1,
      selectedByMissingHeart: true,
      selectedSide: selected.side,
      selectedRowIndex: selected.rowIndex
    };
  } else {
    line = findPlayerOcrLine(tsv, expectedNick);
    if (!line) return null;
  }

  const verticalPadding = selected
    ? Math.round(imageHeight * 0.018)
    : Math.max(24, Math.round(line.height * 1.35));
  const left = 0;
  const top = Math.max(0, line.top - verticalPadding);
  const width = imageWidth;
  const height = Math.min(
    imageHeight - top,
    selected ? Math.round(imageHeight * 0.155) : Math.max(line.height * 3.2, 100)
  );
  const cropPath = imagePath.replace(/.(?:png|jpg|jpeg)$/i, '.player-row.png');

  try {
    await sharp(imagePath)
      .extract({ left, top, width, height })
      .resize({ width: Math.max(width, 3000), withoutEnlargement: false })
      .grayscale()
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
      selectedByMissingHeart: Boolean(line.selectedByMissingHeart),
      selectedSide: line.selectedSide || null,
      selectedRowIndex: Number.isInteger(line.selectedRowIndex) ? line.selectedRowIndex : null,
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
