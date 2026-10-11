import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNickListMessage, publishNickList } from '../src/whatsapp/nickList.js';

test('monta lista ordenada, ignora nomes vazios e remove duplicados', () => {
  const message = buildNickListMessage([
    { name: 'Zed' },
    { name: 'Deivid' },
    { name: '  ' },
    { name: 'Deivid' },
    { name: null }
  ]);

  assert.equal(
    message,
    '🎮 *Jogadores cadastrados do clã SEGA*\n\n1. Deivid\n2. Zed\n\nTotal: 2 jogador(es).'
  );
});

test('informa quando ainda não há jogadores com nick disponível', () => {
  assert.match(buildNickListMessage([]), /Ainda não há nicks disponíveis/);
});

test('publica a lista no grupo informado', async () => {
  let sent;
  const client = {
    async sendMessage(jid, payload) {
      sent = { jid, payload };
      return { key: { id: 'test-message' } };
    }
  };

  await publishNickList({
    client,
    groupJid: '12345@g.us',
    players: [{ name: 'Deivid' }]
  });

  assert.equal(sent.jid, '12345@g.us');
  assert.match(sent.payload.text, /Deivid/);
});

test('rejeita cliente ou grupo ausente', async () => {
  await assert.rejects(
    publishNickList({ client: {}, groupJid: '12345@g.us', players: [] }),
    /sendMessage/
  );
  await assert.rejects(
    publishNickList({ client: { sendMessage() {} }, groupJid: '', players: [] }),
    /identificador do grupo/
  );
});
