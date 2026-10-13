import makeWASocket, { DisconnectReason, useMultiFileAuthState, Browsers, proto, generateWAMessageFromContent } from '@whiskeysockets/baileys';
import pino from 'pino';
import { ANNOUNCEMENT_NOTICE, isAnnouncementPost, selectCommunityAnnouncementsGroup } from './announcementRouting.js';
import { shouldProcessPrivateMessage, shouldProcessRegistrationPrivateMessage } from './privateChatRouting.js';
import { ownerIdentityMatchesPhone } from './ownerIdentity.js';
import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import { apiFetch, isApiSuccess, apiErrorMessage, profileName, battleBelongsToPlayer, normalizeVerifiedMatch, fetchPlayerOverview } from './roneApi.js';
import { answerMlbbQuestion, listKnowledgeExamples } from './mlbbKnowledgeV2.js';
import { createOutgoingEchoGuard, ownerKnowledgeQuestion } from './messageSafety.js';

const INACTIVITY_MS = 15 * 60 * 1000;
const REGISTRATION_TTL_MS = 15 * 60 * 1000;
const logger = pino({ level: 'silent' });
const authDir = process.env.WHATSAPP_AUTH_DIR || '/app/data/whatsapp-auth-v2';
const dataDir = process.env.WHATSAPP_DATA_DIR || '/app/data';
const sessionsFile = dataDir + '/whatsapp-players.json';
const registrationsFile = dataDir + '/whatsapp-registrations.json';
const battlesFile = dataDir + '/whatsapp-battles.json';
const announcementsFile = dataDir + '/whatsapp-announcement-deliveries.json';
const targetGroup = process.env.WHATSAPP_GROUP_JID || null;
const configuredAnnouncementsGroup = process.env.WHATSAPP_ANNOUNCEMENTS_GROUP_JID || null;
let announcementsGroup = null; // Activated only after checking community metadata.
const announcementsEnabled = process.env.WHATSAPP_ANNOUNCEMENTS_ENABLED === 'true';
const pairPhone = process.env.WHATSAPP_PAIR_PHONE?.replace(/\D/g, '');
const enabled = process.env.WHATSAPP_REPLY_ENABLED === 'true';
const secret = process.env.WHATSAPP_SESSION_ENCRYPTION_KEY;
if (!secret) throw new Error('WHATSAPP_SESSION_ENCRYPTION_KEY não configurada');
const SESSION_KEY = crypto.createHash('sha256').update(secret).digest();

const players = new Map();
const registrations = new Map();
const lastMessageBySender = new Map();
const botSentMessageIds = new Set();
const outgoingEchoGuard = createOutgoingEchoGuard();
const announcedIds = new Set();
const pendingAnnouncementIds = new Set();
let announcementHistoryLoaded = false;
const groupNames = new Map();
const identityAliases = new Map();
function linkIdentities(jids) {
  const all = [...new Set(jids.filter(Boolean).flatMap(jidAliases))];
  for (const jid of all) {
    const known = identityAliases.get(jid) || [];
    identityAliases.set(jid, [...new Set([...known, ...all])]);
  }
  const name = all.map(jid => groupNames.get(jid)).find(Boolean);
  if (name) for (const jid of all) groupNames.set(jid, name);
}
function linkedAliases(jid) {
  const base = jidAliases(jid);
  return [...new Set([...base, ...base.flatMap(x => identityAliases.get(x) || [])])];
}
const menuSessions = new Map();
const MENU_TTL_MS = 5 * 60 * 1000;
let ownJid = null;
let ownerAccountJids = [];

async function readJson(path, fallback) {
  try { return JSON.parse(await fs.readFile(path, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return fallback; throw e; }
}
async function writeJson(path, value) {
  await fs.mkdir(dirname(path), { recursive: true });
  const tmp = path + '.' + process.pid + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
  await fs.rename(tmp, path);
}
function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', SESSION_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
}
function decrypt(payload) {
  const data = Buffer.from(payload, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', SESSION_KEY, data.subarray(0, 12));
  decipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8');
}
async function savePlayers() {
  const out = {};
  for (const [jid, p] of players) out[jid] = { ...p, jwt: encrypt(p.jwt) };
  await writeJson(sessionsFile, out);
}
async function restorePlayers() {
  const stored = await readJson(sessionsFile, {});
  for (const [jid, p] of Object.entries(stored)) {
    try { players.set(jid, { ...p, jwt: decrypt(p.jwt) }); }
    catch (e) { console.warn('Sessão WhatsApp ignorada:', jid, e?.message); }
  }
  console.log('Jogadores WhatsApp restaurados:', players.size);
}
async function saveRegistrations() {
  await writeJson(registrationsFile, Object.fromEntries(registrations));
}
async function setRegistration(jid, state) {
  registrations.set(jid, { ...state, updatedAt: new Date().toISOString() });
  await saveRegistrations();
}
async function deleteRegistration(jid) {
  registrations.delete(jid); await saveRegistrations();
}
async function restoreRegistrations() {
  const stored = await readJson(registrationsFile, {});
  const now = Date.now();
  for (const [jid, state] of Object.entries(stored)) {
    const updated = Date.parse(state?.updatedAt || '');
    if (['role_id','zone_id','verification_code'].includes(state?.step) && Number.isFinite(updated) && now - updated < REGISTRATION_TTL_MS) registrations.set(jid, state);
  }
}
function unwrapMessage(message) {
  let current = message || {};
  for (let i = 0; i < 6; i += 1) {
    const next =
      current?.ephemeralMessage?.message ||
      current?.viewOnceMessage?.message ||
      current?.viewOnceMessageV2?.message ||
      current?.viewOnceMessageV2Extension?.message ||
      current?.documentWithCaptionMessage?.message ||
      current?.editedMessage?.message?.protocolMessage?.editedMessage ||
      current?.protocolMessage?.editedMessage;
    if (!next) break;
    current = next;
  }
  return current;
}
function messageText(message) {
  const m = unwrapMessage(message);
  return String(
    m?.conversation ||
    m?.extendedTextMessage?.text ||
    m?.imageMessage?.caption ||
    m?.videoMessage?.caption ||
    m?.documentMessage?.caption ||
    m?.buttonsResponseMessage?.selectedButtonId ||
    m?.listResponseMessage?.singleSelectReply?.selectedRowId ||
    (() => { try { return JSON.parse(m?.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson || '{}').id || ''; } catch { return ''; } })() ||
    ''
  ).trim();
}
function aliasesFor(key) {
  return [...new Set([key?.participant, key?.participantAlt, key?.remoteJid].filter(Boolean))];
}
function findPlayer(aliases) {
  for (const jid of aliases) if (players.has(jid)) return players.get(jid);
  if (aliases.some(jid => jid === ownJid) && players.has('self')) return players.get('self');
  return null;
}
async function discoverAnnouncementsGroup(sock) {
  if (!announcementsEnabled || !targetGroup) return;
  announcementsGroup = null; // Keep notifications off while verifying identity.
  try {
    const generalMetadata = await sock.groupMetadata(targetGroup);
    const groups = await sock.groupFetchAllParticipating();
    const found = selectCommunityAnnouncementsGroup(groups, generalMetadata);
    if (!found) {
      console.warn('Avisos SEGA desativados: canal oficial da mesma comunidade não identificado sem ambiguidade.');
      return;
    }
    if (configuredAnnouncementsGroup && configuredAnnouncementsGroup !== found) {
      console.error('Avisos SEGA desativados: o ID configurado não corresponde ao canal oficial da comunidade.');
      return;
    }
    announcementsGroup = found;
    console.log('Avisos SEGA: canal oficial da comunidade verificado:', found);
  } catch (error) {
    console.error('Avisos SEGA desativados: falha ao confirmar canal oficial:', error?.message);
  }
}

async function notifyAnnouncement(sock, message, type) {
  if (!announcementsEnabled || !announcementsGroup || !targetGroup ||
      announcementsGroup === targetGroup ||
      !isAnnouncementPost(message, type, announcementsGroup)) return false;
  const sourceId = announcementsGroup + ':' + message.key.id;
  if (botSentMessageIds.has(message.key.id) ||
      announcedIds.has(sourceId) || pendingAnnouncementIds.has(sourceId)) return false;
  // Only recent events can announce. Old backfilled messages must never trigger broadcasts.
  const rawTimestamp = message.messageTimestamp;
  const seconds = typeof rawTimestamp === 'number' ? rawTimestamp
    : typeof rawTimestamp === 'string' ? Number(rawTimestamp)
    : rawTimestamp?.toNumber?.();
  if (!Number.isFinite(seconds) || Math.abs(Date.now() / 1000 - seconds) > 600) return false;
  pendingAnnouncementIds.add(sourceId);
  try {
    await sendText(sock, targetGroup, ANNOUNCEMENT_NOTICE);
    announcedIds.add(sourceId);
    const recent = [...announcedIds].slice(-500);
    announcedIds.clear();
    for (const id of recent) announcedIds.add(id);
    await writeJson(announcementsFile, recent);
    console.log('Aviso de comunicado enviado ao grupo Geral.');
    return true;
  } catch (error) {
    console.error('Falha ao notificar comunicado:', error?.message);
    return false;
  } finally {
    pendingAnnouncementIds.delete(sourceId);
  }
}

async function sendText(sock, jid, text) {
  // Reserve before sending, because the echo may arrive before sendMessage returns.
  const cancelReservation = outgoingEchoGuard.reserve(jid, text);
  try {
    const sent = await sock.sendMessage(jid, { text });
    if (sent?.key?.id) {
      outgoingEchoGuard.rememberId(sent.key.id);
      botSentMessageIds.add(sent.key.id);
      if (botSentMessageIds.size > 1000) {
        for (const oldId of [...botSentMessageIds].slice(0, 300)) botSentMessageIds.delete(oldId);
      }
    }
    return sent;
  } catch (error) {
    cancelReservation();
    throw error;
  }
}
async function sendSegaMenu(sock, jid, sessionKey = jid) {
  const menu = [
    '🎮 *SEGA STATS*',
    '━━━━━━━━━━━━━━━━',
    '',
    '1️⃣ 📊 *MEUS STATS*',
    '   `!stats`',
    '',
    '2️⃣ 🏆 *RANKING DO CLÃ*',
    '   `!ranking` _(em desenvolvimento)_',
    '',
    '3️⃣ 🌟 *HIGHLIGHTS*',
    '   `!highlights` _(em desenvolvimento)_',
    '',
    '4️⃣ 🎮 *CADASTRO*',
    '   `!cadastrar` _(somente no privado)_',
    '',
    '5️⃣ ❓ *AJUDA*',
    '   `!ajuda`',
    '',
    '━━━━━━━━━━━━━━━━',
    '⌨️ *Digite 1 a 5 ou escreva o comando diretamente.*'
  ].join('\n');
  menuSessions.set(sessionKey, Date.now() + MENU_TTL_MS);
  return sendText(sock, jid, menu);
}

async function loadBattles() { return readJson(battlesFile, {}); }
async function saveVerifiedBattle(jid, player, verification) {
  const all = await loadBattles();
  const owner = verification.match || {};
  const normalized = normalizeVerifiedMatch(owner, verification.matchId, {});
  const playerKey = String(player.roleId) + ':' + String(player.zoneId);
  const rows = Array.isArray(all[playerKey]) ? all[playerKey] : [];
  if (rows.some(row => String(row.battleId) === String(normalized.battleId))) return { duplicate: true, match: normalized };
  rows.push({ ...normalized, playerName: player.name, verifiedAt: new Date().toISOString(), via: 'whatsapp', jidAlias: jid });
  all[playerKey] = rows.slice(-500);
  await writeJson(battlesFile, all);
  return { duplicate: false, match: normalized };
}
function savedStats(rows) {
  const games = rows.length;
  const wins = rows.filter(r => r.result === 'win').length;
  const losses = rows.filter(r => r.result === 'loss').length;
  const totals = rows.reduce((a,r) => ({
    k: a.k + Number(r.kda?.kills || 0),
    d: a.d + Number(r.kda?.deaths || 0),
    a: a.a + Number(r.kda?.assists || 0),
    mvp: a.mvp + Number(Boolean(r.mvp))
  }), {k:0,d:0,a:0,mvp:0});
  return {games,wins,losses,totals,rate:games ? (100*wins/games).toFixed(1) : '0.0'};
}
let cachedRankRecords = [];
let rankRecordsCachedUntil = 0;
async function getRankRecords() {
  if (cachedRankRecords.length && Date.now() < rankRecordsCachedUntil) return cachedRankRecords;
  try {
    const response = await apiFetch('/academy/ranks?size=100&index=1&lang=en');
    const body = await response.json().catch(() => ({}));
    const records = body?.data?.records;
    if (response.ok && isApiSuccess(body) && Array.isArray(records) && records.length) {
      cachedRankRecords = records;
      rankRecordsCachedUntil = Date.now() + 6 * 60 * 60 * 1000;
    }
  } catch (error) { console.warn('Patentes indisponíveis:', error?.message); }
  return cachedRankRecords;
}
function portugueseRankName(name) {
  const text = String(name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (/immortal|imortal|不朽/.test(text)) return 'Mítico Imortal';
  if (/glory|gloria|荣耀/.test(text)) return 'Glória Mítica';
  if (/honor|honour|honra|荣誉/.test(text)) return 'Honra Mítica';
  if (/mythic|mitico|神话/.test(text)) return 'Mítico';
  if (/grand.?master|grao.?mestre|宗师/.test(text)) return 'Grão-Mestre';
  if (/legend|lenda|传奇/.test(text)) return 'Lenda';
  if (/epic|epico|史诗/.test(text)) return 'Épico';
  if (/master|mestre|大师/.test(text)) return 'Mestre';
  if (/elite|精英/.test(text)) return 'Elite';
  if (/warrior|guerreiro|勇士/.test(text)) return 'Guerreiro';
  return null;
}
function displayRankFromApi(code, records) {
  const rank = Number(code);
  if (!Number.isFinite(rank)) return 'Não disponível';
  // Entries can overlap; prefer the narrowest documented range rather than
  // silently taking whichever record the provider returned first.
  const candidates = records.filter(entry => {
    const data = entry?.data || {};
    const low = Number(data.rankid_start), high = Number(data.rankid_end);
    return Number.isFinite(low) && Number.isFinite(high) && low <= rank && rank <= high;
  });
  candidates.sort((a, b) => {
    const width = entry => Number(entry.data.rankid_end) - Number(entry.data.rankid_start);
    return width(a) - width(b);
  });
  const found = candidates[0];
  if (!found) return 'Patente não identificada';
  const data = found.data || {};
  // Rone sometimes gives a broad major rank and a more specific caption.
  // Prefer Honra, Glória or Imortal explicitly named by the API.
  const names = [data.bigrank_name, data.minrank_name, found.caption]
    .map(portugueseRankName).filter(Boolean);
  const name = names.find(rankName => ['Honra Mítica', 'Glória Mítica', 'Mítico Imortal'].includes(rankName))
    || names[0];
  if (!name) return 'Patente não identificada';
  // Rank IDs must never be treated as star counts. Imortal is not inferred
  // from a generic Glória record (Rone may group rank 236..9999 together).
  const roman = String(data.minrank_name || '').trim();
  return !['Mítico', 'Honra Mítica', 'Glória Mítica', 'Mítico Imortal'].includes(name) &&
    /^[IVXⅠⅡⅢⅣⅤⅥ]+$/i.test(roman)
    ? name + ' ' + roman : name;
}
async function sendPlayerStats(sock, jid, player) {
  if (!player?.jwt) return sendText(sock, jid, '🔐 Cadastre seu nick com !cadastrar para consultar seus dados.');
  const headers = { Authorization: 'Bearer ' + player.jwt };
  const lines = ['📊 *MEUS STATS — ' + player.name + '*'];
  let profile = null;
  let stats = null;
  try {
    const response = await apiFetch('/user/info?lang=pt', { headers });
    const body = await response.json().catch(() => ({}));
    if (response.ok && isApiSuccess(body)) profile = body.data || null;
  } catch (error) { console.warn('Perfil indisponível:', error?.message); }
  try {
    const response = await apiFetch('/user/stats?lang=pt', { headers });
    const body = await response.json().catch(() => ({}));
    if (response.ok && isApiSuccess(body)) stats = body.data || null;
  } catch (error) { console.warn('Estatísticas indisponíveis:', error?.message); }
  if (profile) {
    lines.push('', '🎮 *PERFIL*');
    if (profile.level != null) lines.push('⭐ Nível: ' + profile.level);
    if (profile.rank_level != null || profile.history_rank_level != null) {
      const rankRecords = await getRankRecords();
      const currentLabel = profile.rank_level == null ? null : displayRankFromApi(profile.rank_level, rankRecords);
      const bestLabel = profile.history_rank_level == null ? null : displayRankFromApi(profile.history_rank_level, rankRecords);
      if (currentLabel) lines.push('🏅 Patente atual: ' + currentLabel);
      if (bestLabel) lines.push('🥇 Melhor patente: ' + bestLabel);
      // Diagnose upstream ambiguity without storing player names, JWTs, or game IDs.
      if (currentLabel === bestLabel && profile.rank_level != null &&
          profile.history_rank_level != null && profile.rank_level !== profile.history_rank_level) {
        const recordsForCode = code => rankRecords.filter(row => {
          const d = row?.data || {};
          return Number(d.rankid_start) <= Number(code) && Number(code) <= Number(d.rankid_end);
        }).slice(0, 5).map(row => ({
          range: [row.data.rankid_start, row.data.rankid_end],
          major: String(row.data.bigrank_name || '').slice(0, 60),
          minor: String(row.data.minrank_name || '').slice(0, 30),
          caption: String(row.caption || '').slice(0, 60)
        }));
        console.info('[sega-rank-diagnostic]', JSON.stringify({
          currentCode: profile.rank_level,
          bestCode: profile.history_rank_level,
          sameDisplay: true,
          currentMatches: recordsForCode(profile.rank_level),
          bestMatches: recordsForCode(profile.history_rank_level)
        }));
      }
    }
  }
  if (stats) {
    const rows = [];
    if (stats.tc != null) rows.push('⚔️ Partidas totais: ' + stats.tc);
    if (stats.wc != null) rows.push('🏆 Vitórias totais: ' + stats.wc);
    if (Number(stats.tc) > 0 && stats.wc != null)
      rows.push('📈 Taxa de vitórias: ' + (100 * Number(stats.wc) / Number(stats.tc)).toFixed(1).replace('.', ',') + '%');
    if (stats.mvpc != null) rows.push('👑 MVPs totais: ' + stats.mvpc);
    if (stats.wsc != null) rows.push('🔥 Maior sequência: ' + stats.wsc);
    if (stats.as != null) rows.push('⭐ Nota média: ' + (Number(stats.as) / 100).toFixed(2).replace('.', ','));
    if (rows.length) lines.push('', '📊 *ESTATÍSTICAS DO JOGO*', ...rows);
  }
  if (!profile && !stats) lines.push('', '⚠️ Não consegui consultar seus dados agora. Tente novamente mais tarde.');
  // Keep technical errors in server logs, never expose them in the player card.
  return sendText(sock, jid, lines.join('\n'));
}

async function sendSavedRanking(sock, jid) {
  // Clã ranking stays paused until we can compare equally complete API
  // periods for every verified member. Never use manually selected matches.
  return sendText(sock, jid, '🏆 *RANKING DO CLÃ*\n\n⏳ Em desenvolvimento. O ranking oficial será baseado em dados confiáveis do jogo, sem prints ou partidas escolhidas pelos jogadores.');
}
async function sendHighlights(sock, jid) {
  return sendText(sock, jid, '🌟 *HIGHLIGHTS SEGA*\n\n⏳ Em desenvolvimento. Os destaques serão liberados quando conseguirmos consultar os dados necessários com segurança.');
}

function matchSummary(match) {
  const k = match?.kda || {};
  const result = match?.result === 'win' ? '🏆 Vitória' : match?.result === 'loss' ? '💀 Derrota' : '⚔️ Resultado';
  return result + '\n🎮 Herói: ' + (match?.hero || 'não informado') +
    '\n📊 K/D/A: ' + Number(k.kills || 0) + '/' + Number(k.deaths || 0) + '/' + Number(k.assists || 0) +
    (Number.isFinite(match?.score) ? '\n⭐ Nota: ' + match.score : '') +
    (match?.mvp ? '\n👑 MVP' : '');
}

function segaKnowledgeQuery(text) {
  const raw = String(text || '').trim();
  const textual = /@sega(?:[ _]?stats)?(?:[ _]?bot)?\b/i.test(raw);
  const cleaned = raw.replace(/@sega(?:[ _]?stats)?(?:[ _]?bot)?\b/ig, '').trim();
  return { textual, cleaned };
}
function isOwnMention(jid) {
  if (!jid || !ownJid) return false;
  const own = new Set(linkedAliases(ownJid));
  return linkedAliases(jid).some(alias => own.has(alias));
}
function fullHelpLines() {
  const examples = listKnowledgeExamples().slice(0, 12);
  return [
    '🎮 *SEGA STATS — AJUDA COMPLETA*', '━━━━━━━━━━━━━━━━', '',
    '📋 *MENU PRINCIPAL*', 'Digite *!sega*. Escolha uma opção de 1 a 5 ou use o comando diretamente.', '',
    '1️⃣ 📊 *MEUS STATS* — !stats',
    '2️⃣ 🏆 *RANKING DO CLÃ* — !ranking _(em desenvolvimento)_',
    '3️⃣ 🌟 *HIGHLIGHTS* — !highlights _(em desenvolvimento)_',
    '4️⃣ 🎮 *CADASTRO* — !cadastrar no privado',
    '5️⃣ ❓ *AJUDA* — !ajuda', '',
    '🔐 *CADASTRO*',
    'No privado: *!cadastrar* → Role ID → Zone ID → código recebido no correio interno do Mobile Legends. O bot confirma o nick vinculado à conta.', '',
    '📊 *SEUS STATS*',
    '*!stats* consulta os dados disponíveis diretamente na Rone Arena. Não é necessário enviar prints ou Battle ID.', '',
    '🏆 *RANKING E HIGHLIGHTS*',
    'Ainda em desenvolvimento: precisamos de dados consistentes da API para evitar classificações injustas.', '',
    '🧠 *CONHECIMENTO DE MOBILE LEGENDS*',
    'No Geral, escreva *@SEGA* com uma pergunta sobre counters, builds, itens, matchup, heróis ou rotas.', '',
    '💬 *EXEMPLOS DE PERGUNTAS*',
    ...examples.map(x => '• *@SEGA ' + x + '*'), '',
    '😂 *MENÇÕES E ZOEIRAS*',
    'Ao mencionar outra pessoa no Geral, o SEGA pode responder com uma zoeira sem revelar identificadores privados.', '',
    '🤖 *IMPORTANTE*',
    'O SEGA está conectado ao número do administrador; respostas automáticas aparecem como mensagens dessa conta.', '',
    '━━━━━━━━━━━━━━━━', '💡 *Resumo:* !sega abre o menu. Cadastro: privado do dono. Stats: no Geral ou privado do dono. Conhecimento e zoeiras: SEGA Geral.'
  ];
}

function activeRegistrationJids() {
  const now = Date.now();
  return new Set([...registrations].filter(([, state]) =>
    Number.isFinite(Date.parse(state?.updatedAt || '')) &&
    now - Date.parse(state.updatedAt) < REGISTRATION_TTL_MS
  ).map(([jid]) => jid));
}
function canHandleRegistrationMessage(message) {
  return shouldProcessRegistrationPrivateMessage(message, ownerAccountJids,
    activeRegistrationJids(), messageText);
}
async function handleRegistration(sock, message) {
  const key = message.key || {};
  const jid = key.remoteJid;
  // An explicit !cadastrar starts a narrowly scoped private registration.
  // Unrelated conversations still never reach this handler.
  if (!enabled || !canHandleRegistrationMessage(message)) return false;
  const ownerPrivate = shouldProcessPrivateMessage(message, ownerAccountJids);
  if (!jid || jid.endsWith('@g.us') || botSentMessageIds.has(key.id)) return false;
  const text = messageText(message.message);
  if (!text) return false;
  let command = text.toLowerCase();
  const menuUntil = menuSessions.get(jid) || 0;
  if (menuUntil > Date.now() && /^[1-5]$/.test(command) && !registrations.has(jid)) {
    menuSessions.delete(jid);
    command = { '1':'!stats', '2':'!ranking', '3':'!highlights', '4':'!cadastrar', '5':'!ajuda' }[command];
  } else if (menuUntil && menuUntil <= Date.now()) menuSessions.delete(jid);

  if (ownerPrivate && ['!grupos','/grupos'].includes(command)) {
    // Explicit owner-only group discovery: names and IDs, no group chat content.
    try {
      const groups = await sock.groupFetchAllParticipating();
      const matches = Object.values(groups || {})
        .filter(group => /sega|mega\s*drive/i.test(String(group?.subject || '')))
        .slice(0, 16);
      if (!matches.length) {
        await sendText(sock, jid, '🔎 Não encontrei grupos SEGA nesta conta. Confira se a comunidade está neste mesmo WhatsApp.');
      } else {
        const lines = ['🔐 *GRUPOS SEGA — SOMENTE PARA O DONO*', '', 'Copie o ID do 🎮 SEGA Geral e envie no ChatGPT.', ''];
        for (const group of matches) {
          const label = group.isCommunityAnnounce ? ' 📢 *(AVISOS OFICIAIS)*'
            : group.isCommunity ? ' 🏠 *(COMUNIDADE)*'
            : group.id === targetGroup ? ' 🎮 *(GERAL)*' : '';
          lines.push('• *' + String(group.subject).slice(0, 95) + '*' + label, 'ID: ' + group.id, '');
        }
        await sendText(sock, jid, lines.join('\n'));
      }
    } catch (error) {
      console.error('Falha na lista de grupos do dono:', error?.message);
      await sendText(sock, jid, '⚠️ Não consegui listar os grupos agora. Tente !grupos novamente.');
    }
    return true;
  }
  if (ownerPrivate && ['!sega','/sega'].includes(command)) {
    await sendSegaMenu(sock, jid);
    return true;
  }
  if (ownerPrivate && command === '!ajuda') {
    await sendText(sock, jid, fullHelpLines().join('\n'));
    return true;
  }
  if (ownerPrivate && ['!stats','/stats'].includes(command)) {
    const p = key.fromMe ? (players.get('self') || findPlayer(aliasesFor(key))) : findPlayer(aliasesFor(key));
    await sendPlayerStats(sock,jid,p);
    return true;
  }
  if (ownerPrivate && ['!ranking','/ranking'].includes(command)) {
    await sendSavedRanking(sock,jid);
    return true;
  }
  if (ownerPrivate && ['!highlights', '/highlights'].includes(command)) {
    await sendHighlights(sock, jid);
    return true;
  }

  if (['!cancelar','/cancelar','cancelar'].includes(command)) {
    await deleteRegistration(jid);
    await sendText(sock, jid, '❌ Cadastro cancelado. Quando quiser recomeçar, envie !cadastrar.');
    return true;
  }
  if (ownerPrivate && ['!meunick','/meunick','meunick'].includes(command)) {
    const p = findPlayer(aliasesFor(key));
    await sendText(sock, jid, p ? '🎮 Seu nick verificado é: ' + p.name : 'Você ainda não está cadastrado. Envie !cadastrar.');
    return true;
  }
  if (['!cadastrar','/cadastrar','cadastrar'].includes(command)) {
    await setRegistration(jid, { step: 'role_id' });
    await sendText(sock, jid, '📝 CADASTRO SEGA\n\nMe envie somente o Role ID do Mobile Legends.\nExemplo: 123456789');
    return true;
  }

  if (ownerPrivate && /^[!/]battle(?:\s+.*)?$/i.test(command)) {
    await sendText(sock, jid, 'ℹ️ O Battle ID foi desativado. Use !stats para consultar seus dados do jogo.');
    return true;
  }

  const state = registrations.get(jid);
  if (!state) {
    if (!ownerPrivate) return false;
    const parsed = ownerKnowledgeQuestion(text);
    if (!parsed) return false;
    try {
      const answer = await answerMlbbQuestion(parsed.question);
      if (!answer && !parsed.prefixed) return false;
      const plain = answer
        ? answer.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/\\n/g, '\n')
        : '🧠 Ainda não entendi essa pergunta sobre Mobile Legends. Ex.: SEGA, quem mata Harley?';
      await sendText(sock, jid, plain);
    } catch (error) {
      console.error('Falha ao responder conhecimento no autochat:', error?.message);
      await sendText(sock, jid, '⚠️ Não consegui consultar o conhecimento agora. Tente novamente em alguns segundos.');
    }
    return true;
  }

  if (state.step === 'role_id') {
    if (!/^\d{6,12}$/.test(text)) { await sendText(sock, jid, '⚠️ Role ID inválido. Envie somente os números.'); return true; }
    await setRegistration(jid, { step: 'zone_id', roleId: text });
    await sendText(sock, jid, '🌐 Agora envie somente o Zone ID.\nExemplo: 1234');
    return true;
  }

  if (state.step === 'zone_id') {
    if (!/^\d{1,8}$/.test(text)) { await sendText(sock, jid, '⚠️ Zone ID inválido. Envie somente os números.'); return true; }
    const roleId = state.roleId;
    await sendText(sock, jid, '🔎 Solicitando o código de verificação... Ele chegará no correio interno do Mobile Legends e vale por 5 minutos.');
    try {
      const response = await apiFetch('/user/auth/send-vc', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role_id: Number(roleId), zone_id: Number(text) })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !isApiSuccess(body)) {
        await setRegistration(jid, { step: 'zone_id', roleId });
        const detail = apiErrorMessage(body);
        await sendText(sock, jid, response.status === 429 ? '⏳ Muitas solicitações. Aguarde um pouco e envie o Zone ID novamente.' : '⚠️ Não consegui solicitar o código. Confira ID e zona e tente novamente.' + (detail ? '\nMotivo: ' + String(detail).slice(0,150) : ''));
        return true;
      }
      await setRegistration(jid, { step: 'verification_code', roleId, zoneId: text });
      await sendText(sock, jid, '🔐 Código solicitado. Confira o correio do jogo e envie aqui somente o código recebido.\n\nNunca envie senha ou código de outra plataforma.');
    } catch (e) {
      await setRegistration(jid, { step: 'zone_id', roleId });
      await sendText(sock, jid, '⚠️ O serviço de autenticação não respondeu. Envie o Zone ID novamente em alguns instantes.');
    }
    return true;
  }

  if (state.step === 'verification_code') {
    if (!/^\d{4,8}$/.test(text)) { await sendText(sock, jid, '⚠️ Código inválido. Envie somente os números recebidos no correio do jogo.'); return true; }
    const { roleId, zoneId } = state;
    await sendText(sock, jid, '🔐 Validando o código...');
    try {
      const response = await apiFetch('/user/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role_id: Number(roleId), zone_id: Number(zoneId), vc: Number(text) })
      });
      const body = await response.json().catch(() => ({}));
      const jwt = body?.data?.jwt || body?.data?.token || null;
      if (!response.ok || !isApiSuccess(body) || !jwt) {
        await sendText(sock, jid, '❌ Código não validado. Confira se está correto e dentro dos 5 minutos, ou envie !cancelar.');
        return true;
      }
      const info = await apiFetch('/user/info?lang=pt', { headers: { Authorization: 'Bearer ' + jwt } });
      const infoBody = await info.json().catch(() => ({}));
      const name = info.ok && isApiSuccess(infoBody) ? profileName(infoBody?.data) : null;
      if (!name) { await sendText(sock, jid, '⚠️ Login aceito, mas não consegui confirmar seu perfil agora. Tente o código novamente em instantes.'); return true; }
      const player = { jwt, roleId, zoneId, name, nameVerified: true, savedAt: new Date().toISOString() };
      for (const alias of aliasesFor(key)) players.set(alias, player);
      players.set(jid, player);
      if (key.fromMe) players.set('self', player);
      await savePlayers();
      await deleteRegistration(jid);
      await sendText(sock, jid, '✅ CONTA VERIFICADA!\n\n🎮 Nick confirmado: ' + name + '\n🆔 ID: ' + roleId + '\n🌐 Zone: ' + zoneId + '\n\nSeu WhatsApp agora está vinculado ao SEGA Stats.');
    } catch (e) {
      console.error('Falha ao autenticar jogador WhatsApp:', e?.message);
      await sendText(sock, jid, '⚠️ Erro de conexão ao validar o código. Tente novamente em alguns segundos.');
    }
    return true;
  }
  return false;
}

const geekTemplates = [
  '{nick} saiu do modo AFK e resolveu digitar:',
  '⚠️ Evento raro: {nick} teve uma ideia e decidiu compartilhar:',
  '{nick} reiniciou o cérebro em modo seguro e mandou:',
  '🤖 {nick} passou no CAPTCHA. Provavelmente não é bot. Disse:',
  '{nick} encontrou o teclado depois de 15 minutos e escreveu:',
  '📡 Sinal detectado de {nick}. A transmissão diz:',
  '{nick} compilou o pensamento sem erros. Resultado:',
  '🎮 {nick} apertou o botão de falar em vez do recall:',
  '{nick} desbloqueou a habilidade passiva “mandar mensagem”:',
  '🧠 CPU de {nick} chegou a 12% de uso. Saiu isso:',
  '{nick} voltou do respawn social e declarou:',
  '👾 {nick} escapou da matrix por alguns segundos para dizer:',
  '{nick} atualizou o firmware e agora aparentemente fala:',
  '🕹️ NPC {nick} recebeu uma nova linha de diálogo:',
  '🚨 Alerta no servidor: {nick} resolveu se manifestar:',
  '{nick} gastou 3 de mana para escrever:',
  '💾 {nick} carregou um pensamento do HD. Lá vem:',
  '{nick} ativou o modo multiplayer e digitou:',
  '🔧 Depois de uma manutenção não programada, {nick} disse:',
  '{nick} venceu o boss “preguiça de digitar” e mandou:',
  '🤖 Diagnóstico: {nick} é 51% humano. Mensagem encontrada:',
  '{nick} descongelou depois de 15 minutos. Primeiras palavras:',
  '📟 O servidor recebeu um pacote suspeito de {nick}:',
  '{nick} saiu do modo economia de energia para escrever:',
  '🎲 {nick} rolou um D20 para comunicação. Resultado:',
  '{nick} abriu uma side quest chamada “conversar no grupo”:',
  '🧙 {nick} conjurou Mensagem Nv. 1:',
  '{nick} aparentemente tem internet. Evidência:',
  '👽 Interceptamos uma transmissão de {nick}:',
  '{nick} terminou de renderizar a frase. Finalmente:',
  '⚙️ Processando {nick}... 100%. Saída:',
  '{nick} não é bot, segundo fontes extremamente duvidosas. Disse:',
  '🏆 Achievement desbloqueado por {nick}: falar no grupo. Mensagem:',
  '{nick} acordou o servidor com:',
  '📢 Patch notes: {nick} agora suporta comunicação por texto:',
  '{nick} usou Comunicação. Foi super efetivo:',
  '🐛 Encontramos um bug: {nick} está falando:',
  '{nick} saiu da moita e digitou:',
  '🔋 Bateria social de {nick}: 1%. Mesmo assim mandou:',
  '{nick} terminou o tutorial de WhatsApp e escreveu:',
  '🛰️ Telemetria confirma atividade de {nick}:',
  '{nick} spawnou no chat e soltou:',
  '💻 localhost/{nick}/pensamento retornou 200 OK:',
  '{nick} passou pela tela de loading e disse:',
  '🧪 Experimento concluído: {nick} consegue escrever. Prova:',
  '{nick} desativou o modo avião mental por alguns segundos:',
  '🎯 {nick} errou tudo no jogo, mas acertou o botão de enviar:',
  '{nick} pediu buff de comunicação e recebeu:',
  '🤖 beep boop... {nick} insiste que é humano. Mensagem:',
  '{nick} fez login no próprio cérebro e escreveu:',
  '🧬 Cientistas confirmam: {nick} possui pelo menos um neurônio online. Ele disse:',
  '{nick} interrompeu a farm para um pronunciamento histórico:',
  '📦 Novo pacote recebido de {nick}:',
  '{nick} ativou o chat global. Que Deus nos ajude:',
  '🎮 {nick} parou de culpar o ping por 3 segundos para dizer:',
  '{nick} saiu do lobby da existência e entrou no chat:',
  '🛠️ Sistema de fala de {nick} restaurado com sucesso:',
  '{nick} encontrou Wi-Fi na caverna e mandou:',
  '👨‍💻 git commit -m “{nick} resolveu falar”:',
  '{nick} executou sudo falar-no-grupo:',
  '🧠 RAM liberada em {nick}. Uma frase conseguiu sair:',
  '{nick} atualizou de NPC para NPC Premium e ganhou uma fala:',
  '🚀 Houston, temos uma mensagem de {nick}:',
  '{nick} zerou a missão “ficar quieto” e iniciou outra:',
  '🤓 Segundo meus cálculos, {nick} está tentando se comunicar:',
  '{nick} venceu o cooldown social. Próxima habilidade:',
  '📱 Até o WhatsApp ficou surpreso: {nick} escreveu:',
  '{nick} voltou do multiverso com esta informação:',
  '🦾 Protocolo {nick}.exe iniciado. Output:',
  '{nick} desbloqueou diálogo secreto:',
  '⚡ Pico de atividade detectado em {nick}:',
  '{nick} apertou Enter sem querer e aconteceu isso:',
  '🎰 Giramos a roleta do chat e caiu em {nick}:',
  '{nick} finalmente saiu do tutorial. Fala desbloqueada:',
  '🧟 {nick} voltou dos mortos digitais para dizer:',
  '{nick} mandou um pacote UDP: pode chegar sem sentido:',
  '🔮 A bola de cristal previu que {nick} falaria. Acertou:',
  '{nick} trocou XP por uma frase:',
  '🛸 O radar do SEGA detectou {nick} se aproximando do chat:',
  '{nick} saiu do modo espectador e participou:',
  '🏴‍☠️ {nick} pirateou alguns neurônios e produziu:',
  '{nick} tem algo a dizer. O servidor pediu desculpas antecipadamente:',
  '🎮 Quest atualizada: ouvir o que {nick} inventou agora:',
  '{nick} ativou o microfone textual:',
  '🤖 CAPTCHA aprovado. {nick} pode continuar fingindo que é humano:',
  '{nick} abriu uma exceção no silêncio:',
  '🧩 Encontramos a peça que faltava: era {nick} falando:',
  '{nick} enviou isso antes que o cérebro pudesse cancelar:',
  '💿 Inserindo disco “Opiniões de {nick}”... leitura iniciada:',
  '{nick} deu alt-tab na vida real e veio para o grupo:',
  '🧠 Neurônio 1 chamou neurônio 2. {nick} conseguiu escrever:',
  '{nick} aparentemente sobreviveu ao último match. Relatório:',
  '🎤 Senhoras e senhores, infelizmente {nick} está com a palavra:',
  '{nick} ativou a ultimate: Opinião Não Solicitada:',
  '📶 {nick} pegou duas barrinhas de sinal e aproveitou:',
  '{nick} saiu do cooldown. Lá vem:',
  '🗿 Após eras em silêncio, {nick} pronunciou:',
  '{nick} clicou em “aceito os termos” sem ler e agora pode falar:',
  '👾 Boss secreto {nick} iniciou diálogo:',
  '{nick} descobriu que o grupo não é modo somente leitura:',
  '🔌 Conectamos {nick} na tomada. Funcionou:',
  '{nick} instalou o DLC “Comunicação” e mandou:',
  '🎮 O matchmaking colocou {nick} contra o português. Resultado:',
  '{nick} foi promovido de bot para beta tester humano. Disse:'
];

const recentGeekIndexes = [];
function geekLine(nick) {
  // Escolha realmente aleatória. Mantém uma janela das últimas frases usadas
  // para não repetir a mesma abertura em sequência, nem entre jogadores.
  const blocked = new Set(recentGeekIndexes);
  const available = geekTemplates
    .map((_, index) => index)
    .filter(index => !blocked.has(index));
  const pool = available.length ? available : geekTemplates.map((_, index) => index);
  const index = pool[crypto.randomBytes(4).readUInt32BE(0) % pool.length];
  recentGeekIndexes.push(index);
  if (recentGeekIndexes.length > Math.min(25, Math.max(1, geekTemplates.length - 1))) recentGeekIndexes.shift();
  const prefixes = ['', '🎮 ', '⚡ ', '👾 ', '🤖 ', '🕹️ ', '💾 '];
  const prefix = prefixes[crypto.randomBytes(4).readUInt32BE(0) % prefixes.length];
  return prefix + geekTemplates[index].replaceAll('{nick}', nick);
}

const mentionRoasts = [
  '{target}, cê tá de ladaia pro lado do {author}? 😂',
  '{target}, o {author} te marcou. Eu no seu lugar fingia queda de internet. 👀',
  '🚨 {target}, atenção: {author} invocou você. Geralmente boss aparece depois disso.',
  '{target}, {author} te chamou. Não sei o motivo, mas já separa um advogado. 😂',
  '📡 {target}, detectei uma tentativa de contato de {author}. Deseja bloquear ou sofrer?',
  '{target}, olha quem lembrou de você: {author}. Meus pêsames. 🤖',
  '⚠️ {target}, {author} te marcou. A treta recebeu atualização de firmware.',
  '{target}, corre que {author} tá te procurando. Eu não vi nada. 🏃',
  '🎮 {target}, missão secundária desbloqueada: responder {author} sem perder a amizade.',
  '{target}, {author} solicitou sua presença. O RH do clã já foi avisado. 😂',
  '👾 {target}, você foi summonado por {author}. Cooldown para fugir: zero.',
  '{target}, {author} te marcou e o clima ficou igual lobby depois de derrota. 👀',
  '🤖 {target}, protocolo de emergência: {author} quer falar com você.',
  '{target}, se eu fosse você não respondia {author} sem salvar o jogo antes. 😂',
  '🧠 {target}, {author} gastou o último neurônio disponível pra te marcar. Valorize.',
  '{target}, parabéns: {author} selecionou você como próximo problema do dia. 🏆',
  '📢 {target}, compareça ao chat. {author} abriu um chamado e não informou a gravidade.',
  '{target}, {author} está te chamando. Minha análise técnica recomenda cautela e capacete.',
  '🕹️ {target}, NPC {author} iniciou diálogo com você. Pular cutscene?',
  '{target}, o radar detectou {author} na sua cola. Boa sorte, soldado. 🫡',
  '💀 {target}, {author} te marcou. Foi bom conhecer você.',
  '{target}, {author} quer sua atenção. Isso nunca termina em coisa produtiva. 😂',
  '🚨 {target}, ameaça detectada: uma notificação de {author}. Nível de perigo: fofoca.',
  '{target}, {author} te convocou. O tribunal do SEGA está oficialmente em sessão. ⚖️',
  '👀 {target}, eu vi {author} te marcando. Não vou me meter... ainda.',
  '{target}, {author} usou “Marcar Jogador”. Foi super efetivo. 🎮',
  '🧙 {target}, {author} lançou Invocação Nv. 5. Você apareceu contra a sua vontade.',
  '{target}, cuidado: {author} digitou seu nome com intenção. Isso é preocupante. 😂',
  '📞 {target}, ligação a cobrar de {author}. Para aceitar, responda e arque com as consequências.',
  '{target}, {author} te chamou. Backup feito? Testamento atualizado? Então pode responder. 💀',
  '🤡 {target}, {author} pediu sua presença no circo. Seu camarim já está pronto.',
  '{target}, aparentemente {author} precisa de você. Ou de terapia. Ainda estou calculando. 🤖',
  '⚔️ {target}, duelo solicitado por {author}. Recusar custa 10 pontos de honra imaginários.',
  '{target}, {author} te marcou. O algoritmo classificou como “potencialmente suspeito”.',
  '🛸 {target}, transmissão alienígena interceptada: {author} está tentando contato.',
  '{target}, {author} acabou de puxar sua ficha no chat. Recomendo silêncio estratégico. 😂',
  '📦 {target}, chegou uma encomenda de {author}: contém cobrança e possível resenha.',
  '{target}, {author} ativou sua passiva “encher o saco dos outros”. Você foi o escolhido. 😂',
  '🔮 {target}, consultei a bola de cristal: responder {author} pode gerar 37 mensagens adicionais.',
  '{target}, {author} abriu uma side quest envolvendo você. Recompensa: absolutamente nada.',
  '🧯 {target}, {author} te marcou. Extintor localizado à esquerda caso a conversa esquente.',
  '{target}, aviso do sistema: {author} está solicitando atenção humana. Isso é raro.',
  '🎲 {target}, {author} rolou um D20 e caiu em “perturbar {target}”.',
  '{target}, {author} chamou. Você tem 5 segundos antes que ele mande “??”. 😂',
  '🧟 {target}, levanta daí: {author} invocou você dos mortos digitais.',
  '{target}, {author} quer falar contigo. O SEGA Stats não se responsabiliza por danos emocionais.',
  '🔋 {target}, economize bateria: talvez responder {author} não valha os elétrons.',
  '{target}, {author} te encontrou no mapa. Bush não funciona mais. 🌿',
  '🏴‍☠️ {target}, {author} embarcou no navio da resenha e te colocou na tripulação.',
  '{target}, {author} iniciou uma reunião que poderia ter sido absolutamente nada. 😂',
  '{target}, {author} te marcou. Até o bot sentiu cheiro de merda vindo dessa conversa. 💩',
  '{target}, responde o {author} logo antes que ele comece a pensar sozinho e piore tudo. 😂',
  '🚑 {target}, {author} chamou você. A ambulância foi avisada por precaução.',
  '{target}, {author} quer falar contigo. Se vier ideia boa, confirma se a conta dele foi hackeada.',
  '💀 {target}, {author} te marcou. Mais uma decisão ruim pra coleção de vocês.',
  '{target}, cuidado: {author} está tentando formar uma frase completa. Você pode ser testemunha desse milagre.',
  '🤡 {target}, o palhaço {author} pediu reforço. O circo agora tem elenco completo.',
  '{target}, {author} te chamou pra reunião dos dois neurônios restantes do clã. Compareça.',
  '⚠️ {target}, não faça movimentos bruscos. {author} aparentemente está tentando raciocinar.',
  '{target}, {author} quer sua opinião. Considerando o histórico de vocês, estamos oficialmente fodidos. 😂',
  '🪦 {target}, {author} te marcou. Já reservei duas vagas no cemitério da dignidade.',
  '{target}, {author} chamou. Talvez seja importante. KKKKK desculpa, nem eu consegui escrever isso sério.',
  '🧠 {target}, empresta um neurônio pro {author}. O dele está claramente em manutenção.',
  '{target}, {author} quer conversar. Minha recomendação profissional: não alimente o animal.',
  '🚨 {target}, {author} está solto no grupo novamente. Contenção falhou.',
  '{target}, o {author} te chamou. Se a conversa ficar inteligente eu reinicio o bot porque claramente deu bug.',
  '🎪 {target}, {author} abriu o circo e você acaba de ser anunciado como atração principal.',
  '{target}, {author} marcou você. O nível intelectual médio da conversa caiu antes mesmo da resposta.',
  '☠️ {target}, {author} quer papo. Não aceite bebida nem conselho financeiro dele.',
  '{target}, atende o {author}. Ele está carente e o CAPS do Land of Dawn fechou cedo. 😂',
  '🧯 {target}, {author} está cozinhando alguma merda. Trouxe o extintor?',
  '{target}, {author} te convocou. O prêmio por responder é ganhar outra mensagem dele.',
  '🤖 {target}, análise concluída: ignorar {author} aumenta sua expectativa de vida em 14%.',
  '{target}, {author} te marcou porque aparentemente tomar decisão ruim sozinho perdeu a graça.',
  '🗑️ {target}, chegou uma notificação de {author}. O WhatsApp ainda não implementou coleta seletiva.',
  '{target}, {author} precisa de ajuda. De novo. Finja surpresa.',
  '🎮 {target}, missão lendária: descobrir que porra {author} quer sem perder sanidade.',
  '{target}, {author} chamou. Coloque o cérebro no modo avião pra vocês conversarem de igual pra igual. 😂',
  '👻 {target}, finge que não viu. Talvez {author} ache que você morreu e desista.',
  '{target}, {author} te marcou. Eu poderia explicar o motivo, mas nem inteligência artificial faz milagre.',
  '🧪 {target}, você foi selecionado para um experimento: medir quanto tempo alguém aguenta conversar com {author}.',
  '{target}, {author} pediu sua atenção. Meus servidores calcularam 98% de chance de ser bobagem.',
  '💣 {target}, {author} lançou a granada e marcou você. Agora segura essa merda. 😂',
  '{target}, o {author} está te procurando. Eu entregaria ele pros creeps e seguiria a partida.',
  '🦧 {target}, {author} chamou. Tradutor de primata ativado, pode responder.',
  '{target}, {author} digitou seu nome sem errar. Já é a maior conquista dele hoje. 🏆',
  '🚽 {target}, {author} trouxe uma ideia. Pela qualidade prevista, provavelmente veio sentado no vaso.',
  '{target}, {author} quer discutir. Dois idosos brigando por WhatsApp: o futuro chegou. 😂',
  '📉 {target}, desde que {author} te marcou o QI do servidor caiu 12 pontos.',
  '{target}, {author} te convocou. Não esquece de falar devagar e usar desenhos.',
  '🧟 {target}, responde o {author}; ele está vagando pelo chat atrás de atividade cerebral.',
  '{target}, {author} te marcou. É assim que começam documentários sobre decisões catastróficas.',
  '🤦 {target}, o {author} teve uma ideia e, em vez de guardar pra si, resolveu te envolver.',
  '{target}, {author} está pedindo atenção. Alguém esqueceu o portão do hospício do Land of Dawn aberto.',
  '⚰️ {target}, {author} chamou. Se for duo rankeada, meus sentimentos antecipados.',
  '{target}, {author} quer você no chat. A dignidade é opcional; aparentemente vocês já decidiram isso.',
  '🔥 {target}, {author} te marcou. O incêndio ainda não começou, mas trouxe gasolina por garantia.',
  '{target}, {author} solicitou suporte técnico. Erro identificado entre a cadeira e o celular.',
  '🧠 {target}, cuidado ao responder {author}: burrice em grupo pode ser contagiosa.',
  '{target}, {author} chamou. Não sei quem está mais ferrado: quem perguntou ou quem vai responder.',
  '{target}, o {author} te marcou porque passar vergonha sozinho já não tava sendo suficiente. 😂',
  '🧠 {target}, o {author} pediu ajuda. Parece que o neurônio da firma entrou de férias.',
  '{target}, responde o {author}. Ele já tentou pensar sozinho e olha no que deu. 💀',
  '🚨 {target}, o {author} te convocou. A comissão de decisões ruins atingiu o quórum.',
  '{target}, {author} te marcou. Dois adultos, zero supervisão e nenhuma perspectiva de dar certo. 😂',
  '🤡 {target}, seu parceiro {author} abriu o circo. Falta só você entrar no picadeiro.',
  '{target}, {author} pediu reforço. Pelo histórico, reforço de inteligência seria mais útil. 🧠',
  '⚰️ {target}, {author} te chamou. A dignidade de vocês pediu pra não ser envolvida.',
  '{target}, o {author} tá te procurando. Até agora ninguém conseguiu explicar por quê e nem vale a pena investigar.',
  '📉 {target}, {author} te marcou e o QI médio do grupo pediu transferência. 😂',
  '{target}, vem buscar o {author}. Ele escapou da supervisão de novo.',
  '💀 {target}, o {author} te chamou. Se sair alguma ideia boa daí, eu mesmo peço desculpa.',
  '{target}, {author} quer conversar. O bom senso viu a notificação e saiu do grupo.',
  '🧯 {target}, corre aqui: {author} teve uma ideia. Já chamei os bombeiros.',
  '{target}, {author} te marcou. É tipo dupla de ranked: separados já dá medo, juntos dá denúncia. 😂',
  '🚑 {target}, atende o {author}. Não é emergência, ele é assim mesmo.',
  '{target}, o {author} pediu sua opinião. Finalmente alguém encontrou um jeito de piorar a situação.',
  '🎪 {target}, {author} te chamou pra reunião executiva da firma Dois Neurônios Ltda.',
  '{target}, {author} marcou você. A ciência ainda não sabe por quê, mas já desistiu de descobrir.',
  '☠️ {target}, responde o {author} antes que ele tente resolver sozinho e vire ocorrência.',
  '{target}, o {author} te marcou. Se burrice desse dano crítico, vocês dois já tinham levado Savage. 💀',
  '🧠 {target}, atende o {author}. O último neurônio dele pediu demissão e deixou você como contato de emergência.',
  '{target}, {author} quer sua ajuda. É tipo dois cegos procurando Wi-Fi no escuro. 😂',
  '🚨 {target}, o {author} te chamou. Já avisei a defesa civil porque ideia dele costuma virar calamidade.',
  '{target}, responde o {author}. Ele tá há cinco minutos tentando pensar e o celular já começou a esquentar.',
  '🤡 {target}, {author} te marcou. Parabéns, a dupla sertaneja Falta de Noção & Ausência de Vergonha voltou.',
  '{target}, o {author} pediu reforço. Manda um cérebro pelo Sedex porque conversa não vai resolver. 🧠',
  '⚰️ {target}, se o {author} chamou pra ranked, atualiza o testamento antes de responder.',
  '{target}, {author} te marcou. O algoritmo classificou isso como tentativa de homicídio da inteligência coletiva.',
  '🗑️ {target}, chegou mensagem do {author}. O filtro de spam pediu demissão por excesso de trabalho.',
  '{target}, responde aí. O {author} tá sozinho com uma ideia e isso representa risco pra sociedade. 😂',
  '💀 {target}, {author} te convocou. Juntos vocês têm aproximadamente meio plano e três decisões ruins.',
  '🧯 {target}, vem rápido: {author} começou a raciocinar sem equipamento de proteção.',
  '{target}, o {author} te chamou. Se sair algo inteligente dessa conversa, vou abrir chamado de incidente.',
  '🐒 {target}, {author} mandou sinal. Ainda estamos traduzindo do primata para português.',
  '{target}, atende o {author}. O hospício do Land of Dawn confirmou que hoje é dia de visita. 😂',
  '📉 {target}, desde que {author} te marcou, o grupo perdeu pontos de QI que nem tinha.',
  '{target}, {author} precisa de você. Aparentemente fazer merda sozinho já não oferece desafio suficiente.',
  '🚑 {target}, responde o {author}. Não é urgência médica, mas o bom senso dele segue desaparecido.',
  '{target}, o {author} chamou. Dois especialistas em decisão ruim entrando numa conversa: o que poderia dar errado? Tudo. 😂',
  '🎪 {target}, {author} abriu mais uma sessão extraordinária do Conselho Federal dos Sem Noção.',
  '{target}, {author} te marcou. A dignidade viu os dois online e ativou o modo avião.',
  '☠️ {target}, responde logo o {author}; cada minuto sem supervisão aumenta a chance dele inventar outra merda.',
  '{target}, {author} pediu sua opinião. É bonito ver gente sem solução trabalhando em equipe. 😂',
  '🧠 {target}, traz giz de cera. O {author} vai tentar explicar uma ideia e palavras talvez sejam avançadas demais.',
  '{target}, {author} te chamou. A conversa ainda nem começou e já tem cheiro de boletim de ocorrência.',
  '🤡 {target}, o {author} pediu ajuda. O circo está completo; só faltava o especialista.',
  '{target}, responde o {author}. Ele tá tentando conectar dois pensamentos e o servidor entrou em timeout. 💀',
  '🔥 {target}, {author} teve uma ideia. Eu esconderia os fósforos antes de perguntar qual.',
  '{target}, {author} te marcou. Isso não é uma conversa, é um teste de resistência psicológica. 😂',
];

function mentionIds(message) {
  if (!message) return [];
  const ids = [];
  const seen = new Set();

  // Baileys/WhatsApp can place contextInfo in different message wrappers.
  const visit = (value) => {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    const mentioned = value?.contextInfo?.mentionedJid;
    if (Array.isArray(mentioned)) ids.push(...mentioned);
    for (const child of Object.values(value)) visit(child);
  };
  visit(message);

  return [...new Set(ids.filter(Boolean))];
}
function jidAliases(jid) {
  const raw = String(jid || '');
  if (!raw) return [];
  const user = raw.split('@')[0];
  const bare = user.split(':')[0];
  const domains = ['@s.whatsapp.net', '@lid'];
  return [...new Set([raw, ...domains.map(domain => bare + domain)])];
}
function rememberGroupName(jid, name) {
  if (!name || /^\d{8,}$/.test(String(name).replace(/\D/g, ''))) return;
  for (const alias of linkedAliases(jid)) groupNames.set(alias, name);
}
function playerForJid(jid) {
  for (const alias of linkedAliases(jid)) {
    const player = players.get(alias);
    if (player?.name) return player;
  }
  return null;
}
function whatsappName(jid, fallback = 'jogador') {
  for (const alias of linkedAliases(jid)) {
    const name = groupNames.get(alias);
    if (name) return name;
  }
  return fallback;
}
function displayPlayer(jid, fallback = 'jogador') {
  return playerForJid(jid)?.name || (jidAliases(jid).includes(ownJid) ? players.get('self')?.name : null) || whatsappName(jid, fallback);
}
function participantJids(participant) {
  return [...new Set([
    participant?.id,
    participant?.jid,
    participant?.lid,
    participant?.phoneNumber,
    participant?.phoneNumberJid
  ].filter(Boolean).flatMap(jidAliases))];
}
async function warmGroupParticipantNames(sock, groupJid) {
  try {
    const metadata = await sock.groupMetadata(groupJid);
    for (const participant of metadata?.participants || []) {
      const aliases = participantJids(participant);
      linkIdentities(aliases);
      if (aliases.length) {
        console.log('[mention-participant-debug]', JSON.stringify({
          aliasDomains: aliases.map(jid => String(jid).split('@')[1] || 'unknown'),
          fields: Object.keys(participant || {}).sort(),
          hasNotify: Boolean(participant?.notify),
          hasName: Boolean(participant?.name),
          hasVerifiedName: Boolean(participant?.verifiedName),
          usernameType: typeof participant?.username,
          usernameValue: participant?.username == null ? null : String(participant.username).slice(0, 80)
        }));
      }
      const knownPlayer = aliases.map(playerForJid).find(Boolean);
      if (knownPlayer?.name) {
        for (const alias of aliases) rememberGroupName(alias, knownPlayer.name);
        continue;
      }
      const name = participant?.notify || participant?.name || participant?.verifiedName || participant?.username;
      if (name) for (const alias of aliases) rememberGroupName(alias, name);
    }
  } catch (error) {
    console.warn('Não consegui aquecer nomes do grupo:', error?.message);
  }
}
function registrationLink() {
  const phone = pairPhone || String(ownJid || '').split('@')[0].split(':')[0].replace(/\D/g, '');
  return phone ? 'https://wa.me/' + phone + '?text=' + encodeURIComponent('!cadastrar') : null;
}
let lastRoastIndex = -1;
function roastFor(author, target, key) {
  const entropy = crypto.randomBytes(4).readUInt32BE(0);
  let index = entropy % mentionRoasts.length;
  if (mentionRoasts.length > 1 && index === lastRoastIndex) index = (index + 1 + (entropy % (mentionRoasts.length - 1))) % mentionRoasts.length;
  lastRoastIndex = index;
  return mentionRoasts[index].replaceAll('{author}', author).replaceAll('{target}', target);
}

async function handleGroup(sock, message) {
  const key = message.key || {};
  const groupJid = key.remoteJid;
  if (!enabled || !groupJid?.endsWith('@g.us') || groupJid !== targetGroup || !message.message) return;
  // Never interpret a message that this bridge itself sent as a new command.
  if (botSentMessageIds.has(key.id)) return;
  let text = messageText(message.message);
  const menuKey = groupJid + ':' + (key.participant || key.participantAlt || key.remoteJid);
  const until = menuSessions.get(menuKey) || 0;
  if (until > Date.now() && /^[1-5]$/.test(text)) {
    menuSessions.delete(menuKey);
    text = { '1':'!stats', '2':'!ranking', '3':'!highlights', '4':'!cadastrar', '5':'!ajuda' }[text];
  } else if (until && until <= Date.now()) menuSessions.delete(menuKey);
  const aliases = aliasesFor(key);
  linkIdentities([key.participant, key.participantAlt].filter(Boolean));
  if (key.pushName) for (const alias of aliases) rememberGroupName(alias, key.pushName);
  const mentionedNow = mentionIds(message.message);
  const earlyKnowledge = segaKnowledgeQuery(text);
  if (earlyKnowledge.textual) {
    const question = earlyKnowledge.cleaned.replace(/@\d{5,}/g, '').trim();
    console.log('[sega-knowledge-hit]', JSON.stringify({ fromMe: Boolean(key.fromMe), question: question.slice(0, 120) }));
    if (!question) {
      await sendText(sock, groupJid, '🎮 Tô na escuta. Ex.: @SEGA quem countera Harley?\nDigite !ajuda para ver mais exemplos.');
      return;
    }
    try {
      const answer = await answerMlbbQuestion(question);
      const plain = answer
        ? answer.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/\\n/g, '\n')
        : '🧠 Ainda não entendi essa pergunta. Exemplos:\n' + listKnowledgeExamples().slice(0, 8).map(x => '• @SEGA ' + x).join('\n');
      await sendText(sock, groupJid, plain);
    } catch (error) {
      console.error('Falha no conhecimento WhatsApp:', error?.message);
      await sendText(sock, groupJid, '⚠️ Não consegui consultar o conhecimento agora. Tente novamente em alguns segundos.');
    }
    return;
  }
  for (const lid of mentionedNow.filter(jid => String(jid).endsWith('@lid'))) {
    try {
      const pn = await sock.signalRepository?.lidMapping?.getPNForLID(lid);
      if (pn) linkIdentities([lid, pn]);
    } catch (error) { console.warn('LID mapping unavailable:', error?.message); }
  }
  if (mentionedNow.length) {
    const maskJid = (jid) => {
      const raw = String(jid || '');
      const [user = '', domain = ''] = raw.split('@');
      return (user.length > 4 ? '***' + user.slice(-4) : '***') + (domain ? '@' + domain : '');
    };
    console.log('[mention-debug]', JSON.stringify({
      authorHasPushName: Boolean(key.pushName),
      authorDomains: aliases.map(jid => String(jid).split('@')[1] || 'unknown'),
      mentions: mentionedNow.map(jid => ({
        masked: maskJid(jid),
        domain: String(jid).split('@')[1] || 'unknown',
        aliases: jidAliases(jid).map(maskJid),
        playerFound: Boolean(playerForJid(jid)?.name),
        cachedNameFound: Boolean(whatsappName(jid, ''))
      }))
    }));
  }
  if (mentionedNow.some(jid => displayPlayer(jid, '') === '')) {
    await warmGroupParticipantNames(sock, groupJid);
  }
  for (const jid of mentionedNow) {
    if (displayPlayer(jid, '')) continue;
    try {
      const contact = await sock.onWhatsApp(jid).catch(() => null);
      const name = contact?.[0]?.notify || contact?.[0]?.name;
      if (name) rememberGroupName(jid, name);
    } catch {}
  }
  const authorPlayer = key.fromMe
    ? (players.get('self') || aliases.map(playerForJid).find(Boolean) || findPlayer(aliases))
    : (aliases.map(playerForJid).find(Boolean) || findPlayer(aliases));
  if (/^[!\/]sega$/i.test(text)) {
    await sendSegaMenu(sock, groupJid, menuKey);
    return;
  }
  if (/^[!/]battle(?:\s+.*)?$/i.test(text)) {
    await sendText(sock, groupJid, 'ℹ️ O Battle ID foi desativado. Use !stats no Geral para consultar seus dados.');
    return;
  }
  if (/^[!/]stats$/i.test(text)) {
    await sendPlayerStats(sock, groupJid, authorPlayer);
    return;
  }
  if (/^!ajuda$/i.test(text)) {
    await sendText(sock, groupJid, fullHelpLines().join('\n'));
    return;
  }
  if (/^[!/]ranking$/i.test(text)) {
    await sendSavedRanking(sock,groupJid);
    return;
  }
  if (/^[!/]highlights$/i.test(text)) {
    await sendHighlights(sock,groupJid);
    return;
  }
  const mentioned = mentionedNow;
  const knowledge = segaKnowledgeQuery(text);
  const botWasMentioned = mentioned.some(isOwnMention);
  // A mention of the owner's WhatsApp is a normal group mention: keep the joke.
  // Only the explicit @SEGA text triggers the MLBB knowledge handler.
  const segaMention = knowledge.textual;
  console.log('[sega-knowledge-debug]', JSON.stringify({ textual: knowledge.textual, botWasMentioned, fromMe: Boolean(key.fromMe), text: text.slice(0, 120), mentionCount: mentioned.length }));
  if (enabled && !botSentMessageIds.has(key.id) && mentioned.length && !segaMention) {
    const targetJid = mentioned.find(jid => jid !== ownJid) || mentioned[0];
    const author = authorPlayer?.name || key.pushName || whatsappName(aliases[0], 'alguém');
    let target = displayPlayer(targetJid, '');
    // Some group participants expose no WhatsApp profile name at all. In that case,
    // prefer the visible @mention label from the message text before using a generic fallback.
    if (!target) {
      const visibleMention = text.match(/@([^\s]{2,40})/u)?.[1]?.trim();
      target = visibleMention && !/^\d+$/.test(visibleMention) ? visibleMention : 'jogador';
    }
    const activitySender = aliases[0] || key.participant || key.remoteJid;
    if (activitySender) {
      const activityNow = Date.now();
      for (const jid of linkedAliases(activitySender)) lastMessageBySender.set(groupJid + ':' + jid, activityNow);
    }
    await sendText(sock, groupJid, roastFor(author, target, key.id));
    return;
  }
  if (segaMention) {
    const question = knowledge.cleaned.replace(/@\d{5,}/g, '').trim();
    if (!question) {
      await sendText(sock, groupJid, '🎮 Tô na escuta. Ex.: @SEGA quem countera Harley?\nDigite !ajuda para ver mais exemplos.');
      return;
    }
    try {
      const answer = await answerMlbbQuestion(question);
      const plain = answer
        ? answer.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/\\n/g, '\n')
        : '🧠 Ainda não entendi essa pergunta. Exemplos:\n' + listKnowledgeExamples().slice(0, 8).map(x => '• @SEGA ' + x).join('\n');
      await sendText(sock, groupJid, plain);
    } catch (error) {
      console.error('Falha no conhecimento WhatsApp:', error?.message);
      await sendText(sock, groupJid, '⚠️ Não consegui consultar o conhecimento agora. Tente novamente em alguns segundos.');
    }
    return;
  }
  if (/^[!/]?cadastrar$/i.test(text)) {
    if (!key.fromMe) {
      const link = registrationLink();
      await sendText(sock, groupJid, link
        ? '🔐 O cadastro é privado. Toque no link e envie a mensagem que já vai pronta:\n' + link
        : '🔐 O cadastro é privado. Abra meu PV e envie !cadastrar para vincular sua conta com segurança.');
    }
    return;
  }
  if (!enabled || botSentMessageIds.has(key.id)) return;
  const senderKey = aliases[0] || key.participant || key.remoteJid;
  const senderName = authorPlayer?.name || key.pushName || whatsappName(senderKey, 'jogador');
  const now = Date.now();
  // Use a canonical identity for cooldowns. WhatsApp may alternate the same person
  // between LID and phone-number JIDs, which previously made one user look like
  // multiple inactive users and triggered false AFK replies.
  const linked = linkedAliases(senderKey);
  const timerIdentity = linked.find(jid => String(jid).endsWith('@s.whatsapp.net'))
    || linked.find(jid => String(jid).endsWith('@lid'))
    || senderKey;
  const timerKey = groupJid + ':' + timerIdentity;
  const previousTimes = linked
    .map(jid => lastMessageBySender.get(groupJid + ':' + jid))
    .filter(value => Number.isFinite(value));
  const previous = previousTimes.length ? Math.max(...previousTimes) : lastMessageBySender.get(timerKey);
  for (const jid of [...new Set([timerIdentity, ...linked])]) lastMessageBySender.set(groupJid + ':' + jid, now);
  // First observation after startup establishes presence; it must not be treated as
  // a 15-minute absence. Only a known sender returning after the full cooldown gets an AFK line.
  if (previous === undefined || now - previous < INACTIVITY_MS) return;
  await sendText(sock, groupJid, geekLine(senderName, timerIdentity, now));
}

async function connect() {
  await restorePlayers();
  await restoreRegistrations();
  if (!announcementHistoryLoaded) {
    const history = await readJson(announcementsFile, []);
    for (const id of Array.isArray(history) ? history.slice(-500) : []) {
      if (typeof id === 'string') announcedIds.add(id);
    }
    announcementHistoryLoaded = true;
  }
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const sock = makeWASocket({ auth: state, logger, browser: Browsers.ubuntu('Chrome'), connectTimeoutMs: 60000, keepAliveIntervalMs: 30000, syncFullHistory: false });
  sock.ev.on('contacts.upsert', contacts => { for (const contact of contacts || []) { linkIdentities([contact.id, contact.lid, contact.phoneNumber].filter(Boolean)); rememberGroupName(contact.id || contact.lid, contact.notify || contact.name || contact.verifiedName); } });
  sock.ev.on('contacts.update', contacts => { for (const contact of contacts || []) { linkIdentities([contact.id, contact.lid, contact.phoneNumber].filter(Boolean)); rememberGroupName(contact.id || contact.lid, contact.notify || contact.name || contact.verifiedName); } });
  let connectionIdentityRejected = false;
  let connectionIdentityVerified = false;
  sock.ev.on('creds.update', saveCreds);
  if (!state.creds.registered && pairPhone) setTimeout(async () => {
    try {
      const code = await sock.requestPairingCode(pairPhone);
      // One-time code appears only in private Railway service logs, never in group chats.
      console.log('Código temporário de pareamento WhatsApp:', code);
    }
    catch (e) { console.error('Falha ao solicitar pareamento:', e?.message); }
  }, 10000);

  sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
    if (connection === 'open') {
      // Verify only authenticated phone-number JIDs. Brazilian accounts may use
      // either the 9-digit mobile form or the legacy 8-digit phone-number JID.
      const identityJids = [sock.user?.id, sock.user?.phoneNumber, state.creds.me?.id, state.creds.me?.phoneNumber];
      if (pairPhone && !ownerIdentityMatchesPhone(identityJids, pairPhone)) {
        connectionIdentityRejected = true;
        const kinds = identityJids.filter(Boolean).map(jid => String(jid).split('@')[1] || 'unknown');
        console.error('Segurança WhatsApp: telefone da sessão não confirmado; conexão bloqueada. Tipos de ID:', kinds.join(','));
        sock.end(new Error('WhatsApp sem confirmação de identidade'));
        return;
      }
      connectionIdentityVerified = true;
      console.log('WhatsApp: número conectado verificado contra o número configurado.');
      ownJid = sock.user?.id || null;
      ownerAccountJids = [sock.user?.id, sock.user?.lid, sock.user?.phoneNumber]
        .filter(value => typeof value === 'string' && value.includes('@'));
      console.log('WhatsApp conectado. Respostas habilitadas:', enabled);
      void discoverAnnouncementsGroup(sock);
    }
    if (connection === 'close') {
      const status = lastDisconnect?.error?.output?.statusCode;
      console.error('WhatsApp socket fechado. Status:', status, 'Motivo:', lastDisconnect?.error?.message);
      if (status !== DisconnectReason.loggedOut && !connectionIdentityRejected) setTimeout(() => void connect().catch(e => console.error(e?.message)), 5000);
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (!connectionIdentityVerified) return;
    // Messages sent by the linked WhatsApp account can arrive as "append"
    // instead of "notify". They are still real commands and must be processed.
    if (!['notify', 'append'].includes(type)) return;
    for (const message of messages || []) {
      try {
        const key = message?.key || {};
        const chatJid = String(key.remoteJid || '');
        const isGroup = chatJid.endsWith('@g.us');
        // Filter before inspecting message text or logging anything about the chat.
        // Private chats with third parties are strictly out of scope.
        if (isGroup) {
          if (chatJid !== targetGroup && chatJid !== announcementsGroup) continue;
        } else if (!canHandleRegistrationMessage(message)) continue;
        if (botSentMessageIds.has(key.id)) continue;
        const raw = message?.message || {};
        if (outgoingEchoGuard.isEcho(key, messageText(raw))) continue;
        console.log('[incoming-debug]', JSON.stringify({
          type,
          fromMe: Boolean(key.fromMe),
          group: String(key.remoteJid || '').endsWith('@g.us'),
          messageTypes: Object.keys(raw)
        }));
        if (await notifyAnnouncement(sock, message, type)) continue;
        if (await handleRegistration(sock, message)) continue;
        await handleGroup(sock, message);
      } catch (e) { console.error('Falha ao processar mensagem WhatsApp:', e?.message); }
    }
  });
}

// Never open a socket merely because the Railway service was deployed.
// A previously authenticated volume could otherwise reconnect to the owner's account.
if (process.env.WHATSAPP_CONNECT_ENABLED === 'true') {
  connect().catch(e => { console.error('WhatsApp não iniciou:', e?.message); process.exitCode = 1; });
} else {
  console.log('WhatsApp desconectado: WHATSAPP_CONNECT_ENABLED não está habilitado.');
  // Railway needs a running process while the service is safely parked.
  setInterval(() => {}, 60_000);
}
