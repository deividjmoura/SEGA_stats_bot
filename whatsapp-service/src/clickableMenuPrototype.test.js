import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNoxClickableMenu, resolveNoxMenuSelection, sendPrivateNoxMenuPrototype } from './clickableMenuPrototype.js';

test('menu contains seven unique clickable rows', () => {
  const menu = buildNoxClickableMenu();
  assert.equal(menu.sections.length, 1);
  assert.equal(menu.sections[0].rows.length, 7);
  assert.equal(new Set(menu.sections[0].rows.map(row => row.rowId)).size, 6);
  assert.equal(menu.buttonText, '📋 ABRIR MENU');
});

test('only known options resolve', () => {
  assert.equal(resolveNoxMenuSelection('!agenda'), '!agenda');
  assert.equal(resolveNoxMenuSelection('!cadastrar'), '!cadastrar');
  assert.equal(resolveNoxMenuSelection('!agendar'), null);
  assert.equal(resolveNoxMenuSelection(''), null);
});

test('private test rejects groups without sending', async () => {
  let sent = false;
  const sock = { sendMessage: async () => { sent = true; } };
  await assert.rejects(sendPrivateNoxMenuPrototype(sock, '120363123456789@g.us'), /somente em chat privado/);
  assert.equal(sent, false);
});

test('private test sends menu only to private JID', async () => {
  const calls = [];
  const sock = { sendMessage: async (...args) => { calls.push(args); return { key: { id: 'test' } }; } };
  await sendPrivateNoxMenuPrototype(sock, '5511999999999@s.whatsapp.net');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], '5511999999999@s.whatsapp.net');
  assert.equal(calls[0][1].sections[0].rows.length, 7);
});

test('owner LID self-chat is also accepted', async () => {
  const calls = [];
  const sock = { sendMessage: async (...args) => { calls.push(args); } };
  await sendPrivateNoxMenuPrototype(sock, '123456789012345@lid');
  assert.equal(calls.length, 1);
});
