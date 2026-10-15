import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNoxClickableMenu, resolveNoxMenuSelection, buildNoxNativeFlowRelayNodes, sendPrivateNoxMenuPrototype } from './clickableMenuPrototype.js';

const optionsFromMessage = () => {
  const msg = buildNoxClickableMenu();
  assert.equal(Object.keys(msg).length, 1);
  const flow = msg.interactiveMessage.nativeFlowMessage;
  assert.equal(flow.buttons.length, 1);
  assert.equal(flow.buttons[0].name, 'single_select');
  return JSON.parse(flow.buttons[0].buttonParamsJson);
};

test('native-flow has exactly seven unique options', () => {
  const menu = optionsFromMessage();
  assert.equal(menu.title, '📋 ABRIR MENU');
  assert.equal(menu.sections.length, 1);
  assert.equal(menu.sections[0].rows.length, 7);
  assert.equal(new Set(menu.sections[0].rows.map(row => row.id)).size, 7);
  assert.ok(menu.sections[0].rows.some(row => row.id === '!cadastrar'));
});

test('known selections resolve and unknown commands are rejected', () => {
  assert.equal(resolveNoxMenuSelection('!agenda'), '!agenda');
  assert.equal(resolveNoxMenuSelection('!cadastrar'), '!cadastrar');
  assert.equal(resolveNoxMenuSelection('!agendar'), null);
  assert.equal(resolveNoxMenuSelection(''), null);
});

test('relay nodes include bot and native-flow marker', () => {
  const nodes = buildNoxNativeFlowRelayNodes(1770000000000);
  assert.equal(nodes[0].tag, 'bot');
  assert.equal(nodes[1].tag, 'biz');
  assert.equal(nodes[1].content[0].content[0].attrs.name, 'mixed');
});

test('private sender rejects group JID without relaying', async () => {
  let calls = 0;
  const sock = { user: { id: '5511999999999@s.whatsapp.net' }, relayMessage: async () => { calls++; } };
  await assert.rejects(sendPrivateNoxMenuPrototype(sock, '120363123456789@g.us', () => ({})), /somente em chat privado/);
  assert.equal(calls, 0);
});

test('private sender sends protobuf content by relayMessage, not text sendMessage', async () => {
  const calls = [];
  const socket = {
    user: { id: '5511999999999:2@s.whatsapp.net' },
    relayMessage: async (...args) => calls.push(args),
    sendMessage: () => { throw new Error('legacy sendMessage is forbidden for this menu'); },
  };
  const contentGenerator = (jid, body, opts) => {
    assert.equal(jid, '5511999999999@s.whatsapp.net');
    assert.equal(opts.userJid, socket.user.id);
    assert.equal(body.interactiveMessage.nativeFlowMessage.buttons[0].name, 'single_select');
    return { key: { id: 'nox-test-123' }, message: body };
  };
  const result = await sendPrivateNoxMenuPrototype(socket, '5511999999999@s.whatsapp.net', contentGenerator);
  assert.equal(result.key.id, 'nox-test-123');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], '5511999999999@s.whatsapp.net');
  assert.equal(calls[0][2].messageId, 'nox-test-123');
  assert.equal(calls[0][2].additionalNodes[0].tag, 'bot');
});

test('LID self-chat works with native flow', async () => {
  let sent = false;
  const sock = { user: { id: '123456789012345@lid' }, relayMessage: async () => { sent = true; } };
  await sendPrivateNoxMenuPrototype(sock, '123456789012345@lid', (_jid, body) => ({ key: { id: '123' }, message: body }));
  assert.equal(sent, true);
});

test('missing transport is rejected instead of claiming the menu was sent', async () => {
  await assert.rejects(sendPrivateNoxMenuPrototype({}, '5511999999999@s.whatsapp.net', () => ({})), /não está disponível/);
});
