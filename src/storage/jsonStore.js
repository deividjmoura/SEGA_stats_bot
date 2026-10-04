import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';

const queues = new Map();

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

async function ensureParent(filePath) {
  await fs.mkdir(dirname(filePath), { recursive: true });
}

async function atomicWrite(filePath, value) {
  await ensureParent(filePath);
  const tempPath = join(
    dirname(filePath),
    '.' + filePath.split('/').pop() + '.' + process.pid + '.' + Date.now() + '.tmp'
  );
  const payload = JSON.stringify(value, null, 2);
  await fs.writeFile(tempPath, payload, 'utf8');
  await fs.rename(tempPath, filePath);
}

export async function readJson(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === 'ENOENT') return clone(fallback);
    throw error;
  }
}

export function queueJsonWrite(filePath, value) {
  const previous = queues.get(filePath) || Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(() => atomicWrite(filePath, value))
    .finally(() => {
      if (queues.get(filePath) === next) queues.delete(filePath);
    });

  queues.set(filePath, next);
  return next;
}

export async function writeJson(filePath, value) {
  await queueJsonWrite(filePath, value);
}

export async function updateJson(filePath, fallback, updater) {
  const previous = queues.get(filePath) || Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(async () => {
      const current = await readJson(filePath, fallback);
      const updated = await updater(current);
      await atomicWrite(filePath, updated);
      return updated;
    })
    .finally(() => {
      if (queues.get(filePath) === next) queues.delete(filePath);
    });

  queues.set(filePath, next);
  return next;
}


export async function quarantineJson(filePath) {
  const quarantinedPath = filePath + '.corrupt-' + Date.now();
  await fs.rename(filePath, quarantinedPath);
  return quarantinedPath;
}
