import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSeasonStats, formatSeasonStats } from '../src/seasonStats.js';

const success = data => ({ response: { ok: true }, body: { code: 0, data } });
const invalid = () => ({ response: { ok: false, status: 503 }, body: { code: 503 } });
const fakeRequest = cases => async (path, options) => {
  assert.equal(options.headers.Authorization, 'Bearer jwt-de-teste');
  for (const [needle, response] of cases) {
    if (path.includes(needle)) return typeof response === 'function' ? response(path) : response;
  }
  throw new Error('Rota inesperada: ' + path);
};

test('temporada completa: partidas, vitórias, win rate e três heróis', async () => {
  const request = fakeRequest([
    ['/user/season', success({ sids: [39, 41, 40] })],
    ['/user/matches?', success({
      result: [
        { bid_s: '111111111111111111', res: 1, mvp: 1 },
        { bid_s: '222222222222222222', res: 0, mvp: 0 },
        { bid_s: '333333333333333333', res: 1, mvp: 0 }
      ],
      pageInfo: { hasNext: false, nextCursor: '' }
    })],
    ['/user/heroes/frequent?', success({ result: [
      { tc: 6, wc: 3, hid_e: { n: 'Miya' } },
      { tc: 9, wc: 7, hid_e: { n: 'Fanny' } },
      { tc: 4, wc: 2, hid_e: { n: 'Layla' } },
      { tc: 2, wc: 1, hid_e: { n: 'Tigreal' } }
    ] })]
  ]);
  const info = await loadSeasonStats('jwt-de-teste', request);
  assert.deepEqual({ sid: info.sid, complete: info.complete, games: info.games, wins: info.wins, losses: info.losses, mvps: info.mvps },
    { sid: 41, complete: true, games: 3, wins: 2, losses: 1, mvps: 1 });
  assert.deepEqual(info.topHeroes.map(x => x.name), ['Fanny', 'Miya', 'Layla']);
  const lines = formatSeasonStats(info).join('\n');
  assert.match(lines, /Win rate da temporada: 66,7%/);
  assert.match(lines, /Partidas na temporada: 3/);
  assert.doesNotMatch(lines, /Parcial/);
});

test('duas páginas e informação parcial: não inventa totais da temporada', async () => {
  const request = fakeRequest([
    ['/user/season', success({ sids: [40] })],
    ['/user/matches?', path => path.includes('last_cursor=cursor1')
      ? success({ result: [
        { bid_s: '222', res: 0, mvp: 0 }, // Repetida; não contar duas vezes.
        { bid_s: '333', res: 0, mvp: 1 }
      ], pageInfo: { hasNext: true, nextCursor: 'cursor1' } })
      : success({ result: [
        { bid_s: '111', res: 1, mvp: 1 },
        { bid_s: '222', res: 0, mvp: 0 }
      ], pageInfo: { hasNext: true, nextCursor: 'cursor1' } })],
    ['/user/heroes/frequent?', invalid()]
  ]);
  const info = await loadSeasonStats('jwt-de-teste', request);
  assert.equal(info.games, 3);
  assert.equal(info.complete, false);
  const lines = formatSeasonStats(info).join('\n');
  assert.match(lines, /Partidas consultadas: 3/);
  assert.match(lines, /Win rate da amostra: 33,3%/);
  assert.match(lines, /Parcial/);
  assert.doesNotMatch(lines, /Partidas na temporada:/);
});

test('falha da API: retorna vazio para manter ficha anterior', async () => {
  const request = fakeRequest([['/user/season', invalid()]]);
  assert.deepEqual(formatSeasonStats(await loadSeasonStats('jwt-de-teste', request)), []);
});

test('endpoint de partidas indisponível ainda mostra heróis quando possível', async () => {
  const request = fakeRequest([
    ['/user/season', success({ sids: [40] })],
    ['/user/matches?', invalid()],
    ['/user/heroes/frequent?', success({ result: [
      { tc: 9, wc: 8, hid_e: { n: 'Estes' } }
    ] })]
  ]);
  const info = await loadSeasonStats('jwt-de-teste', request);
  assert.equal(info.matchesAvailable, false);
  const lines = formatSeasonStats(info).join('\n');
  assert.match(lines, /Estes — 9 partidas/);
  assert.doesNotMatch(lines, /Partidas na temporada/);
});

test('sem partidas nem heróis confiáveis: nenhum dado extra', async () => {
  const request = fakeRequest([
    ['/user/season', success({ sids: [40] })],
    ['/user/matches?', invalid()],
    ['/user/heroes/frequent?', invalid()]
  ]);
  assert.equal(await loadSeasonStats('jwt-de-teste', request), null);
  assert.deepEqual(formatSeasonStats(null), []);
});

test('respostas malformadas e JWT ausente não fabricam win rate', async () => {
  const request = fakeRequest([
    ['/user/season', success({ sids: [40] })],
    ['/user/matches?', success({ result: [
      { bid_s: '111', res: 10 },
      { bid_s: '222', res: null },
      { bid_s: '333', res: 1 }
    ], pageInfo: {} })],
    ['/user/heroes/frequent?', success({ result: [] })]
  ]);
  const info = await loadSeasonStats('jwt-de-teste', request);
  assert.equal(info.games, 1);
  assert.equal(info.complete, false);
  assert.equal(await loadSeasonStats('', request), null);
});
