import test from 'node:test';
import assert from 'node:assert/strict';
import { isExplicitGroupInteraction } from './groupTriggerPolicy.js';

test('agenda must be invoked with exactly !agenda', () => {
  for (const command of ['!agenda','!AGENDA','!AgEnDa']) {
    assert.equal(isExplicitGroupInteraction(command), true, 'Should accept '+command);
  }
});

test('agenda without ! or with an unsupported prefix does not activate NOX', () => {
  for (const phrase of ['agenda','AGENDA','/agenda','! agenda','a agenda mudou',
    'quem sabe da agenda','vou ver a agenda depois','o evento é amanhã','boa tarde']) {
    assert.equal(isExplicitGroupInteraction(phrase), false, 'Should ignore '+phrase);
  }
});

test('other previously functioning commands remain recognized', () => {
  for (const command of ['!nox','nox','!sugestao','sugestao',
    '!stats','!ranking','!ajuda','!cadastrar']) {
    assert.equal(isExplicitGroupInteraction(command), true, 'Should accept '+command);
  }
});
