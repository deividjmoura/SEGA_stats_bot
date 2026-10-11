import makeWASocket, { DisconnectReason, useMultiFileAuthState, Browsers } from '@whiskeysockets/baileys';
import pino from 'pino';
import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import { apiFetch, isApiSuccess, apiErrorMessage, profileName } from './roneApi.js';

const INACTIVITY_MS = 15 * 60 * 1000;
const REGISTRATION_TTL_MS = 15 * 60 * 1000;
const logger = pino({ level: 'silent' });
const authDir = process.env.WHATSAPP_AUTH_DIR || '/app/data/whatsapp-auth-v2';
const dataDir = process.env.WHATSAPP_DATA_DIR || '/app/data';
const sessionsFile = dataDir + '/whatsapp-players.json';
const registrationsFile = dataDir + '/whatsapp-registrations.json';
const targetGroup = process.env.WHATSAPP_GROUP_JID || null;
const pairPhone = process.env.WHATSAPP_PAIR_PHONE?.replace(/\D/g, '');
const enabled = process.env.WHATSAPP_REPLY_ENABLED === 'true';
const secret = process.env.WHATSAPP_SESSION_ENCRYPTION_KEY;
if (!secret) throw new Error('WHATSAPP_SESSION_ENCRYPTION_KEY não configurada');
const SESSION_KEY = crypto.createHash('sha256').update(secret).digest();

const players = new Map();
const registrations = new Map();
const lastMessageBySender = new Map();
const botSentMessageIds = new Set();

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
function messageText(message) {
  return String(message?.conversation || message?.extendedTextMessage?.text || '').trim();
}
function aliasesFor(key) {
  return [...new Set([key?.participant, key?.participantAlt, key?.remoteJid].filter(Boolean))];
}
function findPlayer(aliases) {
  for (const jid of aliases) if (players.has(jid)) return players.get(jid);
  return null;
}
async function sendText(sock, jid, text) {
  const sent = await sock.sendMessage(jid, { text });
  if (sent?.key?.id) botSentMessageIds.add(sent.key.id);
  return sent;
}

async function handleRegistration(sock, message) {
  const key = message.key || {};
  const jid = key.remoteJid;
  if (!jid || jid.endsWith('@g.us') || botSentMessageIds.has(key.id)) return false;
  const text = messageText(message.message);
  if (!text) return false;
  const command = text.toLowerCase();

  if (['!cancelar','/cancelar','cancelar'].includes(command)) {
    await deleteRegistration(jid);
    await sendText(sock, jid, '❌ Cadastro cancelado. Quando quiser recomeçar, envie !cadastrar.');
    return true;
  }
  if (['!meunick','/meunick','meunick'].includes(command)) {
    const p = findPlayer(aliasesFor(key));
    await sendText(sock, jid, p ? '🎮 Seu nick verificado é: ' + p.name : 'Você ainda não está cadastrado. Envie !cadastrar.');
    return true;
  }
  if (['!cadastrar','/cadastrar','cadastrar'].includes(command)) {
    await setRegistration(jid, { step: 'role_id' });
    await sendText(sock, jid, '📝 CADASTRO SEGA\n\nMe envie somente o Role ID do Mobile Legends.\nExemplo: 123456789');
    return true;
  }

  const state = registrations.get(jid);
  if (!state) return false;

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

async function handleGroup(sock, message) {
  const key = message.key || {};
  const groupJid = key.remoteJid;
  if (!groupJid?.endsWith('@g.us') || groupJid !== targetGroup || !message.message) return;
  const text = messageText(message.message);
  if (/^[!/]?cadastrar$/i.test(text)) {
    if (!key.fromMe) await sendText(sock, groupJid, '🔐 O cadastro é privado. Chame este bot no WhatsApp e envie !cadastrar para vincular sua conta com segurança.');
    return;
  }
  if (!enabled || key.fromMe) return;
  const aliases = aliasesFor(key);
  const player = findPlayer(aliases);
  if (!player?.name) return;
  const senderKey = aliases[0];
  const now = Date.now();
  const timerKey = groupJid + ':' + senderKey;
  const previous = lastMessageBySender.get(timerKey);
  lastMessageBySender.set(timerKey, now);
  if (previous !== undefined && now - previous < INACTIVITY_MS) return;
  await sendText(sock, groupJid, player.name + ' disse:');
}

async function connect() {
  await restorePlayers();
  await restoreRegistrations();
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const sock = makeWASocket({ auth: state, logger, browser: Browsers.ubuntu('Chrome'), connectTimeoutMs: 60000, keepAliveIntervalMs: 30000, syncFullHistory: false });
  sock.ev.on('creds.update', saveCreds);
  if (!state.creds.registered && pairPhone) setTimeout(async () => {
    try { await sock.requestPairingCode(pairPhone); console.log('Código de pareamento solicitado com sucesso.'); }
    catch (e) { console.error('Falha ao solicitar pareamento:', e?.message); }
  }, 10000);

  sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
    if (connection === 'open') console.log('WhatsApp conectado. Respostas habilitadas:', enabled);
    if (connection === 'close') {
      const status = lastDisconnect?.error?.output?.statusCode;
      console.error('WhatsApp socket fechado. Status:', status, 'Motivo:', lastDisconnect?.error?.message);
      if (status !== DisconnectReason.loggedOut) setTimeout(() => void connect().catch(e => console.error(e?.message)), 5000);
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const message of messages || []) {
      try {
        if (await handleRegistration(sock, message)) continue;
        await handleGroup(sock, message);
      } catch (e) { console.error('Falha ao processar mensagem WhatsApp:', e?.message); }
    }
  });
}

connect().catch(e => { console.error('WhatsApp não iniciou:', e?.message); process.exitCode = 1; });
