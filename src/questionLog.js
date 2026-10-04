import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';

export const QUESTIONS_FILE = process.env.QUESTIONS_FILE ||
  ((process.env.RAILWAY_VOLUME_MOUNT_PATH || './data') + '/questions.json');

async function readRows() {
  try {
    const rows = JSON.parse(await fs.readFile(QUESTIONS_FILE, 'utf8'));
    return Array.isArray(rows) ? rows : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

export async function logQuestion(entry) {
  await fs.mkdir(dirname(QUESTIONS_FILE), { recursive: true });
  const rows = await readRows();
  rows.push({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    createdAt: new Date().toISOString(),
    ...entry
  });
  const trimmed = rows.slice(-2000);
  await fs.writeFile(QUESTIONS_FILE, JSON.stringify(trimmed, null, 2), 'utf8');
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
