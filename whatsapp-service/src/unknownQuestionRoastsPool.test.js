import test from 'node:test';
import assert from 'node:assert/strict';
import { ROAST_VARIANT_COUNT, makeUnknownQuestionRoast, isVagueWinQuestion } from './unknownQuestionRoasts.js';

test('NOX has exactly 1,000 unique playful replies in a complete rotation', () => {
  assert.equal(ROAST_VARIANT_COUNT, 1000);
  const seen = new Set();
  for (let i = 0; i < ROAST_VARIANT_COUNT; i++) {
    const reply = makeUnknownQuestionRoast(() => 0);
    assert.equal(seen.has(reply), false, 'Duplicate reply before exhausting all variants at ' + i);
    assert.match(reply, /!sugestao/);
    assert.match(reply, /@NOX/);
    assert.ok(reply.includes('\n\n'), 'Reply must have real line breaks');
    assert.ok(!reply.includes('\\n'), 'Do not send escaped newline markers to WhatsApp');
    seen.add(reply);
  }
  assert.equal(seen.size, ROAST_VARIANT_COUNT);
  assert.equal(seen.has(makeUnknownQuestionRoast(() => 0)), true, 'Pool should refill after its 1,000th reply');
});

test('knowledge fallback still protects legitimate questions from joke detection', () => {
  assert.equal(isVagueWinQuestion('qual personagem uso pra ganhar?'), true);
  assert.equal(isVagueWinQuestion('como ganhar sempre?'), true);
  assert.equal(isVagueWinQuestion('quem countera Miya?'), false);
  assert.equal(isVagueWinQuestion('qual item usar contra Fanny?'), false);
});
