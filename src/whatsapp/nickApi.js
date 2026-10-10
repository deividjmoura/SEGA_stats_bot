import { createServer } from 'node:http';
import { buildNickSnapshot } from './nickSnapshot.js';

const ROUTE = '/api/whatsapp/nicks';
const MIN_TOKEN_LENGTH = 32;

function isAuthorized(request, expectedToken) {
  const authorization = request.headers.authorization || '';
  const prefix = 'Bearer ';
  if (!authorization.startsWith(prefix)) return false;

  const provided = Buffer.from(authorization.slice(prefix.length));
  const expected = Buffer.from(expectedToken);
  return provided.length === expected.length && provided.length > 0 &&
    (awaitSafeCompare(provided, expected));
}

function awaitSafeCompare(left, right) {
  // Lengths are checked before timingSafeEqual to avoid its length exception.
  return cryptoTimingSafeEqual(left, right);
}

import { timingSafeEqual as cryptoTimingSafeEqual } from 'node:crypto';

export function createNickApiServer({ token, getPlayers }) {
  if (typeof token !== 'string' || token.length < MIN_TOKEN_LENGTH) {
    throw new TypeError('WHATSAPP_NICKS_API_TOKEN deve ter pelo menos 32 caracteres.');
  }
  if (typeof getPlayers !== 'function') {
    throw new TypeError('getPlayers deve ser uma função.');
  }

  return createServer((request, response) => {
    if (request.url !== ROUTE) {
      response.writeHead(404, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      response.end(JSON.stringify({ error: 'not_found' }));
      return;
    }

    if (request.method !== 'GET') {
      response.writeHead(405, { allow: 'GET', 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      response.end(JSON.stringify({ error: 'method_not_allowed' }));
      return;
    }

    if (!isAuthorized(request, token)) {
      response.writeHead(401, {
        'www-authenticate': 'Bearer',
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store'
      });
      response.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }

    try {
      const verifiedPlayers = getPlayers()
        .filter((player) => player?.nameVerified === true && typeof player?.name === 'string')
        .map((player) => ({ name: player.name }));
      const snapshot = buildNickSnapshot(verifiedPlayers);

      response.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff'
      });
      response.end(JSON.stringify(snapshot));
    } catch {
      response.writeHead(500, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      response.end(JSON.stringify({ error: 'internal_error' }));
    }
  });
}

export function startNickApi({ token = process.env.WHATSAPP_NICKS_API_TOKEN, getPlayers, port = process.env.PORT || 3000, host = '0.0.0.0', logger = console } = {}) {
  if (!token) {
    logger.log('ℹ️ API de nicks do WhatsApp desativada (WHATSAPP_NICKS_API_TOKEN não configurado).');
    return null;
  }
  if (typeof token !== 'string' || token.length < MIN_TOKEN_LENGTH) {
    logger.error('❌ API de nicks do WhatsApp desativada: WHATSAPP_NICKS_API_TOKEN deve ter pelo menos 32 caracteres.');
    return null;
  }

  const server = createNickApiServer({ token, getPlayers });
  server.on('error', (error) => {
    logger.error('❌ Falha na API de nicks do WhatsApp:', error?.message || error);
  });
  server.listen(Number(port), host, () => {
    logger.log('🔒 API de nicks do WhatsApp disponível na porta ' + Number(port) + '.');
  });
  return server;
}
