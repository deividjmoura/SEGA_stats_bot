import test from 'node:test';
import assert from 'node:assert/strict';
import { isExplicitGroupInteraction } from './groupTriggerPolicy.js';

test('NOX agenda command is recognized with or without command prefix', () => {
  for (const command of ['agenda','AGENDA','!agenda','/agenda','! agenda']) {
    assert.equal(isExplicitGroupInteraction(command), true, 'Should accept '+command);
  }
});

test('main menu, suggestions and registration still work', () => {
  for (const command of ['!nox','nox','!sugestao','sugestao','!stats','!ranking','!ajuda','!cadastrar']) {
    assert.equal(isExplicitGroupInteraction(command), true, 'Should accept '+command);
  }
});

test('ordinary group messages containing agenda do not invoke bot', () => {
  for (const phrase of ['a agenda mudou','quem sabe da agenda','vou ver a agenda depois','o evento é amanhã','boa tarde']) {
    assert.equal(isExplicitGroupInteraction(phrase), false, 'Should ignore '+phrase);
  }
});
