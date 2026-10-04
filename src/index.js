import 'dotenv/config';
import { Telegraf, Markup } from 'telegraf';
import crypto from 'node:crypto';
import { processScreenshot, recordVerifiedBattle, getPlayerScreenshots, getAllPlayerScreenshotSummaries, summarizePlayerScreenshots, updateScreenshotVerification, cleanupScreenshots } from './screenshotStats.js';
import { groupBanterMiddleware, markBanterHandled, restoreGroupBanters } from './groupBanters.js';
import { answerMlbbQuestion, listKnowledgeExamples, knowledgeSummary } from './mlbbKnowledgeV2.js';
import { nickMatches } from './ocr.js';
import { escapeHtml, renderRanking, renderPlayerStats } from './render.js';
import { logQuestion, getQuestionReport } from './questionLog.js';
import { readJson, writeJson, quarantineJson } from './storage/jsonStore.js';
import {
  apiFetch,
  apiJson,
  isApiSuccess,
  apiErrorMessage,
  authHeaders,
  profileName,
  battleBelongsToPlayer,
  normalizeVerifiedMatch
} from './roneApi.js';

const token = process.env.BOT_TOKEN;
const DATA_DIR = process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || './data';
const HAS_PERSISTENT_VOLUME = Boolean(process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH);
const SESSION_FILE = process.env.SESSION_FILE || (DATA_DIR + '/sessions.json');
const REGISTRATION_FILE = process.env.REGISTRATION_FILE || (DATA_DIR + '/registrations.json');
const KNOWLEDGE_ADMIN_IDS = new Set(String(process.env.KNOWLEDGE_ADMIN_IDS || '').split(',').map(v => v.trim()).filter(Boolean));
const REGISTRATION_TTL_MS = 15 * 60 * 1000;
const OCR_COOLDOWN_MS = 30 * 1000;
const RANKING_CACHE_MS = 5 * 60 * 1000;
const RANKING_COOLDOWN_MS = 15 * 1000;
const ocrCooldownByUser = new Map();
const rankingCooldownByUser = new Map();
let rankingCache = null;
const sessionEncryptionSecret = process.env.SESSION_ENCRYPTION_KEY;
if (!sessionEncryptionSecret) {
  console.error('❌ SESSION_ENCRYPTION_KEY não configurada. Defina uma chave própria para criptografar as sessões; BOT_TOKEN não é aceito como chave.');
  process.exit(1);
}
const SESSION_KEY = crypto.createHash('sha256').update(sessionEncryptionSecret).digest();
const LEGACY_SESSION_KEY = process.env.SESSION_LEGACY_KEY
  ? crypto.createHash('sha256').update(process.env.SESSION_LEGACY_KEY).digest()
  : null;

if (!token) {
  console.error('❌ BOT_TOKEN não configurado. Crie um arquivo .env com o token do BotFather.');
  process.exit(1);
}

const PERSISTENCE_REQUIRED = process.env.REQUIRE_PERSISTENT_STORAGE !== 'false';
const CLAN_CHAT_ID = process.env.CLAN_CHAT_ID || null;

function persistenceIsAvailable() {
  if (process.env.RAILWAY_ENVIRONMENT) {
    return Boolean(process.env.RAILWAY_VOLUME_MOUNT_PATH);
  }
  return Boolean(process.env.DATA_DIR);
}

async function notifyPersistenceProblem() {
  if (!CLAN_CHAT_ID) return;
  try {
    await bot.telegram.sendMessage(
      CLAN_CHAT_ID,
      '🚨 <b>SEGA Stats pausado por segurança</b>\\n\\n' +
      'O Railway iniciou esta versão sem armazenamento persistente.\\n\\n' +
      'Para proteger cadastros, prints e estatísticas, o bot não vai operar até um Volume ser montado em <code>/app/data</code> (ou até REQUIRE_PERSISTENT_STORAGE=false, somente para testes).\\n\\n' +
      'Nenhum cadastro deve ser refeito enquanto essa configuração não for corrigida.',
      { parse_mode: 'HTML' }
    );
  } catch (error) {
    console.warn('⚠️ Não consegui avisar o grupo sobre a persistência:', error?.description || error?.message || error);
  }
}

const bot = new Telegraf(token);

const registration = new Map();
const authenticatedPlayers = new Map();

async function refreshPlayerName(telegramId) {
  const player = authenticatedPlayers.get(Number(telegramId));
  if (!player?.jwt) return null;
  if (player.nameVerified && player.name) return player.name;

  try {
    const info = await apiJson('/user/info?lang=pt', { headers: authHeaders(player.jwt) });
    if (info.response.ok && isApiSuccess(info.body)) {
      const name = profileName(info.body?.data);
      if (name) {
        player.name = name;
        player.nameVerified = true;
        await saveSessions();
        return name;
      }
    }
  } catch (error) {
    console.warn('⚠️ Não consegui atualizar o nick do jogador:', error?.message || error);
  }

  return player.name || null;
}

function getReplyIdentity(ctx) {
  const telegramId = ctx.from?.id;
  if (!telegramId) return null;

  const player = authenticatedPlayers.get(Number(telegramId));
  const registered = Boolean(player?.name);
  const name =
    player?.name ||
    ctx.from?.first_name ||
    ctx.from?.username ||
    'Jogador';

  return {
    registered,
    name,
    mention: '<a href="tg://user?id=' + telegramId + '">' + escapeHtml(name) + '</a>'
  };
}

function getReplyIntro(ctx, kind) {
  const identity = getReplyIdentity(ctx);
  if (!identity) return '';

  const who = identity.mention;
  const intros = {
    general: '🎮 ' + who + ', olha só:\n\n',
    ranking: '🏆 ' + who + ', olha como está o ranking:\n\n',
    stats: '📊 ' + who + ', aqui estão seus dados:\n\n',
    print: '📸 ' + who + ', sobre esse print:\n\n',
    auth: '🔐 ' + who + ', vamos continuar o cadastro com segurança:\n\n',
    counter: '🎮 Então, ' + who + ', geralmente são esses:\n\n',
    items: '🛡️ ' + who + ', contra esse herói eu olharia primeiro para estes itens:\n\n',
    tips: '🧠 ' + who + ', o caminho mais seguro costuma ser este:\n\n',
    build: '🧩 ' + who + ', sobre a build, olha só:\n\n'
  };
  return intros[kind] || intros.general;
}

async function replyAs(ctx, kind, text, extra = {}) {
  const options = { ...extra };
  markBanterHandled(ctx);
  if (typeof text === 'string') {
    const intro = getReplyIntro(ctx, kind);
    if (intro) {
      text = intro + text;
      if (!options.parse_mode) options.parse_mode = 'HTML';
    }
  }
  return ctx.reply(text, options);
}

const memberTagCache = new Map();

function normalizeMemberTag(name) {
  // O Telegram limita tags de membros a 16 caracteres e não aceita emojis.
  // Mantemos o nick do MLBB, removendo apenas emojis e limitando o tamanho.
  const cleaned = String(name || '')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .trim();

  return Array.from(cleaned).slice(0, 16).join('');
}

async function syncMemberTag(ctx, player) {
  if (!isGroupChat(ctx) || !player?.name || !ctx.from?.id || !ctx.chat?.id) return;

  const tag = normalizeMemberTag(player.name);
  if (!tag) return;

  const cacheKey = String(ctx.chat.id) + ':' + String(ctx.from.id);
  const cachedTag = memberTagCache.get(cacheKey);
  if (cachedTag === tag) return;
  if (cachedTag?.tag === tag && Date.now() - cachedTag.failedAt < 6 * 60 * 60 * 1000) return;

  try {
    await ctx.telegram.callApi('setChatMemberTag', {
      chat_id: ctx.chat.id,
      user_id: ctx.from.id,
      tag
    });
    memberTagCache.set(cacheKey, tag);
  } catch (error) {
    // Guarda também falhas para não repetir uma chamada ao Telegram a cada mensagem.
    memberTagCache.set(cacheKey, { tag, failedAt: Date.now() });
    const description = error?.description || error?.message || String(error);
    if (/CHAT_CREATOR_REQUIRED/i.test(description)) {
      console.warn(
        'ℹ️ O membro ' + ctx.from.id + ' é o criador do grupo ' + ctx.chat.id +
        ' e o Telegram não permite que bots alterem a tag dele. O nick continua sendo usado nas respostas do bot.'
      );
    } else if (/CHAT_ADMIN_REQUIRED|RIGHT_FORBIDDEN|METHOD_FORBIDDEN/i.test(description)) {
      console.warn(
        '⚠️ Não consegui atualizar a tag do membro ' + ctx.from.id +
        ': o bot precisa ser administrador com a permissão "Gerenciar tags" no grupo.'
      );
    } else {
      console.warn(
        '⚠️ Não consegui atualizar a tag do membro ' +
        ctx.from.id + ' no grupo ' + ctx.chat.id + ':',
        description
      );
    }
  }
}

bot.use(async (ctx, next) => {
  const player = authenticatedPlayers.get(Number(ctx.from?.id));
  if (player) {
    await refreshPlayerName(ctx.from?.id);
    await syncMemberTag(ctx, player);
  }
  return next();
});

bot.use(groupBanterMiddleware(resolvePlayerName));

async function saveRegistrations() {
  const stored = {};
  for (const [telegramId, state] of registration) stored[telegramId] = state;
  await writeJson(REGISTRATION_FILE, stored);
}

async function setRegistration(telegramId, state) {
  registration.set(Number(telegramId), { ...state, updatedAt: new Date().toISOString() });
  await saveRegistrations();
}

async function deleteRegistration(telegramId) {
  registration.delete(Number(telegramId));
  await saveRegistrations();
}

async function restoreRegistrations() {
  try {
    const stored = await readJson(REGISTRATION_FILE, {});
    const now = Date.now();
    for (const [telegramId, state] of Object.entries(stored || {})) {
      if (!state || !['role_id', 'zone_id', 'verification_code'].includes(state.step)) continue;
      const updatedAt = Date.parse(state.updatedAt || state.createdAt || '');
      if (!Number.isFinite(updatedAt) || now - updatedAt > REGISTRATION_TTL_MS) continue;
      registration.set(Number(telegramId), state);
    }
    console.log('📝 Cadastros pendentes restaurados: ' + registration.size);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('❌ Erro ao restaurar cadastros pendentes:', error);
      await quarantineJson(REGISTRATION_FILE).catch(() => {});
    }
  }
}

async function resolvePlayerName(telegramId) {
  const player = authenticatedPlayers.get(Number(telegramId));
  if (!player?.jwt) return null;
  return (await refreshPlayerName(telegramId)) || player.name || null;
}

function isGroupChat(ctx) {
  return ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup';
}

async function requirePrivateChat(ctx) {
  if (ctx.chat?.type === 'private') return true;
  const username = ctx.botInfo?.username || bot.botInfo?.username || null;
  const link = username ? 'https://t.me/' + username : 'o chat privado deste bot';
  await replyAs(ctx, 'general', 
    '🔐 <b>Cadastro é feito no privado.</b>\n\n' +
    'Para proteger seu Role ID, Zone ID e o código de verificação, abra o chat privado do SEGA Stats e use <code>/cadastrar</code> por lá.\n\n' +
    (username ? '👉 <a href="' + link + '?start=cadastro">Abrir cadastro no SEGA Stats</a>' : '👉 Abra o chat privado do bot pelo perfil acima.'),
    { parse_mode: 'HTML', disable_web_page_preview: true }
  );
  return false;
}

function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', SESSION_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
}

function decrypt(payload, key = SESSION_KEY) {
  const data = Buffer.from(payload, 'base64');
  const iv = data.subarray(0, 12);
  const tag = data.subarray(12, 28);
  const encrypted = data.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

async function saveSessions() {
  const stored = {};
  for (const [telegramId, player] of authenticatedPlayers) {
    stored[telegramId] = {
      jwt: encrypt(player.jwt),
      roleId: player.roleId,
      zoneId: player.zoneId,
      name: player.name || null,
      nameVerified: Boolean(player.nameVerified),
      savedAt: new Date().toISOString()
    };
  }
  await writeJson(SESSION_FILE, stored);
}

async function restoreSessions() {
  try {
    const stored = await readJson(SESSION_FILE, {});
    let migrated = false;

    for (const [telegramId, player] of Object.entries(stored || {})) {
      try {
        if (!player?.jwt) throw new Error('sessão sem token criptografado');

        let jwt;
        try {
          jwt = decrypt(player.jwt);
        } catch (primaryError) {
          if (!LEGACY_SESSION_KEY) throw primaryError;
          jwt = decrypt(player.jwt, LEGACY_SESSION_KEY);
          migrated = true;
        }

        if (!jwt) throw new Error('token vazio após descriptografia');
        authenticatedPlayers.set(Number(telegramId), {
          jwt,
          roleId: player.roleId,
          zoneId: player.zoneId,
          name: player.name || null,
          nameVerified: Boolean(player.nameVerified)
        });
      } catch (error) {
        console.warn('⚠️ Sessão ignorada durante restore (' + telegramId + '):', error?.message || error);
      }
    }

    if (migrated) {
      await saveSessions();
      console.log('🔄 Sessões legadas migradas para SESSION_ENCRYPTION_KEY.');
    }
    console.log('🔐 Sessões restauradas: ' + authenticatedPlayers.size);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('❌ Erro ao restaurar sessões:', error);
      await quarantineJson(SESSION_FILE).catch(() => {});
    }
  }
}

bot.telegram.setMyCommands([
  { command: 'start', description: 'Abrir o menu principal' },
  { command: 'cadastrar', description: 'Cadastrar jogador' },
  { command: 'ranking', description: 'Ver ranking do clã' },
  { command: 'stats', description: 'Ver minhas estatísticas' },
  { command: 'clan', description: 'Ver o clã SEGA' },
  { command: 'ajuda', description: 'Mostrar ajuda' },
  { command: 'cancelar', description: 'Cancelar cadastro' },
  { command: 'lore', description: 'Crônicas e heróis' },
  { command: 'menu', description: 'Abrir menu principal' },
  { command: 'prints', description: 'Ver dados coletados por screenshots' },
  { command: 'tutorial', description: 'Ver tutorial de uso' },
  { command: 'conhecimento', description: 'Ver o que o bot sabe' },
  { command: 'perguntas', description: 'Relatório de perguntas (admin)' }
]).catch((error) => console.error('❌ Erro ao registrar comandos:', error));

const startMessage = `🎮 <b>SEGA STATS</b>

⚡ <b>Bem-vindo à arena, guerreiro!</b> 👊

Bem-vindo ao bot oficial do clã <b>SEGA</b>.

Na jornada pelo <b>Land of Dawn</b>, seus números contam a história da sua batalha. Aqui você vai poder:

🏆 Consultar o ranking do clã
📸 Enviar prints das partidas para guardar os dados
⚔️ Ver suas partidas e desempenho
🛡️ Conferir sua rota mais jogada
📊 Acompanhar seus pontos e estatísticas
👥 Comparar seu desempenho com a galera do clã

<b>Para começar:</b>
👉 Use <code>/cadastrar</code> para vincular seu jogador.

⚔️ <i>Entre na arena. Analise a batalha. Evolua.</i> 🔥

<b>SEGA</b> é a nossa guilda. O campo de batalha é o Land of Dawn.`;

const helpMessage = `📚 <b>GUIA DO SEGA STATS</b>

🎮 <b>1. Primeiro cadastro</b>
Use <code>/cadastrar</code> no <b>chat privado</b> do bot.
Você vai informar:
• 🆔 Role ID
• 🌐 Zone ID
• 🔐 código recebido no correio interno do Mobile Legends

⚠️ Nunca mande esses dados no grupo.

📸 <b>2. Enviar relatório/print de partida</b>
Depois de cadastrado, basta mandar a <b>foto</b> no chat do bot ou no grupo SEGA.

🥇 O melhor print para registrar uma partida é a <b>tela final</b>, com:
• resultado (Victory/Defeat)
• seu nick
• K/D/A
• pontuação
• Battle ID

O bot usa o Battle ID + sua conta autenticada para tentar confirmar que a partida realmente pertence a você. Print repetido não é contado duas vezes.

👤 <b>3. Enviar foto do perfil</b>
Pode mandar a tela do seu <b>perfil</b>.
Ela serve como snapshot de conferência e deve mostrar:
• seu nick
• Role ID
• estatísticas gerais

📋 <b>4. Enviar a tela “Batalhas”</b>
Também pode mandar a tela de <b>Batalhas/Histórico</b>.
Ela é útil para conferência e para melhorar a leitura do histórico. Dependendo da tela e do OCR, ela pode ser guardada como snapshot e não necessariamente contar cada linha como partida individual.

📊 <b>5. Consultar seus dados</b>
<code>/stats</code> — suas estatísticas
<code>/prints</code> — resumo dos prints recebidos e partidas verificadas

🏆 <b>6. Ranking do clã</b>
<code>/ranking</code> — ranking dos jogadores vinculados.

👥 <b>7. Grupo SEGA</b>
No grupo você pode:
• usar <code>/ranking</code>, <code>/stats</code> e <code>/ajuda</code>
• mandar seus prints diretamente
• usar o botão de ajuda para abrir o tutorial completo no privado

🔐 <b>Privacidade</b>
O cadastro fica no privado para não expor Role ID, Zone ID ou código de verificação no grupo.

📜 <code>/lore</code> — crônicas do SEGA
❌ <code>/cancelar</code> — cancelar cadastro
🏠 <code>/menu</code> — abrir o menu principal`;

const groupGuideMessage = `📖 <b>GUIA RÁPIDO • SEGA STATS</b>

📝 <b>1. Cadastre sua conta</b>
O cadastro é feito no <b>privado</b>. Não mande Role ID, Zone ID ou código de verificação aqui.

📸 <b>2. Depois do cadastro, mande as fotos aqui</b>
• 🥇 <b>Resultado final da partida:</b> melhor opção para registrar a partida.
• 👤 <b>Perfil:</b> usado como conferência da conta e snapshot geral.
• 📋 <b>Batalhas/Histórico:</b> útil para conferência e evolução do leitor.

📊 <b>3. Consulte</b>
<code>/stats</code> → suas stats
<code>/ranking</code> → ranking do SEGA
<code>/ajuda</code> → este tutorial

👇 Para ver o guia completo e iniciar o cadastro com segurança, use os botões abaixo.`;


async function sendHelp(ctx) {
  if (isGroupChat(ctx)) {
    const username = getBotUsername(ctx);
    const helpLink = username ? 'https://t.me/' + username + '?start=ajuda' : null;
    const registerLink = username ? 'https://t.me/' + username + '?start=cadastro' : null;

    await replyAs(ctx, 'general', groupGuideMessage, {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...Markup.inlineKeyboard([
        ...(helpLink ? [[Markup.button.url('📖 Ajuda completa no privado', helpLink)]] : []),
        ...(registerLink ? [[Markup.button.url('📝 Abrir cadastro no privado', registerLink)]] : [])
      ])
    });
    return;
  }

  await replyAs(ctx, 'general', helpMessage, {
    parse_mode: 'HTML',
    ...mainKeyboard()
  });
}

function mainKeyboard() {
  return Markup.keyboard([
    ['📝 Cadastrar jogador', '📊 Minhas stats'],
    ['🏆 Ranking', '👥 Clã SEGA'],
    ['📸 Enviar print', '🔢 Enviar Battle ID'],
    ['❓ Ajuda', '📜 Lore']
  ]).resize().persistent();
}

async function sendPrintInstructions(ctx) {
  await replyAs(ctx, 'general', 
    '📸 <b>ENVIAR PRINT</b>\n\n' +
    'Agora é só anexar a imagem nesta conversa pelo botão de <b>clipe/câmera do Telegram</b>.\n\n' +
    '🥇 <b>Resultado final</b> — melhor opção; se aparecerem Battle ID, K/D/A e seu nick, melhor ainda.\n' +
    '👤 <b>Perfil</b> — serve para conferir sua conta e guardar um snapshot geral.\n' +
    '📋 <b>Batalhas/Histórico</b> — serve para conferência e evolução do leitor.\n\n' +
    '🔢 <b>Battle ID sozinho também funciona:</b> envie o número da partida ou use /battle 1234567890123456. Se a API confirmar que a partida é sua, ela entra nas estatísticas mesmo sem print.\n\n' +
    '💡 Você também pode usar os atalhos no teclado do bot, na parte inferior da conversa.',
    { parse_mode: 'HTML', ...mainKeyboard() }
  );
}

async function askForRoleId(ctx) {
  if (!(await requirePrivateChat(ctx))) return false;
  await setRegistration(ctx.from.id, { step: 'role_id' });
  return replyAs(ctx, 'general', '📝 <b>CADASTRO DO JOGADOR</b>\n\nMe manda agora o <b>ID do Mobile Legends</b> (Role ID).\n\nExemplo: <code>123456789</code>', { parse_mode: 'HTML' });
}

async function sendMenu(ctx) {
  if (isGroupChat(ctx)) {
    await replyAs(ctx, 'general', 
      '🎮 <b>SEGA STATS ONLINE</b>\n\n' +
      '🏆 Ranking • 📊 Stats • 📸 Prints\n\n' +
      '🔐 O cadastro de cada jogador é feito no privado, para não expor Role ID, Zone ID ou código de verificação no grupo.\n\n' +
      'Use /cadastrar no privado e, depois de vincular a conta, envie seus prints aqui no grupo.',
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🏆 Ranking', 'ranking'), Markup.button.callback('📊 Minhas stats', 'stats')],
          [Markup.button.callback('👥 Clã SEGA', 'clan'), Markup.button.callback('❓ Ajuda', 'help')]
        ])
      }
    );
    return;
  }

  await replyAs(ctx, 'general', startMessage, { parse_mode: 'HTML', ...mainKeyboard() });
  await replyAs(ctx, 'general', '⚡ <b>AÇÕES RÁPIDAS</b>', {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('📝 Cadastrar jogador', 'register')],
      [Markup.button.callback('📊 Minhas stats', 'stats'), Markup.button.callback('🏆 Ranking', 'ranking')],
      [Markup.button.callback('👥 Clã SEGA', 'clan'), Markup.button.callback('📜 Lore', 'lore')],
      [Markup.button.callback('❓ Ajuda', 'help')]
    ])
  });
}

bot.start(async (ctx) => {
  const payload = String(ctx.startPayload || '').toLowerCase();

  if (payload === 'cadastro' || payload === 'cadastrar' || payload === 'register') {
    await askForRoleId(ctx);
    return;
  }

  if (payload === 'ajuda' || payload === 'help' || payload === 'tutorial') {
    await sendHelp(ctx);
    return;
  }

  await sendMenu(ctx);
});
bot.command('menu', async (ctx) => await sendMenu(ctx));

bot.command('cadastrar', async (ctx) => await askForRoleId(ctx));

bot.command('cancelar', async (ctx) => {
  await deleteRegistration(ctx.from.id);
  await replyAs(ctx, 'general', '❌ Cadastro cancelado. Nenhuma alteração foi feita.');
});

bot.on('text', async (ctx, next) => {
  const state = registration.get(ctx.from.id);

  if (state && ctx.chat?.type !== 'private') {
    await replyAs(ctx, 'auth',
      '🔐 <b>Cadastro protegido.</b>\n\n' +
      'Continue este cadastro somente no chat privado do SEGA Stats. Não envie Role ID, Zone ID ou código de verificação no grupo.',
      { parse_mode: 'HTML' }
    );
    return next();
  }

  // Este handler trata somente as respostas do fluxo de cadastro.
  // Comandos como /stats e /ranking precisam seguir para os handlers abaixo.
  if (!state) {
    if (!isGroupChat(ctx) && /^\d{4,8}$/.test(ctx.message.text.trim())) {
      await replyAs(ctx, 'general', 
        '⚠️ <b>Não encontrei um cadastro pendente para esse código.</b>\n\n' +
        'O bot pode ter sido reiniciado antes de você enviar o código. Use /cadastrar novamente para iniciar uma nova verificação.',
        { parse_mode: 'HTML' }
      );
    }
    await next();
    return;
  }

  if (ctx.message.text.startsWith('/')) {
    await next();
    return;
  }

  const value = ctx.message.text.trim();

  if (state.step === 'role_id') {
    if (!/^\d{6,12}$/.test(value)) {
      await replyAs(ctx, 'general', '⚠️ Esse ID não parece válido. Envie somente os números do seu ID do Mobile Legends.');
      return;
    }
    await setRegistration(ctx.from.id, { step: 'zone_id', roleId: value });
    await replyAs(ctx, 'general', '🌐 Agora me manda o <b>Zone ID</b> do seu jogador.\n\nExemplo: <code>1234</code>', { parse_mode: 'HTML' });
    return;
  }

  if (state.step === 'zone_id') {
    if (!/^\d{1,8}$/.test(value)) {
      await replyAs(ctx, 'general', '⚠️ Zone ID inválido. Envie somente os números do seu Zone ID.');
      return;
    }

    const { roleId } = state;
    await replyAs(ctx, 'general', '🔎 <b>Solicitando código de verificação...</b>\n\n📩 Um código será enviado para o correio interno do Mobile Legends.\n⏱️ O código é válido por 5 minutos.', { parse_mode: 'HTML' });

    try {
      const response = await apiFetch('/user/auth/send-vc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role_id: Number(roleId), zone_id: Number(value) })
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok || !isApiSuccess(body)) {
        const apiMsg = apiErrorMessage(body);
        const trace = body?.traceID || body?.traceId || '';
        console.error('❌ Falha ao solicitar código:', response.status, body);

        let reply;
        if (response.status === 429) {
          reply = '⏳ <b>A API limitou novas solicitações por alguns instantes.</b>\n\nAguarde um pouco e envie o Zone ID novamente.';
        } else {
          reply =
            '⚠️ <b>Não consegui solicitar o código de verificação.</b>\n\n' +
            (apiMsg ? '📋 Motivo informado pela API: <code>' + escapeHtml(String(apiMsg).slice(0, 180)) + '</code>\n\n' : '') +
            'Confira o Role ID e o Zone ID e tente novamente.' +
            (trace ? '\n\n🔎 Trace ID: <code>' + escapeHtml(String(trace)) + '</code>' : '');
        }

        // Mantém o Role ID/Zone ID em memória e no volume para permitir uma nova tentativa
        // sem obrigar o jogador a reiniciar todo o cadastro.
        await setRegistration(ctx.from.id, { step: 'zone_id', roleId });
        await replyAs(ctx, 'general', reply, { parse_mode: 'HTML' });
        return;
      }

      await setRegistration(ctx.from.id, { step: 'verification_code', roleId, zoneId: value });
      await replyAs(ctx, 'general', 
        '🔐 <b>VERIFICAÇÃO DO JOGADOR</b>\n\n' +
        '📩 O código foi solicitado e deve chegar no <b>correio interno do Mobile Legends</b>.\n\n' +
        '🔢 Quando receber o código, envie <b>somente o código</b> aqui no bot.\n\n' +
        '🔒 <b>Sua segurança é importante:</b> nunca enviaremos ou pediremos sua senha, seu e-mail ou códigos de outras plataformas. O código solicitado aqui é usado para concluir a autenticação e liberar a consulta das suas estatísticas.\n\n' +
        '⏱️ <b>O código é válido por 5 minutos.</b>\n\n' +
        'Digite /cancelar para cancelar o processo.',
        { parse_mode: 'HTML' }
      );
    } catch (error) {
      console.error('❌ Erro ao solicitar código:', error);
      // Mantém o cadastro em zone_id: se a falha for de rede/timeout,
      // o jogador pode tentar novamente sem redigitar o Role ID.
      await setRegistration(ctx.from.id, { step: 'zone_id', roleId });
      await replyAs(ctx, 'general', '⚠️ Não consegui conectar ao serviço de autenticação agora. Tente novamente. Seu cadastro foi mantido; envie o Zone ID novamente.');
    }
    return;
  }

  if (state.step === 'verification_code') {
    if (!/^\d{4,8}$/.test(value)) {
      await replyAs(ctx, 'general', '⚠️ Código inválido. Envie somente os números do código recebido no correio do Mobile Legends.');
      return;
    }

    const { roleId, zoneId } = state;
    await replyAs(ctx, 'auth', '🔐 <b>Validando o código...</b>', { parse_mode: 'HTML' });

    try {
      const payload = {
        role_id: Number(roleId),
        zone_id: Number(zoneId),
        vc: Number(value)
      };
      const response = await apiFetch('/user/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const body = await response.json().catch(() => ({}));

      // Aceita jwt ou token (a API devolve os dois no sucesso)
      const jwt = body?.data?.jwt || body?.data?.token || null;
      const ok = response.ok && isApiSuccess(body) && jwt;

      if (!ok) {
        const apiMsg = apiErrorMessage(body);
        console.error('❌ Falha na autenticação:', response.status, {
          code: body?.code,
          msg: apiErrorMessage(body)
        });
        let reply =
          '❌ <b>Não foi possível validar o código.</b>\n\n' +
          'Verifique se você digitou o código corretamente e se ele ainda está dentro do prazo de validade (5 minutos).\n\n' +
          'Você pode enviar o código novamente ou digitar /cancelar para recomeçar.';
        if (apiMsg) {
          reply += '\n\n📋 Detalhe da API: <code>' + escapeHtml(String(apiMsg).slice(0, 150)) + '</code>';
        }
        await replyAs(ctx, 'general', reply, { parse_mode: 'HTML' });
        return;
      }

      const infoResponse = await apiFetch('/user/info', { headers: { Authorization: 'Bearer ' + jwt } });
      const infoBody = await infoResponse.json().catch(() => ({}));

      if (!infoResponse.ok || !isApiSuccess(infoBody)) {
        console.error('❌ Login realizado, mas não consegui consultar o perfil:', infoResponse.status, infoBody);
        await replyAs(ctx, 'general', '⚠️ A autenticação retornou token, mas a API não confirmou o perfil agora. Tente novamente em alguns instantes ou envie o código de novo.', { parse_mode: 'HTML' });
        return;
      }

      const verifiedName = profileName(infoBody.data) || 'Jogador';
      authenticatedPlayers.set(ctx.from.id, {
        jwt,
        roleId,
        zoneId,
        name: verifiedName,
        nameVerified: true
      });
      await saveSessions();
      await deleteRegistration(ctx.from.id);

      await replyAs(ctx, 'general', 
        '✅ <b>CONTA VERIFICADA!</b>\n\n' +
        `🎮 Nick confirmado: <b>${escapeHtml(verifiedName)}</b>\n` +
        `🆔 ID: <code>${roleId}</code>\n` +
        `🌐 Zone: <code>${zoneId}</code>\n\n` +
        '📊 Seu jogador foi vinculado ao <b>SEGA Stats</b>.\n\n' +
        '📸 <b>Próximo passo:</b> envie alguns prints para começar seu histórico.\n\n' +
        '👇 O atalho <b>📸 Enviar print</b> fica no teclado do bot, na parte inferior da conversa. ' +
        'Se preferir, use o botão destacado logo abaixo desta mensagem.',
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('📸 ENVIAR PRINT AGORA', 'send_print')]
          ])
        }
      );
    } catch (error) {
      console.error('❌ Erro ao autenticar jogador:', error);
      await replyAs(ctx, 'general', '⚠️ Ocorreu um erro de conexão ao validar o código. Tente novamente em alguns segundos.');
    }
  }
});

bot.action('register', async (ctx) => {
  await ctx.answerCbQuery();
  await askForRoleId(ctx);
});

async function sendClan(ctx) {
  const count = authenticatedPlayers.size;
  await replyAs(ctx, 'general', '👥 <b>CLÃ SEGA</b>\n\n🛡️ Jogadores vinculados: <b>' + count + '</b>\n\nO próximo passo é transformar os dados individuais em estatísticas coletivas do clã.\n\n⚔️ <i>Uma equipe forte não depende de um único herói.</i>', { parse_mode: 'HTML', ...mainKeyboard() });
}

async function sendRanking(ctx) {
  const userId = Number(ctx.from?.id);
  const lastRequest = rankingCooldownByUser.get(userId) || 0;
  if (Date.now() - lastRequest < RANKING_COOLDOWN_MS) {
    const remaining = Math.ceil((RANKING_COOLDOWN_MS - (Date.now() - lastRequest)) / 1000);
    await replyAs(ctx, 'ranking', '⏳ <b>Ranking em cooldown.</b>\n\nAguarde ' + remaining + 's antes de consultar novamente.', { parse_mode: 'HTML' });
    return;
  }
  rankingCooldownByUser.set(userId, Date.now());

  const now = Date.now();
  const rows = rankingCache && now - rankingCache.createdAt < RANKING_CACHE_MS
    ? rankingCache.rows
    : await getAllPlayerScreenshotSummaries();

  if (!rankingCache || now - rankingCache.createdAt >= RANKING_CACHE_MS) {
    rankingCache = { createdAt: now, rows };
  }

  const ranking = rows
    .filter(row => row.summary.verifiedMatches >= 5)
    .map(row => {
      const registered = authenticatedPlayers.get(Number(row.telegramId));
      const name = registered?.name || row.name || ('Jogador ' + row.telegramId);
      return {
        ...row.summary,
        telegramId: row.telegramId,
        name
      };
    })
    .sort((a, b) =>
      b.winRate - a.winRate ||
      b.wins - a.wins ||
      b.averageScore - a.averageScore ||
      b.verifiedMatches - a.verifiedMatches
    );

  if (!ranking.length) {
    await replyAs(ctx, 'general', 
      '🏆 <b>RANKING SEGA</b>\n\n' +
      'Ainda não há jogadores com pelo menos 5 partidas verificadas para montar o ranking com uma amostra mínima.\n\n' +
      '📸 Envie telas finais das partidas pelo botão <b>Enviar print</b>. Assim que houver partidas válidas, o ranking aparece aqui.',
      { parse_mode: 'HTML', ...mainKeyboard() }
    );
    return;
  }

  await replyAs(ctx, 'ranking', 
    renderRanking(ranking),
    { parse_mode: 'HTML', ...mainKeyboard() }
  );
}

bot.command('ranking', sendRanking);
bot.command('clan', sendClan);
bot.command('lore', async (ctx) => await replyAs(ctx, 'general', '📜 <b>CRÔNICAS DO SEGA</b>\n\n🌎 O Land of Dawn reúne heróis, regiões, ordens e conflitos que se cruzam em novas batalhas.\n\n⚔️ Saber: precisão e evolução.\n🛡️ Tigreal: liderança e união.\n🔥 Alucard: persistência diante da adversidade.\n🎯 Layla: alcance e poder de fogo.\n\nNo SEGA, cada jogador escreve sua própria história e o clã escreve o capítulo inteiro.\n\n✨ <i>Da arena para o placar. Do jogador para a lenda.</i>', { parse_mode: 'HTML', ...mainKeyboard() }));

async function sendStats(ctx) {
  const records = await getPlayerScreenshots(ctx.from.id);
  const summary = summarizePlayerScreenshots(records);
  const player = authenticatedPlayers.get(ctx.from.id);

  if (!summary.verifiedMatches) {
    await replyAs(ctx, 'general', 
      '📊 <b>SUAS ESTATÍSTICAS</b>\n\n' +
      'Ainda não tenho nenhuma partida <b>verificada</b> salva para você.\n\n' +
      (summary.rejectedMatches
        ? '🚫 Há <b>' + summary.rejectedMatches + '</b> print(s) rejeitado(s) por não corresponderem ao nick atual da conta.\n\n'
        : '') +
      '📸 Envie a <b>tela final da partida</b> pelo botão <b>Enviar print</b>. ' +
      'Depois que o nick for confirmado e os dados forem lidos, suas estatísticas passam a ser montadas daqui.',
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('📸 ENVIAR PRINT AGORA', 'send_print')]
        ])
      }
    );
    return;
  }

  await replyAs(ctx, 'stats', 
    renderPlayerStats(summary, player?.name),
    { parse_mode: 'HTML', ...mainKeyboard() }
  );
}

bot.command('stats', sendStats);


async function reverifyPendingPrints(telegramId, player, limit = 5) {
  if (!player?.jwt) return 0;
  const records = await getPlayerScreenshots(telegramId);
  const pending = records
    .filter(record =>
      record.verification === 'pending_api_confirmation' &&
      record.kind === 'match_result' &&
      record.parsed?.battleId
    )
    .slice(0, limit);

  let verified = 0;
  for (const record of pending) {
    try {
      const result = await battleBelongsToPlayer(
        player.jwt,
        player.roleId,
        player.zoneId,
        record.parsed.battleId
      );
      if (!result.verified) continue;

      const parsed = normalizeVerifiedMatch(result.match, result.matchId, record.parsed);
      await updateScreenshotVerification(telegramId, record.id, 'verified_match', {
        parsed,
        verificationReason: result.reason,
        verifiedAt: new Date().toISOString(),
        verifiedSid: result.sid
      });
      verified += 1;
    } catch (error) {
      console.warn('⚠️ Falha ao reverificar print ' + record.id + ':', error?.message || error);
    }
  }
  return verified;
}

bot.command('prints', async (ctx) => {
  const player = authenticatedPlayers.get(ctx.from.id);
  if (!player?.jwt) {
    await replyAs(ctx, 'general', '📸 <b>COLETA DE PARTIDAS</b>\n\nVocê ainda não tem um jogador vinculado. Use /cadastrar primeiro.', { parse_mode: 'HTML' });
    return;
  }

  const reverified = await reverifyPendingPrints(ctx.from.id, player);
  const records = await getPlayerScreenshots(ctx.from.id);
  const summary = summarizePlayerScreenshots(records);

  await replyAs(ctx, 'general', 
    '📸 <b>DADOS COLETADOS</b>\n\n' +
    '🖼️ Screenshots recebidos: <b>' + summary.screenshots + '</b>\n' +
    '⚔️ Partidas verificadas: <b>' + summary.verifiedMatches + '</b>\n' +
    (reverified ? '🔄 Reverificadas agora: <b>' + reverified + '</b>\n' : '') +
    '⏳ Pendentes: <b>' + summary.pendingMatches + '</b>\n' +
    '🚫 Rejeitadas: <b>' + summary.rejectedMatches + '</b>\n' +
    '♻️ Duplicados: <b>' + summary.duplicates + '</b>\n' +
    '🏆 Vitórias: <b>' + summary.wins + '</b>\n' +
    '💀 Derrotas: <b>' + summary.losses + '</b>\n' +
    '⚔️ K/D/A somado: <b>' + summary.kills + '/' + summary.deaths + '/' + summary.assists + '</b>\n\n' +
    '<i>Os prints e os dados extraídos ficam guardados no volume do bot.</i>',
    { parse_mode: 'HTML', ...mainKeyboard() }
  );
});

function isBotReply(ctx) {
  const reply = ctx.message?.reply_to_message;
  return Boolean(reply && ctx.botInfo?.id && reply.from?.id === ctx.botInfo.id);
}

function hasPrintTrigger(ctx) {
  if (ctx.chat?.type === 'private') return true;
  if (!isGroupChat(ctx)) return false;
  const caption = String(ctx.message?.caption || '');
  return /#print\b/i.test(caption) || isBotReply(ctx);
}

function isImageDocument(ctx) {
  return String(ctx.message?.document?.mime_type || '').startsWith('image/');
}

function shouldProcessScreenshot(ctx) {
  if (ctx.message?.photo?.length) return hasPrintTrigger(ctx);
  if (isImageDocument(ctx)) return hasPrintTrigger(ctx);
  return false;
}

async function handleScreenshot(ctx) {
  const player = authenticatedPlayers.get(ctx.from.id);

  // Em grupos, prints só entram quando o usuário explicitamente marca #print
  // ou responde a uma mensagem do bot. Memes e fotos comuns ficam silenciosos.
  if (isGroupChat(ctx) && !hasPrintTrigger(ctx)) return;

  if (!player?.jwt) {
    if (isGroupChat(ctx)) return;
    await replyAs(ctx, 'print',
      '📸 <b>PRINT DE PARTIDA</b>\n\n' +
      'Primeiro vincule seu jogador com /cadastrar. Depois pode mandar os prints aqui que eu vou guardar e extrair os dados.',
      { parse_mode: 'HTML' }
    );
    return;
  }

  const lastOcr = ocrCooldownByUser.get(Number(ctx.from.id)) || 0;
  if (Date.now() - lastOcr < OCR_COOLDOWN_MS) {
    const remaining = Math.ceil((OCR_COOLDOWN_MS - (Date.now() - lastOcr)) / 1000);
    await replyAs(ctx, 'print',
      '⏳ <b>Leitor em cooldown.</b>\n\nAguarde mais ' + remaining + 's antes de enviar outro print.',
      { parse_mode: 'HTML' }
    );
    return;
  }
  ocrCooldownByUser.set(Number(ctx.from.id), Date.now());

  await replyAs(ctx, 'print', '📸 <b>Print recebido.</b>\n\n🔎 Lendo os dados da imagem e salvando no histórico...', { parse_mode: 'HTML' });

  try {
    const info = await apiJson('/user/info?lang=pt', { headers: authHeaders(player.jwt) });
    const liveName = info.response.ok && isApiSuccess(info.body)
      ? profileName(info.body?.data)
      : null;

    if (liveName) {
      player.name = liveName;
      player.nameVerified = true;
      await saveSessions();
    }

    const record = await processScreenshot(ctx, player);

    if (record.ignored) {
      await replyAs(ctx, 'print',
        '🗑️ <b>Print descartado.</b>\n\nNão consegui identificar com segurança uma tela de Mobile Legends. A imagem não foi salva.',
        { parse_mode: 'HTML' }
      );
      return;
    }

    const parsed = record.parsed || {};

    if (record.duplicate) {
      await updateScreenshotVerification(ctx.from.id, record.id, 'duplicate');
      await replyAs(ctx, 'print',
        '♻️ <b>PRINT DUPLICADO</b>\n\nEsse print ou Battle ID já foi registrado e confirmado. Não vou contar a mesma partida duas vezes.',
        { parse_mode: 'HTML', ...mainKeyboard() }
      );
      return;
    }

    if (!liveName) {
      await updateScreenshotVerification(ctx.from.id, record.id, 'pending_name_confirmation');
      await replyAs(ctx, 'print',
        '⏳ <b>PRINT AINDA NÃO CONTABILIZADO</b>\n\nNão consegui confirmar seu nick atual na conta agora. Deixei o print pendente para nova verificação.',
        { parse_mode: 'HTML', ...mainKeyboard() }
      );
      return;
    }

    const rowScore = Number(record.parsed?.playerRowIdentityScore || 0);
    const rowNameOk = Boolean(
      record.parsed?.playerRowFound &&
      record.parsed?.playerRowAccepted !== false &&
      record.parsed?.kda &&
      rowScore >= 0.68
    );
    const nameOk = nickMatches(liveName, record.ocrText, record.ocrLines) || rowNameOk;

    // Para uma tela final de partida, a API é a fonte de verdade da identidade.
    // O OCR do nick pode falhar por resolução, fonte, símbolos ou compressão do Telegram.
    // Só rejeitamos pelo nick quando não existe uma confirmação independente da partida.
    if (parsed.kind === 'profile' && !nameOk) {
      await updateScreenshotVerification(ctx.from.id, record.id, 'rejected_name_mismatch');
      await replyAs(ctx, 'print',
        '🚫 <b>PRINT NÃO CONTABILIZADO</b>\n\nO nick encontrado na imagem não corresponde ao nick atual confirmado da sua conta: <b>' +
        escapeHtml(liveName) + '</b>.\n\nEsse print foi guardado apenas para auditoria, mas não entra nas suas estatísticas nem no ranking.',
        { parse_mode: 'HTML', ...mainKeyboard() }
      );
      return;
    }

    if (parsed.kind === 'battles' && !nameOk) {
      await updateScreenshotVerification(ctx.from.id, record.id, 'rejected_name_mismatch');
      await replyAs(ctx, 'print',
        '🚫 <b>PRINT NÃO CONTABILIZADO</b>\n\nO nick encontrado na imagem não corresponde ao nick atual confirmado da sua conta: <b>' +
        escapeHtml(liveName) + '</b>.\n\nEsse print foi guardado apenas para auditoria, mas não entra nas suas estatísticas nem no ranking.',
        { parse_mode: 'HTML', ...mainKeyboard() }
      );
      return;
    }

    if (parsed.kind === 'profile' && String(record.ocrText || '').includes(String(player.roleId))) {
      await updateScreenshotVerification(ctx.from.id, record.id, 'verified_profile');
      await replyAs(ctx, 'print',
        '📊 <b>Print de perfil detectado!</b>\n\nEsse tipo de tela foi salvo como snapshot de conferência e não conta como partida individual.',
        { parse_mode: 'HTML', ...mainKeyboard() }
      );
      return;
    }

    if (parsed.kind === 'battles') {
      await updateScreenshotVerification(ctx.from.id, record.id, 'verified_battles_snapshot');
      await replyAs(ctx, 'print',
        '📋 <b>Tela de Batalhas detectada!</b>\n\nO histórico foi guardado como snapshot de conferência. Para registrar uma partida, prefira a tela final.',
        { parse_mode: 'HTML', ...mainKeyboard() }
      );
      return;
    }

    if (parsed.kind !== 'match_result') {
      await updateScreenshotVerification(ctx.from.id, record.id, 'name_match');
      await replyAs(ctx, 'print',
        '🗂️ <b>Print armazenado.</b>\n\nAinda não consegui classificar essa tela como uma partida com segurança.',
        { parse_mode: 'HTML', ...mainKeyboard() }
      );
      return;
    }

    if (!parsed.battleId) {
      await updateScreenshotVerification(ctx.from.id, record.id, 'pending_api_confirmation', {
        verificationReason: 'battle_id_not_detected'
      });
      await replyAs(ctx, 'print',
        '⏳ <b>PARTIDA PENDENTE</b>\n\nIdentifiquei uma tela de resultado, mas não encontrei o Battle ID. Sem ele não vou usar o K/D/A do OCR para o ranking.',
        { parse_mode: 'HTML', ...mainKeyboard() }
      );
      return;
    }

    let verification;
    try {
      verification = await battleBelongsToPlayer(
        player.jwt,
        player.roleId,
        player.zoneId,
        parsed.battleId
      );
    } catch (error) {
      console.warn('⚠️ API de histórico indisponível; usando fallback OCR:', error?.message || error);
      verification = { verified: false, reason: 'history_api_error' };
    }

    // Se a API estiver fora do ar, a tela final ainda pode ser contabilizada
    // quando o OCR conseguiu provar os três sinais fortes: nick da conta,
    // Battle ID e K/D/A. O OCR vira a fonte dos números; a API deixa de ser
    // um bloqueio operacional.
    if (!verification.verified) {
      const ocrStrongIdentity =
        Boolean(nameOk) &&
        Boolean(parsed.battleId) &&
        Boolean(parsed.kda) &&
        ['win', 'loss'].includes(parsed.result);

      if (ocrStrongIdentity) {
        const ocrVerifiedParsed = {
          ...parsed,
          source: 'ocr_fallback',
          verificationMode: 'ocr_identity_battle_id',
          verificationReason: verification.reason || 'history_api_unavailable'
        };

        const ocrRecord = await updateScreenshotVerification(
          ctx.from.id,
          record.id,
          'verified_ocr',
          {
            parsed: ocrVerifiedParsed,
            verificationReason: verification.reason || 'history_api_unavailable',
            verifiedAt: new Date().toISOString()
          }
        );

        const finalOcr = ocrRecord?.parsed || ocrVerifiedParsed;
        await replyAs(ctx, 'print',
          '✅ <b>PARTIDA VALIDADA PELO OCR</b>\n\n' +
          '🔢 Battle ID: <code>' + escapeHtml(finalOcr.battleId) + '</code>\n' +
          (finalOcr.result === 'win' ? '🏆 Resultado: <b>VITÓRIA</b>\n' : '💀 Resultado: <b>DERROTA</b>\n') +
          '📊 K/D/A: <b>' + finalOcr.kda.kills + '/' + finalOcr.kda.deaths + '/' + finalOcr.kda.assists + '</b>\n' +
          '\n⚠️ A API de histórico não respondeu (<code>' + escapeHtml(verification.reason || 'indisponível') + '</code>). ' +
          'Usei a confirmação visual do seu nick + Battle ID + resultado para não perder a partida.',
          { parse_mode: 'HTML', ...mainKeyboard() }
        );
        return;
      }

      await updateScreenshotVerification(ctx.from.id, record.id, 'pending_api_confirmation', {
        verificationReason: verification.reason,
        ocrFallback: {
          nameMatch: Boolean(nameOk),
          rowNameMatch: Boolean(rowNameOk),
          rowIdentityScore: rowScore,
          rowDetected: Boolean(parsed.playerRowFound),
          hasBattleId: Boolean(parsed.battleId),
          hasKda: Boolean(parsed.kda),
          result: parsed.result || null
        }
      });
      const candidateInfo = Array.isArray(record.parsed?.playerRowCandidates)
        ? record.parsed.playerRowCandidates
          .slice(0, 5)
          .map(item => {
            const side = item.side || '?';
            const row = Number.isInteger(item.rowIndex) ? item.rowIndex + 1 : '?';
            return side + '/' + row + '=' + Number(item.identityScore || 0).toFixed(2);
          })
          .join(' • ')
        : 'sem candidatos';

      await replyAs(ctx, 'print',
        '⏳ <b>PARTIDA NÃO CONTABILIZADA AINDA</b>\n\n' +
        'A API não respondeu e o OCR não encontrou sinais suficientes para validar a partida com segurança.\n\n' +
        '🔎 <b>Diagnóstico:</b> nick=' + (nameOk ? 'OK' : 'não') +
        ' • Battle ID=' + (parsed.battleId ? 'OK' : 'não') +
        ' • KDA=' + (parsed.kda ? 'OK' : 'não') +
        ' • resultado=' + (parsed.result || 'não') + '\n' +
        '📍 Linhas: <code>' + escapeHtml(candidateInfo) + '</code>\n\n' +
        'Envie novamente o print da tela final inteira, com seu nick, Battle ID e K/D/A visíveis.',
        { parse_mode: 'HTML', ...mainKeyboard() }
      );
      return;
    }

    const verifiedParsed = normalizeVerifiedMatch(verification.match, verification.matchId, parsed);
    const verifiedRecord = await updateScreenshotVerification(
      ctx.from.id,
      record.id,
      'verified_match',
      {
        parsed: verifiedParsed,
        verificationReason: verification.reason,
        verifiedAt: new Date().toISOString(),
        verifiedSid: verification.sid
      }
    );

    const finalParsed = verifiedRecord?.parsed || verifiedParsed;
    await replyAs(ctx, 'print',
      '✅ <b>PARTIDA VERIFICADA</b>\n\n' +
      (finalParsed.result === 'win' ? '🏆 Resultado: <b>VITÓRIA</b>\n' : finalParsed.result === 'loss' ? '💀 Resultado: <b>DERROTA</b>\n' : '') +
      '📊 K/D/A: <b>' + finalParsed.kda.kills + '/' + finalParsed.kda.deaths + '/' + finalParsed.kda.assists + '</b>\n' +
      (finalParsed.hero ? '🦸 Herói: <b>' + escapeHtml(finalParsed.hero) + '</b>\n' : '') +
      (finalParsed.score != null ? '⭐ Pontuação: <b>' + Number(finalParsed.score).toFixed(1) + '</b>\n' : '') +
      '\n🛡️ Os números da API foram usados como fonte de verdade; o OCR serviu apenas para localizar e validar a tela.',
      { parse_mode: 'HTML', ...mainKeyboard() }
    );
  } catch (error) {
    console.error('❌ Erro ao processar screenshot:', error);
    await replyAs(ctx, 'print',
      '⚠️ Recebi o print, mas o leitor não conseguiu processá-lo agora. Tente novamente com a tela inteira e boa resolução.',
      { parse_mode: 'HTML' }
    );
  }
}

bot.on('photo', async (ctx, next) => {
  if (!shouldProcessScreenshot(ctx)) return next();
  await handleScreenshot(ctx);
});

bot.on('document', async (ctx, next) => {
  if (!shouldProcessScreenshot(ctx)) return next();
  await handleScreenshot(ctx);
});

async function isKnowledgeAdmin(ctx) {
  if (KNOWLEDGE_ADMIN_IDS.has(String(ctx.from?.id || ''))) return true;
  if (!isGroupChat(ctx)) return false;
  try {
    const member = await ctx.telegram.getChatMember(ctx.chat.id, ctx.from.id);
    return member.status === 'creator' || member.status === 'administrator';
  } catch {
    return false;
  }
}

bot.command('conhecimento', async (ctx) => {
  const summary = knowledgeSummary();
  await replyAs(ctx, 'general', 
    '🧠 <b>CONHECIMENTO SEGA</b>\n\n' +
    '🎮 Heróis reconhecidos: <b>' + summary.heroes + '</b>\n' +
    '🧠 Matchups locais: <b>' + summary.detailedHeroes + '</b>\n' +
    '🛡️ Itens cadastrados: <b>' + summary.items + '</b>\n' +
    '📦 Versão da base: <b>' + summary.version + '</b>\n\n' +
    'Posso entender perguntas sobre counters, itens, dicas, função e rota.\n\n' +
    listKnowledgeExamples().map(item => '• ' + item).join('\n'),
    { parse_mode: 'HTML' }
  );
});

bot.command('perguntas', async (ctx) => {
  if (!(await isKnowledgeAdmin(ctx))) {
    await replyAs(ctx, 'general', '🔐 Esse relatório é reservado aos administradores do SEGA.');
    return;
  }
  const report = await getQuestionReport(15);
  const top = report.top.length
    ? report.top.map(item => item.rank + '. <code>' + escapeHtml(item.question) + '</code> — ' + item.count + 'x').join('\n')
    : 'Ainda não há perguntas registradas.';
  await replyAs(ctx, 'general', 
    '📚 <b>PERGUNTAS DO SEGA</b>\n\n' +
    '📝 Total: <b>' + report.total + '</b>\n' +
    '✅ Respondidas: <b>' + report.answered + '</b>\n' +
    '❓ Não respondidas: <b>' + report.unanswered + '</b>\n\n' +
    '<b>Mais frequentes:</b>\n' + top,
    { parse_mode: 'HTML' }
  );
});

bot.command('ajuda', sendHelp);
bot.command('tutorial', sendHelp);

bot.action('ranking', async (ctx) => { await ctx.answerCbQuery(); await sendRanking(ctx); });
bot.action('clan', async (ctx) => { await ctx.answerCbQuery(); await sendClan(ctx); });
bot.action('lore', async (ctx) => {
  await ctx.answerCbQuery();
  await replyAs(ctx, 'general', '📜 <b>CRÔNICAS DO SEGA</b>\n\n🌎 O Land of Dawn reúne heróis, regiões, ordens e conflitos que se cruzam em novas batalhas.\n\n⚔️ Saber: precisão e evolução.\n🛡️ Tigreal: liderança e união.\n🔥 Alucard: persistência diante da adversidade.\n🎯 Layla: alcance e poder de fogo.\n\nNo SEGA, cada jogador escreve sua própria história e o clã escreve o capítulo inteiro.\n\n✨ <i>Da arena para o placar. Do jogador para a lenda.</i>', { parse_mode: 'HTML', ...mainKeyboard() });
});

bot.action('stats', async (ctx) => {
  await ctx.answerCbQuery();
  await sendStats(ctx);
});

bot.action('send_print', async (ctx) => {
  await ctx.answerCbQuery();
  await sendPrintInstructions(ctx);
});

bot.action('help', async (ctx) => { await ctx.answerCbQuery(); await sendHelp(ctx); });
bot.hears(/@sega(?:[ _]?stats)?(?:[ _]?bot)?\b/i, async (ctx) => {
  const question = ctx.message?.text || '';
  const answer = await answerMlbbQuestion(question);
  try {
    await logQuestion({
      telegramId: ctx.from?.id || null,
      chatId: ctx.chat?.id || null,
      question: question.slice(0, 500),
      normalizedQuestion: question.toLowerCase().replace(/@sega(?:[ _]?stats)?(?:[ _]?bot)?/i, '').replace(/\s+/g, ' ').trim().slice(0, 300),
      answered: Boolean(answer)
    });
  } catch (error) {
    console.error('⚠️ Não foi possível registrar pergunta:', error);
  }
  if (answer) {
    await replyAs(ctx, 'general', answer, { parse_mode: 'HTML' });
  } else {
    await replyAs(ctx, 'general', 
      '🧠 <b>SEGA Stats ainda não entendeu essa pergunta.</b>\n\n' +
      'Tente uma destas formas:\n' +
      listKnowledgeExamples().map(item => '• ' + item).join('\n') +
      '\n\n📌 A pergunta foi registrada para podermos ampliar o conhecimento do bot.',
      { parse_mode: 'HTML' }
    );
  }
});
bot.hears('📝 Cadastrar jogador', async (ctx) => await askForRoleId(ctx));
bot.hears('📊 Minhas stats', sendStats);
bot.hears('🏆 Ranking', sendRanking);
bot.hears('📸 Enviar print', sendPrintInstructions);
async function handleBattleId(ctx, battleId) {
  const player = authenticatedPlayers.get(ctx.from.id);
  if (!player?.jwt) {
    await replyAs(ctx, 'general', '🔐 Primeiro vincule seu jogador com /cadastrar.');
    return;
  }

  const cleanId = String(battleId || '').replace(/[^0-9]/g, '');
  if (!/^\d{10,18}$/.test(cleanId)) {
    await replyAs(ctx, 'general', '⚠️ Battle ID inválido. Envie somente o número da partida.');
    return;
  }

  await replyAs(ctx, 'general', '🔎 Consultando o Battle ID na API da comunidade...');

  try {
    const verification = await battleBelongsToPlayer(
      player.jwt,
      player.roleId,
      player.zoneId,
      cleanId
    );

    if (!verification.verified) {
      await replyAs(ctx, 'general',
        '⏳ <b>PARTIDA NÃO CONFIRMADA</b>\n\n' +
        'A API não conseguiu confirmar esse Battle ID como uma partida da sua conta.\n' +
        '<code>' + escapeHtml(cleanId) + '</code>\n\n' +
        'Motivo: <code>' + escapeHtml(verification.reason) + '</code>',
        { parse_mode: 'HTML', ...mainKeyboard() }
      );
      return;
    }

    const verifiedParsed = normalizeVerifiedMatch(
      verification.match,
      verification.matchId,
      { kind: 'match_result', battleId: cleanId }
    );
    const record = await recordVerifiedBattle(ctx.from.id, player, verifiedParsed);

    if (record.duplicate) {
      await replyAs(ctx, 'general',
        '♻️ <b>PARTIDA JÁ CONTABILIZADA</b>\n\nEsse Battle ID já foi confirmado anteriormente. Não contei novamente.',
        { parse_mode: 'HTML', ...mainKeyboard() }
      );
      return;
    }

    await replyAs(ctx, 'general',
      '✅ <b>PARTIDA VERIFICADA</b>\n\n' +
      '🔢 Battle ID: <code>' + escapeHtml(cleanId) + '</code>\n' +
      (verifiedParsed.result === 'win' ? '🏆 Resultado: <b>VITÓRIA</b>\n' : verifiedParsed.result === 'loss' ? '💀 Resultado: <b>DERROTA</b>\n' : '') +
      '📊 K/D/A: <b>' + verifiedParsed.kda.kills + '/' + verifiedParsed.kda.deaths + '/' + verifiedParsed.kda.assists + '</b>\n' +
      (verifiedParsed.hero ? '🦸 Herói: <b>' + escapeHtml(verifiedParsed.hero) + '</b>\n' : '') +
      '\n🛡️ Dados confirmados pela API da comunidade; não foi necessário enviar print.',
      { parse_mode: 'HTML', ...mainKeyboard() }
    );
  } catch (error) {
    console.error('❌ Erro ao validar Battle ID:', error);
    await replyAs(ctx, 'general', '⚠️ Não consegui consultar esse Battle ID agora. Tente novamente em alguns instantes.', { ...mainKeyboard() });
  }
}

bot.hears('🔢 Enviar Battle ID', async (ctx) => { await replyAs(ctx, 'general', '🔢 Envie agora o número do Battle ID.\n\nExemplo: <code>1234567890123456</code>', { parse_mode: 'HTML', ...mainKeyboard() }); });
bot.command('battle', async (ctx) => { await handleBattleId(ctx, String(ctx.message?.text || '').replace(/^\/battle(?:@\w+)?\s*/i, '')); });
bot.hears(/^\d{10,18}$/, async (ctx) => { await handleBattleId(ctx, ctx.message.text); });

bot.hears('📋 Dados coletados', async (ctx) => { const player = authenticatedPlayers.get(ctx.from.id); if (!player?.jwt) { await replyAs(ctx, 'general', '📸 Use /cadastrar primeiro.'); return; } const records = await getPlayerScreenshots(ctx.from.id); const summary = summarizePlayerScreenshots(records); await replyAs(ctx, 'general', '📋 <b>DADOS COLETADOS</b>\n\n🖼️ Prints: <b>' + summary.screenshots + '</b>\n⚔️ Partidas identificadas: <b>' + summary.matchResults + '</b>\n🏆 Vitórias: <b>' + summary.wins + '</b>\n💀 Derrotas: <b>' + summary.losses + '</b>\n📊 K/D/A: <b>' + summary.kills + '/' + summary.deaths + '/' + summary.assists + '</b>', { parse_mode: 'HTML', ...mainKeyboard() }); });
bot.hears('👥 Clã SEGA', sendClan);
bot.hears('❓ Ajuda', sendHelp);
bot.hears('📜 Lore', async (ctx) => await replyAs(ctx, 'general', '📜 <b>CRÔNICAS DO SEGA</b>\n\nCada jogador escreve uma parte da história. O clã escreve o capítulo inteiro. ⚔️', { parse_mode: 'HTML', ...mainKeyboard() }));

bot.catch((error) => console.error('❌ Erro no bot:', error));

if (process.env.RAILWAY_ENVIRONMENT && PERSISTENCE_REQUIRED && !persistenceIsAvailable()) {
  console.error('🚨 ARQUIVOS DE DADOS NÃO ESTÃO EM VOLUME PERSISTENTE.');
  console.error('🚨 Monte um Railway Volume em /app/data antes de iniciar o bot.');
  await notifyPersistenceProblem();
  process.exit(1);
}

await restoreSessions();
await restoreRegistrations();
await restoreGroupBanters(bot.telegram);
await cleanupScreenshots();
console.log('💾 Diretório de dados: ' + DATA_DIR);
console.log('💾 Arquivo de sessão: ' + SESSION_FILE);
console.log('📝 Arquivo de cadastros pendentes: ' + REGISTRATION_FILE);
if (!HAS_PERSISTENT_VOLUME && process.env.RAILWAY_ENVIRONMENT) {
  console.warn('⚠️ Railway sem volume persistente detectado. Cadastros, prints e estatísticas serão perdidos em um redeploy. Anexe um Volume e monte em /app/data ou /data.');
}

bot.launch(() => {
  console.log('🎮 SEGA Stats Bot online!');
}).catch((error) => {
  console.error('❌ Falha ao iniciar o bot:', error);
  process.exitCode = 1;
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
