import test from 'node:test';
import assert from 'node:assert/strict';
import { createOutgoingEchoGuard, ownerKnowledgeQuestion } from '../src/messageSafety.js';
import { intentOf } from '../src/mlbbKnowledgeV2.js';

test('help echo is ignored even before WhatsApp returns a message ID', () => {
  let time = 1000;
  const guard = createOutgoingEchoGuard(() => time, 120000);
  const help = '🎮 *SEGA STATS — AJUDA COMPLETA*\n• @SEGA quem countera Harley?';
  const untrack = guard.reserve('owner@s.whatsapp.net', help);
  assert.equal(guard.isEcho({remoteJid:'owner@s.whatsapp.net',fromMe:true,id:'fresh'}, help), true);
  assert.equal(guard.isEcho({remoteJid:'different@g.us',fromMe:true,id:'other'}, help), false);
  guard.rememberId('outgoing-id');
  assert.equal(guard.isEcho({remoteJid:'owner@s.whatsapp.net',fromMe:true,id:'outgoing-id'}, 'something else'), true);
  time += 120001;
  assert.equal(guard.isEcho({remoteJid:'owner@s.whatsapp.net',fromMe:true,id:'fresh'}, help), false);
  untrack();
});

test('owner self-chat routes MLBB questions but never treats help text as prompt', () => {
  assert.deepEqual(ownerKnowledgeQuestion('quem mata Gusion?'), {question:'quem mata Gusion?',prefixed:false});
  assert.deepEqual(ownerKnowledgeQuestion('SEGA, quem cautera Harley?'), {question:'quem cautera Harley?',prefixed:true});
  assert.deepEqual(ownerKnowledgeQuestion('@SEGA quem countera Fanny?'), {question:'quem countera Fanny?',prefixed:true});
  assert.equal(ownerKnowledgeQuestion('!ajuda'), null);
  assert.equal(ownerKnowledgeQuestion('!grupos'), null);
  assert.equal(ownerKnowledgeQuestion('meu lembrete pessoal'), null);
  assert.equal(ownerKnowledgeQuestion('🎮 *SEGA STATS — AJUDA COMPLETA*\n@SEGA quem countera Harley?'), null);
});

test('counter questions include natural expressions and frequent misspellings', () => {
  for (const question of [
    'quem mata Gusion?', 'quem derrota Harley?', 'quem sola Fanny?',
    'quem segura Argus?', 'quem ganha da Silvanna?', 'qual heroi é bom contra Nana?',
    'quem countera Harley?', 'quem cautera Gusion?', 'quem cauntera Gusion?',
    'quem coun Harley?', 'quem couter Harley?', 'quem é forte contra Harley?'
  ]) assert.equal(intentOf(question),'counter',question);
});

test('items, builds, tips and hero role are classified separately', () => {
  assert.equal(intentOf('qual item faço contra Silvanna?'),'items');
  assert.equal(intentOf('como jogar contra Fanny?'),'tips');
  assert.equal(intentOf('qual build faço de Harley?'),'build');
  assert.equal(intentOf('qual a função de Khufra?'),'hero');
});
