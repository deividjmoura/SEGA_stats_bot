import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { createWorker } from 'tesseract.js';
import { readJson, writeJson, updateJson } from './storage/jsonStore.js';
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
  const rows = await readJson(MATCHES_FILE, {});
  return rows && typeof rows === 'object' && !Array.isArray(rows) ? rows : {};
}

async function saveMatches(matches) {
  await writeJson(MATCHES_FILE, matches);
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
      left: Number(parts[6]),
      top: Number(parts[7]),
      width: Number(parts[8]),
      height: Number(parts[9]),
      text: String(parts[11] || '').trim()
    }))
    .filter(word => Number.isFinite(word.left) && Number.isFinite(word.top) && word.width > 0 && word.height > 0 && word.text);
}

async function improveBattleId(worker, imagePath, initialText, tsv) {
  const initial = String(initialText || '').match(/\b\d{14,18}\b/g);
  if (initial?.length) return initial.sort((a, b) => b.length - a.length)[0];

  const candidate = parseTsvWords(tsv).find(word =>
    /\d{8,18}/.test(word.text.replace(/[Oo]/g, '0').replace(/[Il]/g, '1'))
  );

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

    const duplicate = matches[telegramId].find(item => {
      const final = !['pending', 'pending_api_confirmation', 'pending_name_confirmation'].includes(item.verification);
      if (!final) return false;
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
