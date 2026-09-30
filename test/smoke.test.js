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
  mod.rememberPlayer(123, { jwt: 'segredo-jwt', roleId: '907314674', zoneId: '1375', name: 'X' });
  await mod.saveSessions();

  const raw = await readFile(process.env.SESSION_FILE, 'utf8');
  assert.ok(!raw.includes('segredo-jwt'), 'o jwt não pode ser gravado em texto puro');

  mod.authenticatedPlayers.clear();
  mod.knownPlayers.clear();
  await mod.restoreSessions();
  assert.equal(mod.authenticatedPlayers.get(123)?.jwt, 'segredo-jwt');
  assert.equal(mod.knownPlayers.get(123)?.roleId, '907314674');
});

test('sessão expirada preserva role/zone para o relogin rápido', async () => {
  const mod = await import('../src/sessions.js');
  mod.authenticatedPlayers.clear();
  mod.knownPlayers.clear();

  mod.rememberPlayer(555, { jwt: 'jwt-antigo', roleId: '111222333', zoneId: '2020', name: 'Fulano' });
  mod.expireSession(555);

  assert.equal(mod.authenticatedPlayers.has(555), false, 'o jwt deve sumir');
  assert.deepEqual(
    { roleId: mod.knownPlayers.get(555)?.roleId, zoneId: mod.knownPlayers.get(555)?.zoneId },
    { roleId: '111222333', zoneId: '2020' },
    'os IDs devem continuar salvos'
  );

  // E precisam sobreviver ao restart mesmo sem jwt.
  await mod.saveSessions();
  mod.knownPlayers.clear();
  await mod.restoreSessions();
  assert.equal(mod.knownPlayers.get(555)?.roleId, '111222333');
  assert.equal(mod.authenticatedPlayers.has(555), false);
});

test('/sair esquece o jogador por completo', async () => {
  const mod = await import('../src/sessions.js');
  mod.rememberPlayer(777, { jwt: 'j', roleId: '1', zoneId: '2', name: 'N' });
  mod.forgetPlayer(777);
  assert.equal(mod.knownPlayers.has(777), false);
  assert.equal(mod.authenticatedPlayers.has(777), false);
});


const { loadingStatsMessage, loadingRankingMessage, helpMessage, privacyNotice } = await import(
  '../src/ui.js'
);

test('mensagens de carregamento avisam sobre histórico público e demora', () => {
  for (const msg of [loadingStatsMessage, loadingRankingMessage]) {
    assert.match(msg, /hist[óo]rico de batalhas/i, 'deve citar o histórico de batalhas');
    assert.match(msg, /p[úu]blico/i, 'deve pedir que esteja público');
    assert.match(msg, /minutos/i, 'deve avisar que pode demorar alguns minutos');
  }
});

test('a ajuda repete os dois avisos', () => {
  assert.match(helpMessage, /hist[óo]rico de batalhas/i);
  assert.match(helpMessage, /minutos/i);
});

test('avisos não vazam HTML quebrado', () => {
  for (const msg of [privacyNotice, loadingStatsMessage, loadingRankingMessage, helpMessage]) {
    const open = (msg.match(/<b>/g) || []).length;
    const close = (msg.match(/<\/b>/g) || []).length;
    assert.equal(open, close, 'tags <b> devem estar balanceadas');
    const openI = (msg.match(/<i>/g) || []).length;
    const closeI = (msg.match(/<\/i>/g) || []).length;
    assert.equal(openI, closeI, 'tags <i> devem estar balanceadas');
  }
});

const { LANES, readUserName } = await import('../src/stats.js');

test('parseMatchStats usa o payload real de /user/matches (res + lid)', () => {
  // Formato conforme o exemplo do OpenAPI da Rone Arena.
  const s = parseMatchStats([
    { sid: 40, hid: 17, k: 14, d: 1, a: 11, lid: 4, s: 1180, mvp: 1, res: 1, hid_e: { n: 'Fanny' } },
    { sid: 40, hid: 17, k: 3, d: 6, a: 2, lid: 4, s: 520, mvp: 0, res: 0, hid_e: { n: 'Fanny' } },
    { sid: 40, hid: 31, k: 8, d: 3, a: 7, lid: 5, s: 900, mvp: 0, res: 1, hid_e: { n: 'Moskov' } }
  ]);

  assert.equal(s.matches, 3);
  assert.equal(s.wins, 2);
  assert.equal(s.mvps, 1);
  assert.equal(s.mostPlayed, 'Fanny');
  assert.equal(s.mostPlayedLane, LANES[4], 'lid=4 é Selva');
  assert.equal(s.avgScore.toFixed(2), '8.67', 's vem multiplicado por 100');
});

test('parseMatchStats também entende `fw` (payload de detalhe da partida)', () => {
  const s = parseMatchStats([
    { k: 1, d: 1, a: 1, s: 500, fw: 1 },
    { k: 1, d: 1, a: 1, s: 500, fw: 0 }
  ]);
  assert.equal(s.wins, 1);
});

test('normalizeStats converte `as` real do /user/stats', () => {
  // Exemplo oficial: as = 762.3552 => 7.6
  const s = normalizeStats({ wc: 188, tc: 308, as: 762.3552, mvpc: 73, wsc: 11, gt: 77.95 });
  assert.equal(s.matches, 308);
  assert.equal(s.wins, 188);
  assert.equal(s.avgScore.toFixed(1), '7.6');
  assert.equal(s.winStreak, 11);
  assert.equal(s.mvps, 73);
});

test('readUserName aguenta data como string (permitido pelo schema)', () => {
  assert.equal(readUserName({ data: { name: 'Jogador' } }), 'Jogador');
  assert.equal(readUserName({ data: '' }), null, 'não pode quebrar quando data é string');
  assert.equal(readUserName({ data: null }), null);
  assert.equal(readUserName({}), null);
});

test('renderStats mostra rota e sequência quando existirem', () => {
  const out = renderStats(
    normalizeStats({ matches: 10, wins: 6, kills: 20, deaths: 10, assists: 30, mostPlayedLane: 'Selva', wsc: 4 }),
    null
  );
  assert.match(out, /Rota mais jogada/);
  assert.match(out, /Selva/);
  assert.match(out, /sequência/i);
  assert.ok(!out.includes('NaN'));
});
