import 'dotenv/config';
import { Telegraf, Markup } from 'telegraf';
import { promises as fs } from 'node:fs';
import crypto from 'node:crypto';
import { dirname } from 'node:path';
import { processScreenshot, getPlayerScreenshots, summarizePlayerScreenshots, updateScreenshotVerification } from './screenshotStats.js';

const token = process.env.BOT_TOKEN;
const RONE_API = 'https://arena.rone.dev/api';
const SESSION_FILE = process.env.SESSION_FILE || ((process.env.RAILWAY_VOLUME_MOUNT_PATH || './data') + '/sessions.json');
const API_TIMEOUT_MS = 12000;
const SESSION_KEY = crypto.createHash('sha256').update(token || '').digest();

if (!token) {
  console.error('❌ BOT_TOKEN não configurado. Crie um arquivo .env com o token do BotFather.');
  process.exit(1);
}

const bot = new Telegraf(token);
const registration = new Map();
const authenticatedPlayers = new Map();

async function apiFetch(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    return await fetch(RONE_API + path, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function apiJson(path, options = {}) {
  const response = await apiFetch(path, options);
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

function authHeaders(jwt) {
  return { Authorization: 'Bearer ' + jwt };
}

function normalizeNick(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function nickMatches(expected, text) {
  const target = normalizeNick(expected);
  if (!target || target.length < 3) return false;

  // Nicks muito curtos não devem validar por simples substring.
  // Para 3-4 caracteres exigimos um token inteiro no OCR.
  const compact = String(text || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ');
  const words = compact.split(/\s+/).filter(Boolean);

  if (target.length <= 4) {
    return words.includes(target);
  }

  const source = normalizeNick(text);
  if (source.includes(target)) return true;
  return words.some(word => word.length >= 4 && (target.includes(word) || word.includes(target)));
}

function sameId(a, b) {
  return String(a ?? '').trim() === String(b ?? '').trim();
}

async function battleBelongsToPlayer(jwt, roleId, zoneId, battleId) {
  if (!battleId) return { verified: false, reason: 'battle_id_not_detected' };

  try {
    const season = await apiJson('/user/season?lang=pt', { headers: authHeaders(jwt) });
    const sids = Array.isArray(season.body?.data?.sids) ? season.body.data.sids : [];
    if (!season.response.ok || season.body?.code !== 0 || !sids.length) {
      return { verified: false, reason: 'history_api_unavailable' };
    }

    // Os IDs longos devem ser tratados como strings. JavaScript perde precisão
    // em números inteiros muito grandes, então usamos bid_s sempre que existir.
    for (const sid of sids.slice(0, 8)) {
      let cursor = '';
      for (let page = 0; page < 8; page += 1) {
        const query =
          '/user/matches?sid=' + encodeURIComponent(sid) +
          '&limit=50' +
          (cursor ? '&last_cursor=' + encodeURIComponent(cursor) : '') +
          '&lang=pt';

        const response = await apiJson(query, { headers: authHeaders(jwt) });
        if (!response.response.ok || response.body?.code !== 0) break;

        const rows = Array.isArray(response.body?.data?.result) ? response.body.data.result : [];
        const match = rows.find(row => sameId(row.bid_s ?? row.bid, battleId));

        if (match) {
          const matchId = String(match.bid_s ?? match.bid ?? battleId);
          const details = await apiJson(
            '/user/matches/' + encodeURIComponent(matchId) +
            '?sid=' + encodeURIComponent(sid) + '&lang=pt',
            { headers: authHeaders(jwt) }
          );

          if (!details.response.ok || details.body?.code !== 0) {
            return { verified: false, reason: 'match_details_unavailable', sid, matchId };
          }

          const participants = Array.isArray(details.body?.data?.result)
            ? details.body.data.result
            : [];

          const owner = participants.find(row =>
            sameId(row.rid, roleId) && sameId(row.zid, zoneId)
          );

          if (!owner) {
            return { verified: false, reason: 'account_not_in_match', sid, matchId };
          }

          return {
            verified: true,
            reason: 'battle_and_account_confirmed',
            sid,
            matchId,
            match: owner
          };
        }

        const pageInfo = response.body?.data?.pageInfo || {};
        if (!pageInfo.hasNext || !pageInfo.nextCursor) break;
        cursor = String(pageInfo.nextCursor);
      }
    }

    return { verified: false, reason: 'battle_id_not_found' };
  } catch (error) {
    console.error('❌ Falha ao validar Battle ID:', error);
    return { verified: false, reason: 'history_api_error' };
  }
}

function isGroupChat(ctx) {
  return ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup';
}

let cachedBotUsername = null;
async function getBotUsername() {
  if (cachedBotUsername) return cachedBotUsername;
  try {
    const me = await ctxBotGetMe();
    cachedBotUsername = me.username || null;
  } catch {
    cachedBotUsername = null;
  }
  return cachedBotUsername;
}

async function ctxBotGetMe() {
  return bot.telegram.getMe();
}

async function requirePrivateChat(ctx) {
  if (!isGroupChat(ctx)) return true;
  const username = await getBotUsername();
  const link = username ? 'https://t.me/' + username : 'o chat privado deste bot';
  await ctx.reply(
    '🔐 <b>Cadastro é feito no privado.</b>\n\n' +
    'Para proteger seu Role ID, Zone ID e o código de verificação, abra o chat privado do SEGA Stats e use <code>/cadastrar</code> por lá.\n\n' +
    (username ? '👉 <a href="' + link + '">Abrir SEGA Stats</a>' : '👉 Abra o chat privado do bot pelo perfil acima.'),
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

function decrypt(payload) {
  const data = Buffer.from(payload, 'base64');
  const iv = data.subarray(0, 12);
  const tag = data.subarray(12, 28);
  const encrypted = data.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', SESSION_KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

async function saveSessions() {
  await fs.mkdir(dirname(SESSION_FILE), { recursive: true });
  const stored = {};
  for (const [telegramId, player] of authenticatedPlayers) {
    stored[telegramId] = {
      jwt: encrypt(player.jwt),
      roleId: player.roleId,
      zoneId: player.zoneId,
      name: player.name || null,
      savedAt: new Date().toISOString()
    };
  }
  await fs.writeFile(SESSION_FILE, JSON.stringify(stored, null, 2), 'utf8');
}

async function restoreSessions() {
  try {
    const raw = await fs.readFile(SESSION_FILE, 'utf8');
    const stored = JSON.parse(raw);
    for (const [telegramId, player] of Object.entries(stored)) {
      authenticatedPlayers.set(Number(telegramId), {
        jwt: decrypt(player.jwt),
        roleId: player.roleId,
        zoneId: player.zoneId,
        name: player.name || null
      });
    }
    console.log(`🔐 Sessões restauradas: ${authenticatedPlayers.size}`);
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('❌ Erro ao restaurar sessões:', error);
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
  { command: 'prints', description: 'Ver dados coletados por screenshots' }
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

const helpMessage = `📚 <b>COMANDOS DO SEGA STATS</b>

🎮 <code>/start</code> — abrir o menu principal
📝 <code>/cadastrar</code> — cadastrar seu jogador
🏆 <code>/ranking</code> — ranking do clã
📊 <code>/stats</code> — suas estatísticas
❓ <code>/ajuda</code> — mostrar esta ajuda
👥 <code>/clan</code> — painel do clã SEGA
📜 <code>/lore</code> — crônicas e heróis
❌ <code>/cancelar</code> — cancelar cadastro
📸 <code>/prints</code> — ver o que o bot já coletou por screenshots`;


function parseMatchStats(matches) {
  const rows = Array.isArray(matches) ? matches : [];
  const total = rows.length;
  const wins = rows.filter(m => Number(m.res) === 1).length;
  const mvps = rows.filter(m => Number(m.mvp) === 1).length;
  const kills = rows.reduce((sum, m) => sum + Number(m.k || 0), 0);
  const deaths = rows.reduce((sum, m) => sum + Number(m.d || 0), 0);
  const assists = rows.reduce((sum, m) => sum + Number(m.a || 0), 0);
  const scores = rows.map(m => Number(m.s || 0)).filter(Number.isFinite);
  const avgScore = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length / 100 : 0;
  const heroes = new Map();
  for (const m of rows) {
    const name = m.hid_e?.n || String(m.hid || 'Desconhecido');
    heroes.set(name, (heroes.get(name) || 0) + 1);
  }
  const mostPlayed = [...heroes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 'N/D';
  return { matches: total, wins, losses: Math.max(total - wins, 0), mvps, kills, deaths, assists, avgScore, mostPlayed };
}

async function fetchPlayerStats(jwt) {
  // Preferir /user/stats quando disponível (ainda funciona em muitos casos, apesar de deprecated).
  const direct = await apiJson('/user/stats?lang=pt', { headers: authHeaders(jwt) });
  if (direct.response.ok && direct.body.code === 0 && direct.body.data) {
    const data = direct.body.data;
    // Se vier com totais úteis, usa direto.
    if (data.tc != null || data.wc != null) {
      return { source: 'stats', data };
    }
  }

  // Fallback: montar estatísticas a partir da temporada + partidas recentes.
  // IMPORTANTE: a API só aceita lang=pt (não pt_BR).
  const season = await apiJson('/user/season?lang=pt', { headers: authHeaders(jwt) });
  const sids = Array.isArray(season.body?.data?.sids) ? season.body.data.sids : [];
  if (!season.response.ok || season.body?.code !== 0 || sids.length === 0) {
    console.error('❌ Fallback season falhou:', season.response?.status, season.body);
    return {
      source: 'error',
      response: season.response?.ok === false ? season.response : direct.response,
      body: season.body?.code !== 0 ? season.body : direct.body
    };
  }

  // Tenta a temporada mais recente e, se vier vazia, as anteriores.
  let lastError = null;
  for (const sid of sids.slice(0, 3)) {
    const matches = await apiJson(
      '/user/matches?sid=' + encodeURIComponent(sid) + '&limit=50&lang=pt',
      { headers: authHeaders(jwt) }
    );

    if (!matches.response.ok || matches.body?.code !== 0) {
      lastError = { response: matches.response, body: matches.body };
      console.error('❌ Matches sid=' + sid + ' falhou:', matches.response?.status, matches.body);
      continue;
    }

    const rows = matches.body?.data?.result;
    if (Array.isArray(rows) && rows.length > 0) {
      return { source: 'matches', data: parseMatchStats(rows), sid };
    }

    // Temporada sem partidas — tenta a próxima.
    lastError = { response: matches.response, body: matches.body };
  }

  // Nenhuma temporada retornou partidas. Se /user/stats tinha algo, usa mesmo assim.
  if (direct.response.ok && direct.body.code === 0 && direct.body.data) {
    return { source: 'stats', data: direct.body.data };
  }

  return {
    source: 'error',
    response: lastError?.response || direct.response,
    body: lastError?.body || direct.body
  };
}

function renderStats(data) {
  const matches = Number(data.matches ?? data.tc ?? 0);
  const wins = Number(data.wins ?? data.wc ?? 0);
  const losses = Number(data.losses ?? Math.max(matches - wins, 0));
  const winRate = matches > 0 ? ((wins / matches) * 100).toFixed(1) : '0.0';
  // API /user/stats devolve `as` em escala x100; o fallback por partidas já normaliza em avgScore.
  let avgScore = 'N/D';
  if (data.avgScore != null && Number.isFinite(Number(data.avgScore))) {
    avgScore = Number(data.avgScore).toFixed(1);
  } else if (data.as != null && Number.isFinite(Number(data.as))) {
    const raw = Number(data.as);
    avgScore = (raw > 20 ? raw / 100 : raw).toFixed(1);
  }
  const mvps = data.mvps ?? data.mvpc ?? 0;
  const kda = data.kills != null ? (data.kills + '/' + data.deaths + '/' + data.assists) : 'N/D';
  const mostPlayed = data.mostPlayed
    || data.mo?.hid_e?.n
    || data.ms?.hid_e?.n
    || null;
  return '📊 <b>SUAS ESTATÍSTICAS</b>\n\n' +
    '🎮 Partidas: <b>' + matches + '</b>\n' +
    '🏆 Vitórias: <b>' + wins + '</b>\n' +
    '💀 Derrotas: <b>' + losses + '</b>\n' +
    '📈 Win rate: <b>' + winRate + '%</b>\n' +
    '⚔️ K/D/A: <b>' + kda + '</b>\n' +
    '⭐ Pontuação média: <b>' + avgScore + '</b>\n' +
    '👑 MVPs: <b>' + mvps + '</b>\n' +
    (mostPlayed ? '🎯 Herói mais usado: <b>' + mostPlayed + '</b>\n' : '') +
    '\n<i>SEGA: cada partida escreve uma linha da história.</i>';
}

function mainKeyboard() {
  return Markup.keyboard([
    ['📝 Cadastrar jogador', '📊 Minhas stats'],
    ['🏆 Ranking', '👥 Clã SEGA'],
    ['📸 Enviar print', '📋 Dados coletados'],
    ['❓ Ajuda', '📜 Lore']
  ]).resize().persistent();
}

function askForRoleId(ctx) {
  registration.set(ctx.from.id, { step: 'role_id' });
  return ctx.reply('📝 <b>CADASTRO DO JOGADOR</b>\n\nMe manda agora o <b>ID do Mobile Legends</b> (Role ID).\n\nExemplo: <code>123456789</code>', { parse_mode: 'HTML' });
}

async function sendMenu(ctx) {
  await ctx.reply(startMessage, { parse_mode: 'HTML', ...mainKeyboard() });
  await ctx.reply('⚡ <b>AÇÕES RÁPIDAS</b>', {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('📝 Cadastrar jogador', 'register')],
      [Markup.button.callback('📊 Minhas stats', 'stats'), Markup.button.callback('🏆 Ranking', 'ranking')],
      [Markup.button.callback('👥 Clã SEGA', 'clan'), Markup.button.callback('📜 Lore', 'lore')],
      [Markup.button.callback('❓ Ajuda', 'help')]
    ])
  });
}

bot.start(async (ctx) => await sendMenu(ctx));
bot.command('menu', async (ctx) => await sendMenu(ctx));

bot.command('cadastrar', async (ctx) => await askForRoleId(ctx));

bot.command('cancelar', async (ctx) => {
  registration.delete(ctx.from.id);
  await ctx.reply('❌ Cadastro cancelado. Nenhuma alteração foi feita.');
});

bot.on('text', async (ctx, next) => {
  const state = registration.get(ctx.from.id);

  // Este handler trata somente as respostas do fluxo de cadastro.
  // Comandos como /stats e /ranking precisam seguir para os handlers abaixo.
  if (!state || ctx.message.text.startsWith('/')) {
    await next();
    return;
  }

  const value = ctx.message.text.trim();

  if (state.step === 'role_id') {
    if (!/^\d{6,12}$/.test(value)) {
      await ctx.reply('⚠️ Esse ID não parece válido. Envie somente os números do seu ID do Mobile Legends.');
      return;
    }
    registration.set(ctx.from.id, { step: 'zone_id', roleId: value });
    await ctx.reply('🌐 Agora me manda o <b>Zone ID</b> do seu jogador.\n\nExemplo: <code>1234</code>', { parse_mode: 'HTML' });
    return;
  }

  if (state.step === 'zone_id') {
    if (!/^\d{1,8}$/.test(value)) {
      await ctx.reply('⚠️ Zone ID inválido. Envie somente os números do seu Zone ID.');
      return;
    }

    const { roleId } = state;
    await ctx.reply('🔎 <b>Solicitando código de verificação...</b>\n\n📩 Um código será enviado para o correio interno do Mobile Legends.\n⏱️ O código é válido por 5 minutos.', { parse_mode: 'HTML' });

    try {
      const response = await apiFetch('/user/auth/send-vc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role_id: Number(roleId), zone_id: Number(value) })
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok || body.code !== 0) {
        console.error('❌ Falha ao solicitar código:', response.status, body);
        await ctx.reply('⚠️ Não consegui solicitar o código de verificação agora. Confira o ID e o Zone ID e tente novamente.');
        registration.delete(ctx.from.id);
        return;
      }

      registration.set(ctx.from.id, { step: 'verification_code', roleId, zoneId: value });
      await ctx.reply(
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
      registration.delete(ctx.from.id);
      await ctx.reply('⚠️ Não consegui conectar ao serviço de autenticação agora. Tente novamente.');
    }
    return;
  }

  if (state.step === 'verification_code') {
    if (!/^\d{4,8}$/.test(value)) {
      await ctx.reply('⚠️ Código inválido. Envie somente os números do código recebido no correio do Mobile Legends.');
      return;
    }

    const { roleId, zoneId } = state;
    await ctx.reply('🔐 <b>Validando o código...</b>', { parse_mode: 'HTML' });

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
      const ok = response.ok && (body.code === 0 || body.code === '0') && jwt;

      if (!ok) {
        const apiMsg = body?.msg || body?.message || body?.detail || '';
        console.error('❌ Falha na autenticação:', response.status, JSON.stringify(body), 'payload=', payload);
        let reply =
          '❌ <b>Não foi possível validar o código.</b>\n\n' +
          'Verifique se você digitou o código corretamente e se ele ainda está dentro do prazo de validade (5 minutos).\n\n' +
          'Você pode enviar o código novamente ou digitar /cancelar para recomeçar.';
        if (apiMsg) {
          reply += '\n\n📋 Detalhe da API: <code>' + String(apiMsg).slice(0, 150) + '</code>';
        }
        await ctx.reply(reply, { parse_mode: 'HTML' });
        return;
      }

      const infoResponse = await apiFetch('/user/info', { headers: { Authorization: 'Bearer ' + jwt } });
      const infoBody = await infoResponse.json().catch(() => ({}));

      if (!infoResponse.ok || (infoBody.code !== 0 && infoBody.code !== '0')) {
        console.error('❌ Login realizado, mas não consegui consultar o perfil:', infoResponse.status, infoBody);
        await ctx.reply('⚠️ A autenticação retornou token, mas a API não confirmou o perfil agora. Tente novamente em alguns instantes ou envie o código de novo.', { parse_mode: 'HTML' });
        return;
      }

      authenticatedPlayers.set(ctx.from.id, { jwt, roleId, zoneId, name: infoBody.data?.name || 'Jogador' });
      await saveSessions();
      registration.delete(ctx.from.id);

      await ctx.reply(
        '✅ <b>CONTA VERIFICADA!</b>\n\n' +
        `👤 <b>${infoBody.data?.name ?? 'Jogador'}</b>\n` +
        `🆔 ID: <code>${roleId}</code>\n` +
        `🌐 Zone: <code>${zoneId}</code>\n\n` +
        '📊 Seu jogador foi vinculado ao <b>SEGA Stats</b>. Agora podemos consultar seus dados para gerar suas estatísticas e participar dos rankings do clã.',
        { parse_mode: 'HTML' }
      );
    } catch (error) {
      console.error('❌ Erro ao autenticar jogador:', error);
      await ctx.reply('⚠️ Ocorreu um erro de conexão ao validar o código. Tente novamente em alguns segundos.');
    }
  }
});

bot.action('register', async (ctx) => {
  await ctx.answerCbQuery();
  await askForRoleId(ctx);
});

async function sendClan(ctx) {
  const count = authenticatedPlayers.size;
  await ctx.reply('👥 <b>CLÃ SEGA</b>\n\n🛡️ Jogadores vinculados: <b>' + count + '</b>\n\nO próximo passo é transformar os dados individuais em estatísticas coletivas do clã.\n\n⚔️ <i>Uma equipe forte não depende de um único herói.</i>', { parse_mode: 'HTML', ...mainKeyboard() });
}

async function sendRanking(ctx) {
  const players = [...authenticatedPlayers.entries()];

  if (!players.length) {
    await ctx.reply(
      '🏆 <b>RANKING SEGA</b>\n\nAinda não há jogadores autenticados no clã.\n\nUse /cadastrar para vincular seu jogador.',
      { parse_mode: 'HTML', ...mainKeyboard() }
    );
    return;
  }

  await ctx.reply('🏆 <b>Calculando o ranking do SEGA...</b>\n\n⚔️ Consultando os dados dos jogadores vinculados.', { parse_mode: 'HTML' });

  const results = await Promise.allSettled(
    players.map(async ([telegramId, player]) => {
      const info = await apiJson('/user/info', { headers: authHeaders(player.jwt) });
      if (!info.response.ok || info.body?.code !== 0) return null;
      player.name = info.body.data?.name || player.name || 'Jogador';

      const stats = await fetchPlayerStats(player.jwt);
      if (stats.source === 'error') return null;

      const data = stats.data;
      const matches = Number(data.matches ?? data.tc ?? 0);
      const wins = Number(data.wins ?? data.wc ?? 0);
      const winRate = matches > 0 ? (wins / matches) * 100 : 0;
      let avgScore = Number(data.avgScore ?? 0);
      if (!avgScore && data.as != null) {
        const raw = Number(data.as);
        avgScore = raw > 20 ? raw / 100 : raw;
      }

      return {
        telegramId,
        name: info.body.data?.name || 'Jogador',
        matches,
        wins,
        winRate,
        avgScore,
        mvps: Number(data.mvps ?? data.mvpc ?? 0)
      };
    })
  );

  await saveSessions();

  const ranking = results
    .filter(result => result.status === 'fulfilled' && result.value)
    .map(result => result.value)
    .sort((a, b) =>
      b.winRate - a.winRate ||
      b.wins - a.wins ||
      b.avgScore - a.avgScore ||
      b.matches - a.matches
    );

  if (!ranking.length) {
    await ctx.reply(
      '⚠️ <b>RANKING SEGA</b>\n\nOs jogadores estão autenticados, mas a API não retornou estatísticas suficientes para montar o ranking agora.\n\nA autenticação continua válida. Tente novamente em alguns instantes.',
      { parse_mode: 'HTML', ...mainKeyboard() }
    );
    return;
  }

  const lines = ranking.slice(0, 10).map((player, index) => {
    const medal = ['🥇', '🥈', '🥉'][index] || '🏅';
    return medal + ' <b>' + (index + 1) + '. ' + player.name + '</b>\n' +
      '   📈 ' + player.winRate.toFixed(1) + '% WR  •  🏆 ' + player.wins + '/' + player.matches +
      '  •  ⭐ ' + player.avgScore.toFixed(1);
  });

  await ctx.reply(
    '🏆 <b>RANKING SEGA</b>\n\n' +
    lines.join('\n\n') +
    '\n\n<i>Ranking calculado com os dados disponíveis na API.</i>',
    { parse_mode: 'HTML', ...mainKeyboard() }
  );
}

bot.command('ranking', sendRanking);
bot.command('clan', sendClan);
bot.command('lore', async (ctx) => await ctx.reply('📜 <b>CRÔNICAS DO SEGA</b>\n\n🌎 O Land of Dawn reúne heróis, regiões, ordens e conflitos que se cruzam em novas batalhas.\n\n⚔️ Saber: precisão e evolução.\n🛡️ Tigreal: liderança e união.\n🔥 Alucard: persistência diante da adversidade.\n🎯 Layla: alcance e poder de fogo.\n\nNo SEGA, cada jogador escreve sua própria história e o clã escreve o capítulo inteiro.\n\n✨ <i>Da arena para o placar. Do jogador para a lenda.</i>', { parse_mode: 'HTML', ...mainKeyboard() }));

async function sendStats(ctx) {
  const player = authenticatedPlayers.get(ctx.from.id);

  if (!player?.jwt) {
    await ctx.reply('📊 <b>SUAS ESTATÍSTICAS</b>\n\nVocê ainda não tem uma sessão autenticada neste bot. Use /cadastrar para vincular seu jogador.', { parse_mode: 'HTML' });
    return;
  }

  await ctx.reply('📊 <b>Buscando suas estatísticas...</b>', { parse_mode: 'HTML' });

  try {
    const infoResponse = await apiFetch('/user/info', { headers: authHeaders(player.jwt) });
    const infoBody = await infoResponse.json().catch(() => ({}));

    if (infoResponse.status === 401 || infoResponse.status === 403) {
      authenticatedPlayers.delete(ctx.from.id);
      await saveSessions();
      await ctx.reply('🔐 <b>Sua autenticação expirou ou foi invalidada.</b>\n\nUse /cadastrar para autenticar novamente.', { parse_mode: 'HTML' });
      return;
    }

    if (!infoResponse.ok || infoBody.code !== 0) {
      console.error('❌ Falha ao validar sessão:', infoResponse.status, infoBody);
      await ctx.reply('⚠️ A API respondeu com erro ao validar sua sessão. Tente novamente em alguns instantes.');
      return;
    }

    player.name = infoBody.data?.name || player.name || 'Jogador';
    await saveSessions();

    const statsResult = await fetchPlayerStats(player.jwt);

    if (statsResult.source === 'error') {
      const status = statsResult.response?.status;
      if (status === 401 || status === 403) {
        authenticatedPlayers.delete(ctx.from.id);
        await saveSessions();
        await ctx.reply('🔐 <b>A autenticação foi rejeitada pela API.</b>\n\nUse /cadastrar para autenticar novamente.', { parse_mode: 'HTML' });
        return;
      }
      const apiMsg = statsResult.body?.message || statsResult.body?.msg || '';
      console.error('❌ Erro da API de stats:', status, statsResult.body);
      await ctx.reply(
        '⚠️ <b>Sua autenticação está válida, mas a API de estatísticas não retornou os dados.</b>\n\n' +
        'O bot tentou /user/stats e o fallback por temporada/partidas.\n' +
        (apiMsg ? ('Detalhe da API: <code>' + String(apiMsg).slice(0, 120) + '</code>\n\n') : '') +
        'Verifique se o histórico de batalhas está <b>público</b> nas configurações de privacidade do Mobile Legends e tente de novo.',
        { parse_mode: 'HTML' }
      );
      return;
    }

    await ctx.reply(renderStats(statsResult.data), { parse_mode: 'HTML', ...mainKeyboard() });

  } catch (error) {
    console.error('❌ Erro ao consultar stats:', error);
    await ctx.reply('⚠️ Não foi possível consultar a API agora. Tente novamente em alguns instantes.');
  }
}

bot.command('stats', sendStats);


bot.command('prints', async (ctx) => {
  const player = authenticatedPlayers.get(ctx.from.id);
  if (!player?.jwt) {
    await ctx.reply('📸 <b>COLETA DE PARTIDAS</b>\n\nVocê ainda não tem um jogador vinculado. Use /cadastrar primeiro.', { parse_mode: 'HTML' });
    return;
  }

  const records = await getPlayerScreenshots(ctx.from.id);
  const summary = summarizePlayerScreenshots(records);

  await ctx.reply(
    '📸 <b>DADOS COLETADOS</b>\n\n' +
    '🖼️ Screenshots recebidos: <b>' + summary.screenshots + '</b>\n' +
    '⚔️ Partidas verificadas: <b>' + summary.verifiedMatches + '</b>\n' +
    '⏳ Pendentes: <b>' + summary.pendingMatches + '</b>\n' +
    '🚫 Rejeitadas: <b>' + summary.rejectedMatches + '</b>\n' +
    '🏆 Vitórias: <b>' + summary.wins + '</b>\n' +
    '💀 Derrotas: <b>' + summary.losses + '</b>\n' +
    '⚔️ K/D/A somado: <b>' + summary.kills + '/' + summary.deaths + '/' + summary.assists + '</b>\n\n' +
    '<i>Os prints e os dados extraídos ficam guardados no volume do bot.</i>',
    { parse_mode: 'HTML', ...mainKeyboard() }
  );
});

bot.on('photo', async (ctx, next) => {
  const player = authenticatedPlayers.get(ctx.from.id);

  if (!player?.jwt) {
    await ctx.reply(
      '📸 <b>PRINT DE PARTIDA</b>\n\n' +
      'Primeiro vincule seu jogador com /cadastrar. Depois pode mandar os prints aqui que eu vou guardar e extrair os dados.',
      { parse_mode: 'HTML' }
    );
    return;
  }

  await ctx.reply('📸 <b>Print recebido.</b>\n\n🔎 Lendo os dados da imagem e salvando no histórico...', { parse_mode: 'HTML' });

  try {
    const info = await apiJson('/user/info', { headers: authHeaders(player.jwt) });
    const currentName = info.body?.data?.name || player.name || 'Jogador';
    if (info.response.ok && info.body?.code === 0) {
      player.name = currentName;
      await saveSessions();
    }

    const record = await processScreenshot(ctx, player);
    const parsed = record.parsed || {};

    if (record.duplicate) {
      await updateScreenshotVerification(ctx.from.id, record.id, 'duplicate');
      await ctx.reply(
        '♻️ <b>PRINT DUPLICADO</b>\n\n' +
        'Esse print ou Battle ID já foi registrado para sua conta. Não vou contar a mesma partida duas vezes.',
        { parse_mode: 'HTML', ...mainKeyboard() }
      );
      return;
    }

    const nameOk = nickMatches(currentName, record.ocrText);
    let verification = nameOk ? 'name_match' : 'rejected_name_mismatch';

    if (parsed.kind === 'profile' && String(record.ocrText || '').includes(String(player.roleId))) {
      verification = nameOk ? 'verified_profile' : 'rejected_name_mismatch';
    } else if (parsed.kind === 'match_result' && parsed.battleId && nameOk) {
      const battleCheck = await battleBelongsToPlayer(player.jwt, player.roleId, player.zoneId, parsed.battleId);
      verification = battleCheck.verified ? 'verified_match' : 'pending_api_confirmation';
    }

    await updateScreenshotVerification(ctx.from.id, record.id, verification);

    let detail;
    if (verification === 'duplicate') {
      detail = '♻️ <b>Esse print já foi registrado.</b>\nNão vou contar a mesma partida duas vezes.';
    } else if (parsed.kind === 'match_result') {
      detail =
        '⚔️ <b>Partida detectada!</b>\n' +
        (parsed.result === 'win' ? '🏆 Resultado: <b>VITÓRIA</b>\n' : parsed.result === 'loss' ? '💀 Resultado: <b>DERROTA</b>\n' : '') +
        (parsed.kda ? '📊 K/D/A: <b>' + parsed.kda.kills + '/' + parsed.kda.deaths + '/' + parsed.kda.assists + '</b>\n' : '') +
        (parsed.score != null ? '⭐ Pontuação: <b>' + parsed.score + '</b>\n' : '');
    } else if (parsed.kind === 'profile') {
      detail =
        '📊 <b>Print geral detectado!</b>\n' +
        (parsed.winRate != null ? '📈 Win rate lido: <b>' + parsed.winRate + '%</b>\n' : '') +
        'Esse tipo de print serve como <b>snapshot geral</b>; ele não conta como uma partida individual.';
    } else {
      detail =
        '🗂️ <b>Print armazenado.</b>\n' +
        'Ainda não consegui classificar essa tela com segurança. Os dados brutos foram guardados para melhorarmos o leitor.';
    }

    await ctx.reply(
      '✅ <b>DADO REGISTRADO NO SEGA</b>\n\n' +
      detail +
      '\n\n🧠 O OCR salvou também o texto lido da imagem para podermos melhorar o parser sem perder o print.',
      { parse_mode: 'HTML', ...mainKeyboard() }
    );
  } catch (error) {
    console.error('❌ Erro ao processar screenshot:', error);
    await ctx.reply(
      '⚠️ Recebi o print, mas o leitor não conseguiu processá-lo agora. A imagem pode não ter sido salva; tente novamente com a tela inteira e boa resolução.',
      { parse_mode: 'HTML' }
    );
  }
});

bot.command('ajuda', async (ctx) => {
  await ctx.reply(helpMessage, { parse_mode: 'HTML' });
});

bot.action('ranking', async (ctx) => { await ctx.answerCbQuery(); await sendRanking(ctx); });
bot.action('clan', async (ctx) => { await ctx.answerCbQuery(); await sendClan(ctx); });
bot.action('lore', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply('📜 <b>CRÔNICAS DO SEGA</b>\n\n🌎 O Land of Dawn reúne heróis, regiões, ordens e conflitos que se cruzam em novas batalhas.\n\n⚔️ Saber: precisão e evolução.\n🛡️ Tigreal: liderança e união.\n🔥 Alucard: persistência diante da adversidade.\n🎯 Layla: alcance e poder de fogo.\n\nNo SEGA, cada jogador escreve sua própria história e o clã escreve o capítulo inteiro.\n\n✨ <i>Da arena para o placar. Do jogador para a lenda.</i>', { parse_mode: 'HTML', ...mainKeyboard() });
});

bot.action('stats', async (ctx) => {
  await ctx.answerCbQuery();
  await sendStats(ctx);
});

bot.action('help', async (ctx) => { await ctx.answerCbQuery(); await ctx.reply(helpMessage, { parse_mode: 'HTML', ...mainKeyboard() }); });
bot.hears('📝 Cadastrar jogador', async (ctx) => await askForRoleId(ctx));
bot.hears('📊 Minhas stats', sendStats);
bot.hears('🏆 Ranking', sendRanking);
bot.hears('📸 Enviar print', async (ctx) => await ctx.reply('📸 <b>ENVIE O PRINT</b>\n\nMande aqui a captura da tela do Mobile Legends. Pode ser o resultado final da partida ou o painel geral de estatísticas.', { parse_mode: 'HTML' }));
bot.hears('📋 Dados coletados', async (ctx) => { const player = authenticatedPlayers.get(ctx.from.id); if (!player?.jwt) { await ctx.reply('📸 Use /cadastrar primeiro.'); return; } const records = await getPlayerScreenshots(ctx.from.id); const summary = summarizePlayerScreenshots(records); await ctx.reply('📋 <b>DADOS COLETADOS</b>\n\n🖼️ Prints: <b>' + summary.screenshots + '</b>\n⚔️ Partidas identificadas: <b>' + summary.matchResults + '</b>\n🏆 Vitórias: <b>' + summary.wins + '</b>\n💀 Derrotas: <b>' + summary.losses + '</b>\n📊 K/D/A: <b>' + summary.kills + '/' + summary.deaths + '/' + summary.assists + '</b>', { parse_mode: 'HTML', ...mainKeyboard() }); });
bot.hears('👥 Clã SEGA', sendClan);
bot.hears('❓ Ajuda', async (ctx) => await ctx.reply(helpMessage, { parse_mode: 'HTML', ...mainKeyboard() }));
bot.hears('📜 Lore', async (ctx) => await ctx.reply('📜 <b>CRÔNICAS DO SEGA</b>\n\nCada jogador escreve uma parte da história. O clã escreve o capítulo inteiro. ⚔️', { parse_mode: 'HTML', ...mainKeyboard() }));

bot.catch((error) => console.error('❌ Erro no bot:', error));

await restoreSessions();
console.log('💾 Arquivo de sessão: ' + SESSION_FILE);

bot.launch().then(() => {
  console.log('🎮 SEGA Stats Bot online!');
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
