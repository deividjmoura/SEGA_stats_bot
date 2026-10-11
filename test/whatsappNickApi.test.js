import test from 'node:test';
import assert from 'node:assert/strict';
import { createNickApiServer, startNickApi } from '../src/whatsapp/nickApi.js';

const TOKEN = 'test-token-that-is-at-least-32-characters-long';

async function withServer(server, run) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const address = server.address();
    await run('http://127.0.0.1:' + address.port);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test('API exige bearer token e não divulga campos privados', async () => {
  const server = createNickApiServer({
    token: TOKEN,
    getPlayers: () => [
      { name: 'Zed', nameVerified: true, jwt: 'DO_NOT_LEAK', roleId: '123' },
      { name: 'Deivid', nameVerified: true },
      { name: 'Unverified', nameVerified: false },
      { name: '   ', nameVerified: true }
    ]
  });

  await withServer(server, async (baseUrl) => {
    const denied = await fetch(baseUrl + '/api/whatsapp/nicks');
    assert.equal(denied.status, 401);

    const response = await fetch(baseUrl + '/api/whatsapp/nicks', {
      headers: { authorization: 'Bearer ' + TOKEN }
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = await response.json();
    assert.deepEqual(body.players, [{ name: 'Deivid' }, { name: 'Zed' }]);
    assert.equal(JSON.stringify(body).includes('DO_NOT_LEAK'), false);
    assert.equal(JSON.stringify(body).includes('roleId'), false);
    assert.equal(JSON.stringify(body).includes('Unverified'), false);
  });
});

test('API limita rota e método', async () => {
  const server = createNickApiServer({ token: TOKEN, getPlayers: () => [] });
  await withServer(server, async (baseUrl) => {
    const notFound = await fetch(baseUrl + '/other', { headers: { authorization: 'Bearer ' + TOKEN } });
    assert.equal(notFound.status, 404);
    const wrongMethod = await fetch(baseUrl + '/api/whatsapp/nicks', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + TOKEN }
    });
    assert.equal(wrongMethod.status, 405);
  });
});

test('API não inicia sem token configurado', () => {
  const messages = [];
  const result = startNickApi({ token: '', getPlayers: () => [], logger: { log: (v) => messages.push(v), error: (v) => messages.push(v) } });
  assert.equal(result, null);
  assert.match(messages[0], /desativada/);
});

test('token curto é rejeitado', () => {
  assert.throws(() => createNickApiServer({ token: 'short', getPlayers: () => [] }), /32 caracteres/);
});
