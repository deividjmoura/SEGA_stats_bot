import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildNickSnapshot, writeNickSnapshot } from '../src/whatsapp/nickSnapshot.js';

test('snapshot contém somente nomes, ordenados e sem duplicatas', () => {
  const snapshot = buildNickSnapshot([
    { name: 'Zed', jwt: 'SECRET', roleId: '123', zoneId: '456' },
    { name: 'Deivid' },
    { name: '  ' },
    { name: 'Deivid' }
  ], '2026-10-10T00:00:00.000Z');

  assert.deepEqual(snapshot, {
    updatedAt: '2026-10-10T00:00:00.000Z',
    players: [{ name: 'Deivid' }, { name: 'Zed' }]
  });
  assert.equal(JSON.stringify(snapshot).includes('SECRET'), false);
  assert.equal(JSON.stringify(snapshot).includes('roleId'), false);
});

test('grava o snapshot em JSON', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sega-nicks-'));
  const filePath = join(dir, 'nicks.json');

  try {
    await writeNickSnapshot(filePath, [{ name: 'Deivid' }]);
    const saved = JSON.parse(await readFile(filePath, 'utf8'));
    assert.deepEqual(saved.players, [{ name: 'Deivid' }]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('exige caminho de saída', async () => {
  await assert.rejects(writeNickSnapshot('', []), /caminho do snapshot/);
});
