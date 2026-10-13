import test from 'node:test';
import assert from 'node:assert/strict';
import { bilingualLabel, bilingualAttributes } from '../src/buildLocalization.js';

test('keeps English item names with known Portuguese translations', () => {
  assert.equal(bilingualLabel('Swift Boots'), 'Swift Boots (Botas Velozes)');
  assert.equal(bilingualLabel('Genius Wand'), 'Genius Wand (Varinha Genial)');
  assert.equal(bilingualLabel('Athena\'s Shield'), 'Athena\'s Shield (Escudo de Athena)');
});

test('prefers Portuguese item names from the live provider', () => {
  assert.equal(bilingualLabel('Arcane Boots', 'Botas Arcanas do catálogo'), 'Arcane Boots (Botas Arcanas do catálogo)');
  assert.equal(bilingualLabel('Tough Boots', 'Tough Boots'), 'Tough Boots (Botas Resistentes)');
});

test('localizes build spell, emblem and stat labels', () => {
  assert.equal(bilingualLabel('Flicker', '', 'spell'), 'Flicker (Cintilar)');
  assert.equal(bilingualLabel('Retribution', '', 'spell'), 'Retribution (Retribuição)');
  assert.equal(bilingualLabel('Assassin', '', 'emblem'), 'Assassin (Assassino)');
  assert.match(bilingualAttributes('Physical Attack +10\\nMagic Power +12'), /Ataque Físico/);
  assert.match(bilingualAttributes('Physical Attack +10\\nMagic Power +12'), /Poder Mágico/);
});

test('does not invent a Portuguese name for unknown future items', () => {
  assert.equal(bilingualLabel('New Patch Item'), 'New Patch Item');
  assert.equal(bilingualLabel('', ''), 'não informado');
});
