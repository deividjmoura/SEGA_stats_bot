import test from 'node:test';
import assert from 'node:assert/strict';
import { NOX_MENU_OPTIONS, buildNoxClickableMenu, buildAgendaEventChoices,
  buildAgendaConfirmationChoice, buildNoxNativeFlowRelayNodes,
  sendNoxInteractiveMenu, isInteractiveChoice } from './clickableMenuPrototype.js';

const rows = menu => JSON.parse(menu.interactiveMessage.nativeFlowMessage.buttons[0].buttonParamsJson).sections[0].rows;

test('main menu has seven unique clickable commands', () => {
  const entries = rows(buildNoxClickableMenu());
  assert.equal(entries.length, 7);
  assert.deepEqual(entries.map(item => item.id), NOX_MENU_OPTIONS.map(item => item.id));
});

test('agenda picker paginates and confirmation is clickable', () => {
  const events = Array.from({ length: 19 }, (_, index) => ({
    id: String(index).padStart(8, '0'), title: 'Treino ' + index,
    date: '2026-10-20T23:00:00.000Z',
  }));
  assert.equal(rows(buildAgendaEventChoices(events, 'editarevento', 0)).length, 9);
  assert.equal(rows(buildAgendaEventChoices(events, 'editarevento', 1)).length, 10);
  assert.deepEqual(rows(buildAgendaConfirmationChoice(events[0])).map(item => item.id), ['nox:confirm:sim', 'nox:confirm:nao']);
});

test('relay has native-flow metadata', () => {
  const nodes = buildNoxNativeFlowRelayNodes();
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].tag, 'biz');
});

test('only approved groups can receive clickable menus', async () => {
  let sent = false;
  const socket = { user: { id: '5511999999999@s.whatsapp.net' }, relayMessage: async () => { sent = true; } };
  const generator = (jid, body) => ({ key: { id: 'test' }, message: body });
  const jid = '120363123456789@g.us';
  await assert.rejects(sendNoxInteractiveMenu(socket, jid, generator, buildNoxClickableMenu()));
  assert.equal(sent, false);
  await sendNoxInteractiveMenu(socket, jid, generator, buildNoxClickableMenu(), [jid]);
  assert.equal(sent, true);
});

test('clicked choices are distinct from plain text', () => {
  assert.equal(isInteractiveChoice({ conversation: '!agenda' }), false);
  assert.equal(isInteractiveChoice({ interactiveResponseMessage: { nativeFlowResponseMessage: { paramsJson: '{}' } } }), true);
});
