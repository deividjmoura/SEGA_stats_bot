import makeWASocket, { DisconnectReason, useMultiFileAuthState } from '@whiskeysockets/baileys';
import pino from 'pino';
const DEFAULT_INACTIVITY_MS = 15 * 60 * 1000;
function createNickAnnouncer({ lookupNick, inactivityMs = DEFAULT_INACTIVITY_MS, now = Date.now } = {}) {
  if (typeof lookupNick !== 'function') throw new TypeError('lookupNick deve ser uma função');
  const lastMessageBySender = new Map();
  async function handle({ groupJid, senderJid, message, fromMe = false, isHistory = false, sendReply }) {
    if (fromMe || isHistory || !groupJid?.endsWith('@g.us') || !senderJid || !message) return false;
    const timestamp = now(), key = groupJid + ':' + senderJid, previous = lastMessageBySender.get(key);
    lastMessageBySender.set(key, timestamp);
    if (previous !== undefined && timestamp - previous < inactivityMs) return false;
    const nick = await lookupNick(senderJid, groupJid);
    if (typeof nick !== 'string' || !nick.trim()) return false;
    await sendReply({ groupJid, message, text: nick.trim() + ' disse:' });
    return true;
  }
  return { handle };
}
const logger = pino({ level: 'silent' });
const authDir = process.env.WHATSAPP_AUTH_DIR || '/app/data/whatsapp-auth';
const targetGroup = process.env.WHATSAPP_GROUP_JID;
const pairPhone = process.env.WHATSAPP_PAIR_PHONE?.replace(/\D/g, '');
const enabled = process.env.WHATSAPP_REPLY_ENABLED === 'true';
let mapping = {};
try {
  mapping = JSON.parse(process.env.WHATSAPP_NICK_MAP_JSON || '{}');
  if (!mapping || Array.isArray(mapping) || typeof mapping !== 'object') throw Error();
} catch { throw new Error('WHATSAPP_NICK_MAP_JSON deve ser um objeto JSON de JID para nick'); }
const announcer = createNickAnnouncer({ lookupNick: async (sender) => mapping[sender] || null });
async function connect() {
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const sock = makeWASocket({ auth: state, logger, syncFullHistory: false });
  sock.ev.on('creds.update', saveCreds);
  let closed = false;
  if (!state.creds.registered && pairPhone) {
    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(pairPhone);
        console.log('PAIRING_CODE_ONCE:' + code);
      } catch (error) { console.error('Falha ao solicitar pareamento:', error?.message); }
    }, 10000);
  }
  sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
    if (connection === 'open') console.log('WhatsApp conectado. Respostas habilitadas:', enabled);
    if (connection === 'close') {
      closed = true;
      const status = lastDisconnect?.error?.output?.statusCode;
      if (status === DisconnectReason.loggedOut) console.error('Sessão desconectada; requer novo pareamento.');
      else setTimeout(() => { void connect().catch((error) => console.error(error?.message)); }, 5000);
    }
  });
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify' || !enabled || !targetGroup) return;
    for (const message of messages || []) {
      const groupJid = message.key?.remoteJid, senderJid = message.key?.participant;
      if (groupJid !== targetGroup || !senderJid || message.key?.fromMe || !message.message) continue;
      try {
        await announcer.handle({ groupJid, senderJid, message,
          sendReply: async ({ text }) => sock.sendMessage(groupJid, { text }) });
      } catch (error) { console.error('Falha ao anunciar nick:', error?.message); }
    }
  });
}
connect().catch((error) => { console.error('WhatsApp não iniciou:', error?.message); process.exitCode = 1; });
