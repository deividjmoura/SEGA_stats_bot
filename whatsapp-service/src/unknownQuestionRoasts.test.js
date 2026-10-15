import test from 'node:test';
import assert from 'node:assert/strict';
import { isVagueWinQuestion, makeUnknownQuestionRoast } from './unknownQuestionRoasts.js';
import { isExplicitGroupInteraction } from './groupTriggerPolicy.js';

test('vague victory questions invite a friendly roast', () => {
  assert.equal(isVagueWinQuestion('qual personagem uso pra ganhar?'), true);
  assert.equal(isVagueWinQuestion('qual herói eu pego pra vencer?'), true);
  assert.equal(isVagueWinQuestion('como ganhar sempre?'), true);
  assert.equal(isVagueWinQuestion('quem countera Harley?'), false);
  assert.equal(isVagueWinQuestion('qual personagem usar contra Fanny para ganhar?'), false);
  const response = makeUnknownQuestionRoast(() => 0);
  assert.match(response, /!sugestao/);
  assert.match(response, /@NOX/);
  assert.match(response, /minion/i);
});

test('text RSVP requires explicit prefix plus valid event ID', () => {
  for (const input of ['!confirmar abcdef12', '!desistir 123abcde', '!AGENDA']) {
    assert.equal(isExplicitGroupInteraction(input), true);
  }
  for (const input of ['confirmar abcdef12', 'agenda', '!confirmar', '!desistir', 'quero confirmar presença']) {
    assert.equal(isExplicitGroupInteraction(input), false);
  }
});
