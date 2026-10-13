import test from 'node:test';
import assert from 'node:assert/strict';
import { isOwnPrivateChat, shouldProcessPrivateMessage, shouldProcessRegistrationPrivateMessage } from '../src/privateChatRouting.js';

const own = ['owner:4@s.whatsapp.net', 'ownerlid@lid'];
function msg(jid, text = '!sega', fromMe = false) {
  return { key: { id: 'key', remoteJid: jid, fromMe }, message: { conversation: text } };
}

test("the owner\'s self-chat accepts explicit commands for testing", () => {
  assert.equal(isOwnPrivateChat('owner@s.whatsapp.net', own), true);
  assert.equal(shouldProcessPrivateMessage(msg('owner@s.whatsapp.net', '!sega', true), own), true);
  assert.equal(shouldProcessPrivateMessage(msg('ownerlid@lid', '!stats', true), own), true);
});
test('unrelated private chats cannot trigger bot replies', () => {
  assert.equal(shouldProcessPrivateMessage(msg('friend@s.whatsapp.net', '!sega'), own), false);
  assert.equal(shouldProcessPrivateMessage(msg('friend@s.whatsapp.net', '123456789', true), own), false);
  assert.equal(shouldProcessPrivateMessage(msg('friend@s.whatsapp.net', '!battle 1234'), own), false);
});
test('groups and messages without contents are ignored', () => {
  assert.equal(shouldProcessPrivateMessage(msg('clan@g.us'), own), false);
  assert.equal(shouldProcessPrivateMessage({ key: { id: 'x', remoteJid: 'owner@s.whatsapp.net' } }, own), false);
});

const textOf = message => message?.conversation || message?.extendedTextMessage?.text || '';

test('clan member can opt in by sending !cadastrar privately', () => {
  const other = msg('member@s.whatsapp.net', '!cadastrar');
  assert.equal(shouldProcessRegistrationPrivateMessage(other, own, new Set(), textOf), true);
  assert.equal(shouldProcessRegistrationPrivateMessage(msg('member@s.whatsapp.net', '/cadastrar'), own, new Set(), textOf), true);
  assert.equal(shouldProcessRegistrationPrivateMessage(msg('member@s.whatsapp.net', 'cadastrar'), own, new Set(), textOf), true);
});

test('normal private messages from other people remain blocked', () => {
  for (const command of ['oi', 'tem um minuto?', '!stats', '!grupos', '123456789']) {
    assert.equal(shouldProcessRegistrationPrivateMessage(msg('friend@s.whatsapp.net', command), own, new Set(), textOf), false);
  }
  assert.equal(shouldProcessRegistrationPrivateMessage(msg('friend@s.whatsapp.net', '!cadastrar', true), own, new Set(), textOf), false);
});

test('registration messages are permitted only during the active opt-in flow', () => {
  const active = new Set(['member@s.whatsapp.net']);
  assert.equal(shouldProcessRegistrationPrivateMessage(msg('member@s.whatsapp.net', '123456789'), own, active, textOf), true);
  assert.equal(shouldProcessRegistrationPrivateMessage(msg('different@s.whatsapp.net', '123456789'), own, active, textOf), false);
  assert.equal(shouldProcessRegistrationPrivateMessage(msg('member@g.us', '!cadastrar'), own, active, textOf), false);
});
