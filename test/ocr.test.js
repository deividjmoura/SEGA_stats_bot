import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectKind,
  nickMatches,
  parseKda,
  parseScreenshotStats
} from '../src/ocr.js';

test('parseKda prefere a linha do jogador quando o nick aparece no OCR', () => {
  const ocr = [
    'Harley 12/1/8',
    'Lucas&SEGA 4/2/10',
    'Layla 2/8/3'
  ].join('\n');

  assert.deepEqual(parseKda(ocr, 'Lucas&SEGA'), {
    kills: 4,
    deaths: 2,
    assists: 10
  });
});

test('nickMatches aceita símbolos do nick sem transformar em substring permissiva', () => {
  assert.equal(nickMatches('Lucas&SEGA', 'Lucas&SEGA'), true);
  assert.equal(nickMatches('Lucas&SEGA', 'LucasSEGA'), true);
  assert.equal(nickMatches('Lucas&SEGA', 'Lucas'), false);
});

test('parseScreenshotStats identifica Battle ID e tela final', () => {
  const parsed = parseScreenshotStats(
    'Victory\nLucas&SEGA\n7/2/11\nBattle ID 1234567890123456\nMVP'
  );

  assert.equal(parsed.kind, 'match_result');
  assert.equal(parsed.battleId, '1234567890123456');
  assert.deepEqual(parsed.kda, { kills: 7, deaths: 2, assists: 11 });
  assert.equal(parsed.mvp, true);
  assert.equal(parsed.result, 'win');
});

test('tela desconhecida é classificada para descarte', () => {
  assert.equal(detectKind('uma foto qualquer sem dados de partida'), 'unknown');
});
