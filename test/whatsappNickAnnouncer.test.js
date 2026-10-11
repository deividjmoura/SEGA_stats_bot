import test from 'node:test';
import assert from 'node:assert/strict';
import { createNickAnnouncer } from '../src/whatsapp/nickAnnouncer.js';

test('anuncia uma vez e somente após 15 minutos sem mensagem', async () => {
  let time = 0;
  const replies = [];
  const announcer = createNickAnnouncer({
    lookupNick: async () => 'Abaddon',
    now: () => time
  });
  const input = { groupJid: 'grupo@g.us', senderJid: '55119999@s.whatsapp.net', message: { key: { id: '1' } }, sendReply: async (reply) => replies.push(reply) };
  assert.equal(await announcer.handle(input), true);
  time = 60_000;
  assert.equal(await announcer.handle(input), false);
  time = 15 * 60_000;
  assert.equal(await announcer.handle(input), false); // 14 minutos desde a última
  time = 30 * 60_000;
  assert.equal(await announcer.handle(input), true);
  assert.deepEqual(replies.map((r) => r.text), ['Abaddon disse:', 'Abaddon disse:']);
});

test('ignora histórico, mensagens próprias, conversas privadas e pessoas sem nick', async () => {
  const replies = [];
  const announcer = createNickAnnouncer({ lookupNick: async (jid) => jid.startsWith('sem') ? null : 'Abaddon' });
  const base = { groupJid: 'grupo@g.us', senderJid: '5511@s.whatsapp.net', message: { key: { id: '1' } }, sendReply: async (reply) => replies.push(reply) };
  assert.equal(await announcer.handle({ ...base, fromMe: true }), false);
  assert.equal(await announcer.handle({ ...base, isHistory: true }), false);
  assert.equal(await announcer.handle({ ...base, groupJid: '5511@s.whatsapp.net' }), false);
  assert.equal(await announcer.handle({ ...base, senderJid: 'sem@s.whatsapp.net' }), false);
  assert.equal(replies.length, 0);
});

test('controla silêncio por pessoa e por grupo', async () => {
  const replies = [];
  const announcer = createNickAnnouncer({ lookupNick: async () => 'Abaddon' });
  const base = { groupJid: 'a@g.us', senderJid: 'p@s.whatsapp.net', message: { key: { id: '1' } }, sendReply: async (r) => replies.push(r) };
  await announcer.handle(base);
  await announcer.handle({ ...base, senderJid: 'q@s.whatsapp.net' });
  await announcer.handle({ ...base, groupJid: 'b@g.us' });
  assert.equal(replies.length, 3);
});
