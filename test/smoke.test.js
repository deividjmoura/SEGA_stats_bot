import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';

process.env.BOT_TOKEN ||= '000000:test-token-for-unit-tests';
// config.js lê as envs no import, então o caminho precisa existir antes de qualquer import.
const tmpDir = await mkdtemp('/tmp/sega-');
process.env.SESSION_FILE = `${tmpDir}/sessions.json`;

const { parseMatchStats, normalizeStats } = await import('../src/stats.js');
const { renderStats, escapeHtml } = await import('../src/ui.js');

test('parseMatchStats agrega partidas corretamente', () => {
  const s = parseMatchStats([
    { res: 1, mvp: 1, k: 10, d: 2, a: 5, s: 1200, hid_e: { n: 'Layla' } },
    { res: 0, mvp: 0, k: 2, d: 7, a: 3, s: 600, hid_e: { n: 'Layla' } },
    { res: 1, mvp: 0, k: 5, d: 5, a: 9, s: 900, hid_e: { n: 'Tigreal' } }
  ]);

  assert.equal(s.matches, 3);
  assert.equal(s.wins, 2);
  assert.equal(s.losses, 1);
  assert.equal(s.mvps, 1);
  assert.equal(s.kills, 17);
  assert.equal(s.deaths, 14);
  assert.equal(s.assists, 17);
  assert.equal(s.mostPlayed, 'Layla');
  assert.equal(s.avgScore.toFixed(1), '9.0');
});

test('parseMatchStats lida com entrada vazia ou inválida', () => {
  for (const input of [[], null, undefined, 'nope']) {
    const s = parseMatchStats(input);
    assert.equal(s.matches, 0);
    assert.equal(s.wins, 0);
    assert.equal(s.mostPlayed, null);
  }
});

test('normalizeStats entende o formato /user/stats (as em escala x100)', () => {
  const s = normalizeStats({ tc: 100, wc: 60, as: 1050, mvpc: 12 });
  assert.equal(s.matches, 100);
  assert.equal(s.wins, 60);
  assert.equal(s.losses, 40);
  assert.equal(s.winRate, 60);
  assert.equal(s.avgScore, 10.5);
  assert.equal(s.mvps, 12);
  assert.equal(s.hasKda, false);
});

test('normalizeStats não divide por zero sem partidas', () => {
  const s = normalizeStats({});
  assert.equal(s.winRate, 0);
  assert.equal(s.avgScore, null);
});

test('renderStats gera HTML válido e sem placeholders quebrados', () => {
  const out = renderStats(
    normalizeStats(parseMatchStats([{ res: 1, k: 1, d: 1, a: 1, s: 1000 }])),
    'Fulano'
  );
  assert.ok(out.includes('<b>'));
  assert.ok(!out.includes('\\n'), 'não deve conter \\n literal');
  assert.ok(!out.includes('undefined'));
  assert.ok(!out.includes('NaN'));
});

test('escapeHtml protege nomes com caracteres especiais', () => {
  assert.equal(escapeHtml('<b>&hack</b>'), '&lt;b&gt;&amp;hack&lt;/b&gt;');
});

test('sessões criptografam o jwt e restauram corretamente', async () => {
  const mod = await import('../src/sessions.js');
  mod.authenticatedPlayers.set(123, { jwt: 'segredo-jwt', roleId: '1', zoneId: '2', name: 'X' });
  await mod.saveSessions();

  const raw = await readFile(process.env.SESSION_FILE, 'utf8');
  assert.ok(!raw.includes('segredo-jwt'), 'o jwt não pode ser gravado em texto puro');

  mod.authenticatedPlayers.clear();
  await mod.restoreSessions();
  assert.equal(mod.authenticatedPlayers.get(123)?.jwt, 'segredo-jwt');
});
