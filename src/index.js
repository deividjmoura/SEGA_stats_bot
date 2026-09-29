import 'dotenv/config';
import { Telegraf, Markup } from 'telegraf';
import { promises as fs } from 'node:fs';
import crypto from 'node:crypto';

const token = process.env.BOT_TOKEN;
const RONE_API = 'https://arena.rone.dev/api';
const SESSION_FILE = './data/sessions.json';
const SESSION_KEY = crypto.createHash('sha256').update(token || '').digest();

if (!token) {
  console.error('❌ BOT_TOKEN não configurado. Crie um arquivo .env com o token do BotFather.');
  process.exit(1);
}

const bot = new Telegraf(token);
const registration = new Map();
const authenticatedPlayers = new Map();

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
  await fs.mkdir('./data', { recursive: true });
  const stored = {};
  for (const [telegramId, player] of authenticatedPlayers) {
    stored[telegramId] = {
      jwt: encrypt(player.jwt),
      roleId: player.roleId,
      zoneId: player.zoneId,
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
        zoneId: player.zoneId
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
  { command: 'ajuda', description: 'Mostrar ajuda' },
  { command: 'cancelar', description: 'Cancelar cadastro' }
]).catch((error) => console.error('❌ Erro ao registrar comandos:', error));

const startMessage = `🎮 <b>SEGA STATS BOT</b>

Fala, guerreiro! 👊

Bem-vindo ao bot oficial do clã <b>SEGA</b>.

Aqui você vai poder:

🏆 Consultar o ranking do clã
⚔️ Ver suas partidas e desempenho
🛡️ Conferir sua rota mais jogada
📊 Acompanhar seus pontos e estatísticas
👥 Comparar seu desempenho com a galera do clã

<b>Para começar:</b>
👉 Use <code>/cadastrar</code> para vincular seu jogador.

Bora descobrir quem realmente carrega nesse clã. 😎🔥`;

const helpMessage = `📚 <b>COMANDOS DO SEGA STATS</b>

🎮 <code>/start</code> — abrir o menu principal
📝 <code>/cadastrar</code> — cadastrar seu jogador
🏆 <code>/ranking</code> — ranking do clã
📊 <code>/stats</code> — suas estatísticas
❓ <code>/ajuda</code> — mostrar esta ajuda
❌ <code>/cancelar</code> — cancelar cadastro`;

function askForRoleId(ctx) {
  registration.set(ctx.from.id, { step: 'role_id' });
  return ctx.reply('📝 <b>CADASTRO DO JOGADOR</b>\n\nMe manda agora o <b>ID do Mobile Legends</b> (Role ID).\n\nExemplo: <code>123456789</code>', { parse_mode: 'HTML' });
}

bot.start(async (ctx) => {
  await ctx.reply(startMessage, {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('📝 Cadastrar jogador', 'register')],
      [Markup.button.callback('🏆 Ranking', 'ranking'), Markup.button.callback('📊 Minhas stats', 'stats')],
      [Markup.button.callback('❓ Ajuda', 'help')]
    ])
  });
});

bot.command('cadastrar', async (ctx) => await askForRoleId(ctx));

bot.command('cancelar', async (ctx) => {
  registration.delete(ctx.from.id);
  await ctx.reply('❌ Cadastro cancelado. Nenhuma alteração foi feita.');
});

bot.on('text', async (ctx) => {
  const state = registration.get(ctx.from.id);
  if (!state || ctx.message.text.startsWith('/')) return;

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
      const response = await fetch(`${RONE_API}/user/auth/send-vc`, {
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
      const response = await fetch(`${RONE_API}/user/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role_id: Number(roleId), zone_id: Number(zoneId), vc: Number(value) })
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok || body.code !== 0 || !body.data?.jwt) {
        console.error('❌ Falha na autenticação:', response.status, body);
        await ctx.reply('❌ <b>Não foi possível validar o código.</b>\n\nVerifique se você digitou o código corretamente e se ele ainda está dentro do prazo de validade (5 minutos).', { parse_mode: 'HTML' });
        return;
      }

      const jwt = body.data.jwt;
      const infoResponse = await fetch(`${RONE_API}/user/info`, { headers: { Authorization: `Bearer ${jwt}` } });
      const infoBody = await infoResponse.json().catch(() => ({}));

      if (!infoResponse.ok || infoBody.code !== 0) {
        console.error('❌ Login realizado, mas não consegui consultar o perfil:', infoResponse.status, infoBody);
        registration.delete(ctx.from.id);
        await ctx.reply('⚠️ A autenticação foi concluída, mas a API não confirmou o perfil agora. Nenhuma sessão foi salva. Tente novamente em alguns instantes.', { parse_mode: 'HTML' });
        return;
      }

      authenticatedPlayers.set(ctx.from.id, { jwt, roleId, zoneId });
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
      await ctx.reply('⚠️ Ocorreu um erro ao validar o código. Tente novamente.');
    }
  }
});

bot.action('register', async (ctx) => {
  await ctx.answerCbQuery();
  await askForRoleId(ctx);
});

bot.command('ranking', async (ctx) => {
  await ctx.reply('🏆 O ranking do clã será conectado à API na próxima etapa.');
});

async function sendStats(ctx) {
  const player = authenticatedPlayers.get(ctx.from.id);

  if (!player?.jwt) {
    await ctx.reply('📊 <b>SUAS ESTATÍSTICAS</b>\n\nVocê ainda não tem uma sessão autenticada neste bot. Use /cadastrar para vincular seu jogador.', { parse_mode: 'HTML' });
    return;
  }

  await ctx.reply('📊 <b>Buscando suas estatísticas...</b>', { parse_mode: 'HTML' });

  try {
    const infoResponse = await fetch(`${RONE_API}/user/info`, {
      headers: { Authorization: `Bearer ${player.jwt}` }
    });
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

    const response = await fetch(`${RONE_API}/user/stats`, {
      headers: { Authorization: `Bearer ${player.jwt}` }
    });
    const body = await response.json().catch(() => ({}));

    if (response.status === 401 || response.status === 403) {
      console.error('❌ /user/stats rejeitou o JWT:', response.status, body);
      await ctx.reply('🔐 <b>A API rejeitou a sessão ao consultar as estatísticas.</b>\n\nUse /cadastrar para renovar a autenticação.', { parse_mode: 'HTML' });
      return;
    }

    if (!response.ok || body.code !== 0 || !body.data) {
      console.error('❌ Erro da API de stats:', response.status, body);
      await ctx.reply('⚠️ <b>A autenticação está válida, mas a API de estatísticas não retornou os dados.</b>\n\nTente novamente em alguns instantes.', { parse_mode: 'HTML' });
      return;
    }

    const stats = body.data;
    const matches = Number(stats.tc ?? 0);
    const wins = Number(stats.wc ?? 0);
    const losses = Math.max(matches - wins, 0);
    const winRate = matches > 0 ? ((wins / matches) * 100).toFixed(1) : '0.0';
    const avgScore = stats.as != null ? Number(stats.as).toFixed(1) : 'N/D';

    await ctx.reply(
      '📊 <b>SUAS ESTATÍSTICAS</b>\n\n' +
      `🎮 Partidas: <b>${matches}</b>\n` +
      `🏆 Vitórias: <b>${wins}</b>\n` +
      `💀 Derrotas: <b>${losses}</b>\n` +
      `📈 Win rate: <b>${winRate}%</b>\n` +
      `⭐ Pontuação média: <b>${avgScore}</b>\n` +
      `👑 MVPs: <b>${stats.mvpc ?? 0}</b>\n` +
      `🔥 Maior sequência de vitórias: <b>${stats.wsc ?? 0}</b>`,
      { parse_mode: 'HTML' }
    );
  } catch (error) {
    console.error('❌ Erro ao consultar stats:', error);
    await ctx.reply('⚠️ Não foi possível consultar a API agora. Tente novamente em alguns instantes.');
  }
}

bot.command('stats', sendStats);

bot.command('ajuda', async (ctx) => {
  await ctx.reply(helpMessage, { parse_mode: 'HTML' });
});

bot.action('ranking', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply('🏆 O ranking entra na próxima etapa, usando os dados da API.');
});

bot.action('stats', async (ctx) => {
  await ctx.answerCbQuery();
  await sendStats(ctx);
});

bot.action('help', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(helpMessage, { parse_mode: 'HTML' });
});

bot.catch((error) => console.error('❌ Erro no bot:', error));

await restoreSessions();

bot.launch().then(() => {
  console.log('🎮 SEGA Stats Bot online!');
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
