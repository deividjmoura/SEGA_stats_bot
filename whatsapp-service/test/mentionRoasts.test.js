import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classicRoasts, freshRoasts, roastOpenings, roastMiddles,
  roastEndings, roastVariations, formatRoastAt, makeMentionRoast
} from '../src/mentionRoasts.js';

// Não permitir termos vulgares nem estigmas ligados a deficiência/saúde.
const forbidden = /(?:^|[^a-z])(?:merda|porra|caralho|cacete|bosta|puta|pqp|fdp|foda|foder|fodido|fodida|hospicio|caps|cego|cega|cegos|cegas|primata|terapia)(?:$|[^a-z])/i;
const normalize = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

test('catalog has more than 32 thousand distinct possible outputs', () => {
  assert.equal(classicRoasts.length, 136);
  assert.equal(freshRoasts.length, 158);
  assert.equal(roastOpenings.length, 20);
  assert.equal(roastMiddles.length, 80);
  assert.equal(roastEndings.length, 20);
  assert.equal(roastVariations, 32294);
});

test('every possible template contains both players and no banned language', () => {
  const seen = new Set();
  for (let i = 0; i < roastVariations; i += 1) {
    const result = formatRoastAt(i, 'Jogador A', 'Jogador B');
    assert.ok(result.includes('Jogador A') && result.includes('Jogador B'), 'Missing player for ' + i);
    assert.equal(forbidden.test(normalize(result)), false, 'Inappropriate words in roast index ' + i);
    assert.ok(!result.includes('{author}') && !result.includes('{target}'));
    assert.ok(!seen.has(result), 'Duplicate output at ' + i);
    seen.add(result);
  }
});

test('new jokes keep only game-related and meme deboche without vulgar words', () => {
  for (const phrase of [...classicRoasts, ...freshRoasts, ...roastOpenings, ...roastMiddles, ...roastEndings]) {
    assert.equal(forbidden.test(normalize(phrase)), false);
  }
});

test('random selection can deliver a handcrafted roast and a combinatorial roast', () => {
  let calls = [0, 0];
  const crafted = makeMentionRoast('Luiz', 'Pitter', () => calls.shift());
  assert.match(crafted, /Luiz/);
  assert.match(crafted, /Pitter/);
  calls = [99, 0];
  const combined = makeMentionRoast('Luiz', 'Pitter', () => calls.shift());
  assert.match(combined, /Luiz/);
  assert.match(combined, /Pitter/);
  assert.notEqual(crafted, combined);
});

test('roast selection rejects out of range indexes', () => {
  assert.throws(() => formatRoastAt(-1, 'A', 'B'), RangeError);
  assert.throws(() => formatRoastAt(roastVariations, 'A', 'B'), RangeError);
});
