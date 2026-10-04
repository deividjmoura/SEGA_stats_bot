import { promises as fs } from 'node:fs';
import { readJson, updateJson, quarantineJson } from './storage/jsonStore.js';

export const QUESTIONS_FILE = process.env.QUESTIONS_FILE ||
  ((process.env.RAILWAY_VOLUME_MOUNT_PATH || './data') + '/questions.json');

async function readRows() {
  try {
    const rows = await readJson(QUESTIONS_FILE, []);
    return Array.isArray(rows) ? rows : [];
  } catch (error) {
    console.error('❌ questions.json corrompido; preservando cópia:', error);
    await quarantineJson(QUESTIONS_FILE).catch(() => {});
    return [];
  }
}

export async function logQuestion(entry) {
  await updateJson(QUESTIONS_FILE, [], rows => {
    const list = Array.isArray(rows) ? rows : [];
    list.push({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      createdAt: new Date().toISOString(),
      ...entry
    });
    return list.slice(-2000);
  });
}

export async function getQuestionReport(limit = 15) {
  const rows = await readRows();
  const counts = new Map();

  for (const row of rows) {
    const key = String(row.normalizedQuestion || row.question || '').trim();
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  const top = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([question, count], index) => ({ rank: index + 1, question, count }));

  return {
    total: rows.length,
    answered: rows.filter(row => row.answered).length,
    unanswered: rows.filter(row => !row.answered).length,
    top
  };
}
