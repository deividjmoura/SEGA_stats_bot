import test from 'node:test';
import assert from 'node:assert/strict';
import { selectAcademyMatchups, selectMatrixMatchups } from './counterMatchups.js';
import { intentOf, answerMlbbQuestion } from './mlbbKnowledgeV2.js';

test('Academy selects opponents that REDUCE the queried hero win rate', () => {
  const heroNames = new Map([['1', 'Harley'], ['2', 'Saber'], ['3', 'Khufra'], ['4', 'Gusion'], ['5', 'Layla']]);
  const record = {
    main_heroid: 1,
    sub_hero: [
      { heroid: 2, increase_win_rate: 0.16 },  // Harley counters Saber
      { heroid: 3, increase_win_rate: -0.22 }, // Khufra counters Harley
      { heroid: 4, increase_win_rate: -0.09 },
      { heroid: 5, increase_win_rate: 0 },
      { heroid: 1, increase_win_rate: -0.3 }
    ]
  };
  assert.deepEqual(selectAcademyMatchups(record, heroNames, 'against'), ['Khufra', 'Gusion']);
  assert.deepEqual(selectAcademyMatchups(record, heroNames, 'targets'), ['Saber']);
});

test('Academy includes negative records and does not return positive-only results as incoming counters', () => {
  const heroNames = new Map([['1', 'Harley'], ['2', 'Saber'], ['3', 'Khufra']]);
  const record = {
    main_heroid: 1,
    sub_hero: [{ heroid: 2, increase_win_rate: 0.16 }],
    sub_hero_last: [{ heroid: 3, increase_win_rate: -0.22 }]
  };
  assert.deepEqual(selectAcademyMatchups(record, heroNames, 'against'), ['Khufra']);
  assert.deepEqual(selectAcademyMatchups({ main_heroid: 1, sub_hero: record.sub_hero }, heroNames, 'against'), []);
  assert.deepEqual(selectAcademyMatchups(record, heroNames, 'targets'), ['Saber']);
});

test('Matrix incoming and outgoing picks are different', () => {
  const live = {
    heroes: [{ i: 1, n: 'Harley' }, { i: 2, n: 'Saber' }, { i: 3, n: 'Khufra' }, { i: 4, n: 'Gusion' }],
    matrix: { counters: {
      '1': { '2': -0.1, '3': -0.2, '4': 0.25 },
      '2': { '1': 0.1 },
      '3': { '1': 0.2 },
      '4': { '1': -0.25 }
    } }
  };
  assert.deepEqual(selectMatrixMatchups(live, 1, 'against'), ['Khufra', 'Saber']);
  assert.deepEqual(selectMatrixMatchups(live, 1, 'targets'), ['Gusion']);
});

test('Natural Portuguese questions preserve counter direction', () => {
  for (const text of ['quem countera Harley?', 'quem cautera Harley?', 'quem mata Harley?', 'qual herói é bom contra Harley?']) {
    assert.equal(intentOf(text), 'counter', text);
  }
  for (const text of ['Harley countera quem?', 'quem o Harley countera?', 'quais heróis Harley countera?', 'Harley mata quem?']) {
    assert.equal(intentOf(text), 'counter_targets', text);
  }
});

test('No network counter data does not invent an outgoing counter list', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('simulated outage'); };
  try {
    const response = await answerMlbbQuestion('Harley countera quem?');
    assert.match(response, /Não consegui carregar dados confiáveis/i);
    assert.doesNotMatch(response, /• Lolita/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
