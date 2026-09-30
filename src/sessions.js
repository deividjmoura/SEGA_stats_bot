import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import crypto from 'node:crypto';
import { BOT_TOKEN, SESSION_FILE, HAS_PERSISTENT_DISK } from './config.js';

const SESSION_KEY = crypto.createHash('sha256').update(BOT_TOKEN || '').digest();

/** telegramId -> { jwt, roleId, zoneId, name } — quem tem sessão válida. */
export const authenticatedPlayers = new Map();

/**
 * telegramId -> { roleId, zoneId, name } — quem já se cadastrou algum dia.
 * Sobrevive à expiração do JWT: assim o jogador só reenvia o código,
 * sem ter que digitar ID e Zone de novo.
 */
export const knownPlayers = new Map();

function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', SESSION_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
}

function decrypt(payload) {
  const data = Buffer.from(payload, 'base64');
  const iv = data.subarray(0, 12);
  const tag = data.subarray(12, 28);
  const encrypted = data.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', SESSION_KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

/** Registra o jogador nos dois mapas de uma vez. */
export function rememberPlayer(telegramId, { jwt, roleId, zoneId, name }) {
  knownPlayers.set(telegramId, { roleId, zoneId, name: name ?? knownPlayers.get(telegramId)?.name ?? null });
  if (jwt) authenticatedPlayers.set(telegramId, { jwt, roleId, zoneId, name: name ?? null });
}

/**
 * Remove apenas a sessão (JWT), preservando ID/Zone para o próximo login.
 * É o que roda quando a API devolve 401/403.
 */
export function expireSession(telegramId) {
  const player = authenticatedPlayers.get(telegramId);
  if (player) {
    knownPlayers.set(telegramId, {
      roleId: player.roleId,
      zoneId: player.zoneId,
      name: player.name ?? null
    });
  }
  authenticatedPlayers.delete(telegramId);
}

/** Desvincula de vez (comando /sair). */
export function forgetPlayer(telegramId) {
  authenticatedPlayers.delete(telegramId);
  knownPlayers.delete(telegramId);
}

let writeChain = Promise.resolve();

export function saveSessions() {
  writeChain = writeChain
    .then(() => writeNow())
    .catch((error) => console.error('❌ Erro ao salvar sessões:', error.message));
  return writeChain;
}

async function writeNow() {
  const stored = {};

  // Grava todo mundo que o bot conhece, tenha sessão ativa ou não.
  for (const [telegramId, known] of knownPlayers) {
    const session = authenticatedPlayers.get(telegramId);
    stored[telegramId] = {
      jwt: session?.jwt ? encrypt(session.jwt) : null,
      roleId: known.roleId,
      zoneId: known.zoneId,
      name: known.name ?? null,
      savedAt: new Date().toISOString()
    };
  }

  await fs.mkdir(dirname(SESSION_FILE), { recursive: true });
  const tmp = `${SESSION_FILE}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(stored, null, 2), 'utf8');
  await fs.rename(tmp, SESSION_FILE); // troca atômica: nunca deixa arquivo pela metade
}

export async function restoreSessions() {
  try {
    const raw = await fs.readFile(SESSION_FILE, 'utf8');
    const stored = JSON.parse(raw);
    let sessions = 0;
    let known = 0;
    let failed = 0;

    for (const [rawId, player] of Object.entries(stored)) {
      const telegramId = Number(rawId);
      if (!Number.isFinite(telegramId) || !player?.roleId) {
        failed += 1;
        continue;
      }

      knownPlayers.set(telegramId, {
        roleId: player.roleId,
        zoneId: player.zoneId,
        name: player.name ?? null
      });
      known += 1;

      if (!player.jwt) continue;

      // try por entrada: um registro corrompido não derruba os outros.
      try {
        authenticatedPlayers.set(telegramId, {
          jwt: decrypt(player.jwt),
          roleId: player.roleId,
          zoneId: player.zoneId,
          name: player.name ?? null
        });
        sessions += 1;
      } catch {
        failed += 1;
      }
    }

    console.log(
      `🔐 Restaurado: ${sessions} sessão(ões) ativa(s), ${known} jogador(es) conhecido(s)` +
        (failed ? ` — ${failed} registro(s) inválido(s) ignorado(s)` : '')
    );
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log('🔐 Nenhum arquivo de sessão ainda. Começando do zero.');
    } else {
      console.error('❌ Erro ao restaurar sessões:', error.message);
    }
  }

  if (!HAS_PERSISTENT_DISK) {
    console.warn(
      '\n⚠️  ATENÇÃO: NENHUM VOLUME PERSISTENTE DETECTADO\n' +
        '   O disco da Railway é efêmero: TODOS os cadastros serão perdidos no próximo deploy.\n' +
        '   Correção (gratuita): Railway → seu serviço → Settings → Volumes → New Volume\n' +
        '   Mount path: /data — e pronto, o bot detecta sozinho.\n'
    );
  } else {
    console.log('💾 Volume persistente OK — os cadastros sobrevivem aos deploys.');
  }
}
