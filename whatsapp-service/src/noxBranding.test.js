import test from 'node:test';
import assert from 'node:assert/strict';
import { NOX_BOT_SIGNATURE, NOX_MENU_HEADER, brandNoxText, brandNoxInteractiveTitle } from './noxBranding.js';
import { buildNoxClickableMenu, buildRsvpEventChoices, buildAgendaEventChoices } from './clickableMenuPrototype.js';

test('every text reply starts with the NOX bot identity exactly once', () => {
  assert.equal(brandNoxText('Olá!'), NOX_BOT_SIGNATURE + '\n\nOlá!');
  assert.equal(brandNoxText(brandNoxText('!agenda')), brandNoxText('!agenda'));
  assert.equal(brandNoxText('🎮 Treino amanhã').startsWith('🤖 _NOX bot_'), true);
});

test('all native flow menus identify NOX before the original heading', () => {
  const menus = [
    buildNoxClickableMenu(),
    buildRsvpEventChoices([{ id:'abcdef12', title:'Treino', date:'2026-10-20T23:00:00.000Z' }], {}),
    buildAgendaEventChoices([{ id:'abcdef12', title:'Treino', date:'2026-10-20T23:00:00.000Z' }], 'cancelarevento')
  ];
  for (const menu of menus) {
    assert.equal(menu.interactiveMessage.header.title, NOX_MENU_HEADER);
    assert.ok(menu.interactiveMessage.body.text.includes('EVENTO') ||
      menu.interactiveMessage.body.text.includes('MENU PRINCIPAL'));
    assert.equal(menu.interactiveMessage.nativeFlowMessage.buttons[0].name, 'single_select');
  }
});

test('branded native flow preserves the meaningful title and body', () => {
  assert.deepEqual(brandNoxInteractiveTitle('📅 AGENDA', 'Escolha um evento'), {
    headerTitle: NOX_MENU_HEADER,
    bodyText: '📅 AGENDA\n\nEscolha um evento'
  });
});
