import test from 'node:test';
import assert from 'node:assert/strict';
import { isExplicitGroupInteraction as allowed } from '../src/groupTriggerPolicy.js';

test('normal text, laughter and greetings never activate SEGA', () => {
  for (const value of ['Aoba, boa noite galera', 'Maneiro', 'Espero jogar bem com vocês', 'Kkkk', 'Bom dia', 'Voltei depois de 20 minutos', 'Voltei depois de 3 horas', '', '1']) {
    assert.equal(allowed(value), false, value);
  }
});

test('real mentions and explicit commands activate SEGA', () => {
  assert.equal(allowed('@Luiz cheguei', ['123@lid']), true);
  assert.equal(allowed('@Deivid tá aí?', ['456@s.whatsapp.net']), true);
  for (const cmd of ['!sega','/sega','!stats','!ranking','!highlights','!ajuda','!cadastrar','cadastrar','/cadastrar','!battle 234','@SEGA quem countera Harley?']) {
    assert.equal(allowed(cmd), true, cmd);
  }
});

test('menu digits activate only inside a temporary menu session', () => {
  assert.equal(allowed('1', [], false), false);
  assert.equal(allowed('1', [], true), true);
  assert.equal(allowed('5', [], true), true);
  assert.equal(allowed('5', [], false), false);
});

test('SEGA as a word without at-mention is not a command', () => {
  assert.equal(allowed('O pessoal do SEGA joga hoje?'), false);
  assert.equal(allowed('O Mega Drive SEGA é clássico'), false);
});
