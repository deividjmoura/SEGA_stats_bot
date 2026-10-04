import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createWorker } from 'tesseract.js';

const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || './data';
const SCREENSHOT_DIR = path.join(DATA_DIR, 'screenshots');
const MATCHES_FILE = path.join(DATA_DIR, 'matches.json');

let workerPromise = null;

async function ensureStorage() {
  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
}

async function loadMatches() {
  await ensureStorage();
  try {
    return JSON.parse(await fs.readFile(MATCHES_FILE, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}

async function saveMatches(matches) {
  await ensureStorage();
  await fs.writeFile(MATCHES_FILE, JSON.stringify(matches, null, 2), 'utf8');
}

async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const worker = await createWorker(['eng', 'por']);
      return worker;
    })().catch(error => {
      workerPromise = null;
      throw error;
    });
  }
  return workerPromise;
}

function normalizeOcrText(text) {
  return String(text || '')
    .replace(/[|]/g, '1')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseNumbers(text) {
  const source = normalizeOcrText(text);
  return [...source.matchAll(/\b\d{1,4}(?:[.,]\d{1,2})?\b/g)].map(match =>
    Number(match[0].replace(',', '.'))
  ).filter(Number.isFinite);
}

function parseKda(text) {
  const source = normalizeOcrText(text);
  const matches = [...source.matchAll(/\b(\d{1,2})\s*[/:|\\-]\s*(\d{1,2})\s*[/:|\\-]\s*(\d{1,2})\b/g)];
  if (!matches.length) return null;
  return {
    kills: Number(matches[0][1]),
    deaths: Number(matches[0][2]),
    assists: Number(matches[0][3])
  };
}

function parseWinRate(text) {
  const match = normalizeOcrText(text).match(/(\d{1,3}(?:[.,]\d{1,2})?)\s*%/);
  return match ? Number(match[1].replace(',', '.')) : null;
}

function detectKind(text) {
  const source = normalizeOcrText(text).toLowerCase();
  const finalWords = ['victory', 'defeat', 'mvp', 'battlefield', 'result', 'vitória', 'derrota', 'resultado'];
  const profileWords = ['win rate', 'winrate', 'matches', 'games', 'heroes', 'history', 'season', 'taxa de vitória', 'partidas', 'histórico'];
  const finalScore = finalWords.filter(word => source.includes(word)).length;
  const profileScore = profileWords.filter(word => source.includes(word)).length;
  if (finalScore > profileScore) return 'match_result';
  if (profileScore > finalScore) return 'profile';
  return 'unknown';
}

function parseScreenshotStats(text) {
  const source = normalizeOcrText(text);
  const kda = parseKda(source);
  const winRate = parseWinRate(source);
  const numbers = parseNumbers(source);
  const longNumbers = source.match(/\b\d{14,18}\b/g) || [];
  const battleId = longNumbers.sort((a, b) => b.length - a.length)[0] || null;

  const parsed = {
    kind: detectKind(source),
    winRate,
    kda,
    battleId,
    rawNumbers: numbers.slice(0, 30)
  };

  if (/\b(victory|vitória)\b/i.test(source)) {
    parsed.result = 'win';
  } else if (/\b(defeat|derrota)\b/i.test(source)) {
    parsed.result = 'loss';
  }

  const scoreMatch = source.match(/(?:score|rating|grade|pontua[cç][aã]o)\s*[:=]?\s*(\d{1,3}(?:[.,]\d{1,2})?)/i);
  if (scoreMatch) parsed.score = Number(scoreMatch[1].replace(',', '.'));

  return parsed;
}

async function downloadTelegramPhoto(ctx, fileId, filePath) {
  const url = await ctx.telegram.getFileLink(fileId);
  const response = await fetch(url.href || String(url));
  if (!response.ok) throw new Error('Falha ao baixar a imagem do Telegram: HTTP ' + response.status);
  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(filePath, buffer);
}

export async function processScreenshot(ctx, player) {
  await ensureStorage();

  const photos = ctx.message?.photo || [];
  if (!photos.length) throw new Error('Nenhuma foto recebida.');

  const largest = photos[photos.length - 1];
  const id = crypto.randomUUID();
  const imagePath = path.join(SCREENSHOT_DIR, id + '.jpg');

  await downloadTelegramPhoto(ctx, largest.file_id, imagePath);

  const worker = await getWorker();
  const result = await worker.recognize(imagePath);
  const ocrText = normalizeOcrText(result.data?.text || '');
  const parsed = parseScreenshotStats(ocrText);

  const matches = await loadMatches();
  const telegramId = String(ctx.from.id);
  if (!Array.isArray(matches[telegramId])) matches[telegramId] = [];

  const record = {
    id,
    telegramId: ctx.from.id,
    roleId: player.roleId,
    zoneId: player.zoneId,
    createdAt: new Date().toISOString(),
    imageFile: path.relative(DATA_DIR, imagePath),
    kind: parsed.kind,
    parsed,
    verification: 'pending',
    ocrText: ocrText.slice(0, 5000)
  };

  matches[telegramId].push(record);
  await saveMatches(matches);

  return record;
}

export async function getPlayerScreenshots(telegramId) {
  const matches = await loadMatches();
  return Array.isArray(matches[String(telegramId)]) ? matches[String(telegramId)] : [];
}

export function summarizePlayerScreenshots(records) {
  const list = Array.isArray(records) ? records : [];
  const wins = list.filter(item => item.parsed?.result === 'win').length;
  const losses = list.filter(item => item.parsed?.result === 'loss').length;
  const kdas = list.map(item => item.parsed?.kda).filter(Boolean);
  const kills = kdas.reduce((sum, kda) => sum + Number(kda.kills || 0), 0);
  const deaths = kdas.reduce((sum, kda) => sum + Number(kda.deaths || 0), 0);
  const assists = kdas.reduce((sum, kda) => sum + Number(kda.assists || 0), 0);

  return {
    screenshots: list.length,
    matchResults: wins + losses,
    wins,
    losses,
    kills,
    deaths,
    assists
  };
}
