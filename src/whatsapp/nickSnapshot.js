import { writeJson } from '../storage/jsonStore.js';

/**
 * Gera um snapshot público mínimo para a integração do WhatsApp.
 * Nunca inclui JWT, Role ID, Zone ID ou IDs do Telegram.
 */
export function buildNickSnapshot(players, updatedAt = new Date().toISOString()) {
  const names = [...new Set(
    (Array.isArray(players) ? players : [])
      .map((player) => String(player?.name || '').trim())
      .filter(Boolean)
  )].sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));

  return {
    updatedAt,
    players: names.map((name) => ({ name }))
  };
}

/**
 * Persiste somente os nicks verificados/disponíveis para consumo posterior.
 * O caminho pode ser configurado por WHATSAPP_NICKS_FILE.
 */
export async function writeNickSnapshot(filePath, players) {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    throw new TypeError('É necessário informar o caminho do snapshot de nicks.');
  }

  const snapshot = buildNickSnapshot(players);
  await writeJson(filePath, snapshot);
  return snapshot;
}
