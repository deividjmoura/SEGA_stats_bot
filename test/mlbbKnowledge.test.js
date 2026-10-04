import test from 'node:test';
import assert from 'node:assert/strict';
import { answerMlbbQuestion } from '../src/mlbbKnowledgeV2.js';

test('build de Argus retorna uma base curada em vez de resposta vazia', async () => {
  const answer = await answerMlbbQuestion('@SEGA Stats qual build faço de Argus?');
  assert.match(answer, /BUILD \/ ARGUS/);
  assert.match(answer, /Corrosion Scythe/);
  assert.match(answer, /Demon Hunter Sword/);
  assert.match(answer, /Malefic Roar/);
});
