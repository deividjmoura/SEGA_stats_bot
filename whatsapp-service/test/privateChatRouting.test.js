import test from 'node:test';
import assert from 'node:assert/strict';
import { isOwnPrivateChat, shouldProcessPrivateMessage } from '../src/privateChatRouting.js';

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
