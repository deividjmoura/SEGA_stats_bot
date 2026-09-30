import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import crypto from 'node:crypto';
import { BOT_TOKEN, SESSION_FILE, HAS_PERSISTENT_DISK } from './config.js';

const SESSION_KEY = crypto.createHash('sha256').update(BOT_TOKEN || '').digest();

/** telegramId -> { jwt, roleId, zoneId, name } */
export const authenticatedPlayers = new Map();

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

// Grava de forma serializada para não corromper o arquivo com escritas concorrentes.
let writeChain = Promise.resolve();

export function saveSessions() {
  writeChain = writeChain.then(() => writeNow()).catch((error) => {
    console.error('❌ Erro ao salvar sessões:', error.message);
  });
  return writeChain;
}

async function writeNow() {
  const stored = {};
  for (const [telegramId, player] of authenticatedPlayers) {
    stored[telegramId] = {
      jwt: encrypt(player.jwt),
      roleId: player.roleId,
      zoneId: player.zoneId,
      name: player.name ?? null,
      savedAt: new Date().toISOString()
    };
  }

  await fs.mkdir(dirname(SESSION_FILE), { recursive: true });
  // Escrita atômica: grava em temporário e renomeia.
  const tmp = `${SESSION_FILE}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(stored, null, 2), 'utf8');
  await fs.rename(tmp, SESSION_FILE);
}

export async function restoreSessions() {
  try {
    const raw = await fs.readFile(SESSION_FILE, 'utf8');
    const stored = JSON.parse(raw);
    let restored = 0;
    let failed = 0;

    for (const [telegramId, player] of Object.entries(stored)) {
      // try por entrada: um registro corrompido não pode derrubar os outros.
      try {
        authenticatedPlayers.set(Number(telegramId), {
          jwt: decrypt(player.jwt),
          roleId: player.roleId,
          zoneId: player.zoneId,
          name: player.name ?? null
        });
        restored += 1;
      } catch {
        failed += 1;
      }
    }

    console.log(`🔐 Sessões restauradas: ${restored}${failed ? ` (${failed} inválidas ignoradas)` : ''}`);
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log('🔐 Nenhum arquivo de sessão encontrado ainda. Começando do zero.');
    } else {
      console.error('❌ Erro ao restaurar sessões:', error.message);
    }
  }

  if (!HAS_PERSISTENT_DISK) {
    console.warn(
      '⚠️  Sem volume persistente. Na Railway o disco é efêmero e as sessões serão perdidas a cada deploy/restart.\n' +
      '    Solução gratuita: adicione um Volume ao serviço (a env RAILWAY_VOLUME_MOUNT_PATH é usada automaticamente).'
    );
  }
}
