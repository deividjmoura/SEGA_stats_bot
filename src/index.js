import http from 'node:http';
import { Telegraf } from 'telegraf';

import {
  BOT_TOKEN,
  PORT,
  SESSION_FILE,
  WEBHOOK_URL,
  WEBHOOK_SECRET,
  WEBHOOK_PATH,
  REGISTRATION_TTL_MS,
  ADMIN_ID,
  HAS_PERSISTENT_DISK,
  API_BASES
} from './config.js';
import { apiJson, authHeaders, jsonHeaders, currentBase } from './api.js';
import {
  authenticatedPlayers,
  knownPlayers,
  restoreSessions,
  saveSessions,
  rememberPlayer,
  expireSession,
  forgetPlayer
} from './sessions.js';
import { fetchPlayerStats, normalizeStats, readUserName } from './stats.js';
import {
  BUTTONS,
  BUTTON_LABELS,
  startMessage,
  helpMessage,
  loreMessage,
  mainKeyboard,
  quickActionsKeyboard,
  renderStats,
  escapeHtml,
  html,
  privacyNotice,
  loadingStatsMessage,
  loadingRankingMessage
} from './ui.js';

if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN não configurado. Defina a variável de ambiente BOT_TOKEN (BotFather).');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN, { handlerTimeout: 10 * 60_000 });

/** telegramId -> { step, roleId, zoneId, expiresAt } */
const registration = new Map();

function setRegistration(userId, state) {
  registration.set(userId, { ...state, expiresAt: Date.now() + REGISTRATION_TTL_MS });
}

function getRegistration(userId) {
  const state = registration.get(userId);
  if (!state) return null;
  if (state.expiresAt < Date.now()) {
    registration.delete(userId);
    return null;
  }
  return state;
}

// Limpeza periódica para não vazar memória em execuções longas.
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [userId, state] of registration) {
    if (state.expiresAt < now) registration.delete(userId);
  }
}, 60_000);
cleanupTimer.unref();

/**
 * O indicador "digitando..." do Telegram expira em ~5s. Como a API do MLBB pode
 * levar minutos, mantemos o indicador vivo até a resposta chegar.
 */
function keepTyping(ctx) {
  const send = () => ctx.replyWithChatAction('typing').catch(() => {});
  send();
  const timer = setInterval(send, 4000);
  timer.unref?.();
  return () => clearInterval(timer);
}

/** Sessão inválida: some com o JWT mas guarda ID/Zone para o próximo login. */
async function dropSession(userId) {
  expireSession(userId);
  await saveSessions();
}

/** Mensagem padrão de sessão expirada, já oferecendo o relogin curto. */
function expiredSessionMessage(userId) {
  const known = knownPlayers.get(userId);
  if (known) {
    return (
      '🔐 <b>Sua sessão com o Mobile Legends expirou.</b>\n\n' +
      `Seus dados seguem salvos aqui (ID <code>${escapeHtml(String(known.roleId))}</code>).\n\n` +
      '👉 Use /entrar para receber um novo código — <b>não precisa digitar seus IDs de novo</b>.'
    );
  }
  return '🔐 <b>Sua autenticação expirou.</b>\n\nUse /cadastrar para vincular seu jogador.';
}

// ---------------------------------------------------------------- menus

async function sendMenu(ctx) {
  await ctx.reply(startMessage, html(mainKeyboard()));
  await ctx.reply('⚡ <b>AÇÕES RÁPIDAS</b>', html(quickActionsKeyboard()));
}

async function sendHelp(ctx) {
  await ctx.reply(helpMessage, html(mainKeyboard()));
}

async function sendLore(ctx) {
  await ctx.reply(loreMessage, html(mainKeyboard()));
}

async function sendClan(ctx) {
  const count = authenticatedPlayers.size;
  await ctx.reply(
    '👥 <b>CLÃ SEGA</b>\n\n' +
      `🛡️ Jogadores vinculados: <b>${count}</b>\n\n` +
      (count
        ? 'Use /ranking para ver a classificação atual do clã.'
        : 'Ninguém vinculado ainda. Use /cadastrar para ser o primeiro.') +
      '\n\n⚔️ <i>Uma equipe forte não depende de um único herói.</i>',
    html(mainKeyboard())
  );
}

// ---------------------------------------------------------------- cadastro

/** Reenvia o código usando os IDs já salvos — sem redigitar nada. */
async function quickLogin(ctx) {
  const known = knownPlayers.get(ctx.from.id);
  if (!known) {
    await ctx.reply(
      'Ainda não conheço seu jogador. Use /cadastrar para vincular pela primeira vez.',
      html(mainKeyboard())
    );
    return;
  }
  await requestVerificationCode(ctx, known.roleId, String(known.zoneId));
}

function askForRoleId(ctx) {
  setRegistration(ctx.from.id, { step: 'role_id' });
  return ctx.reply(
    '📝 <b>CADASTRO DO JOGADOR</b>\n\n' +
      'Me manda agora o <b>ID do Mobile Legends</b> (Role ID).\n\n' +
      'Exemplo: <code>123456789</code>\n\n' +
      'Digite /cancelar a qualquer momento para sair.',
    html()
  );
}

async function handleRoleId(ctx, value) {
  if (!/^\d{6,12}$/.test(value)) {
    await ctx.reply('⚠️ Esse ID não parece válido. Envie <b>somente os números</b> do seu ID do Mobile Legends.', html());
    return;
  }
  setRegistration(ctx.from.id, { step: 'zone_id', roleId: value });
  await ctx.reply('🌐 Agora me manda o <b>Zone ID</b> do seu jogador.\n\nExemplo: <code>1234</code>', html());
}

async function handleZoneId(ctx, value, state) {
  if (!/^\d{1,8}$/.test(value)) {
    await ctx.reply('⚠️ Zone ID inválido. Envie <b>somente os números</b> do seu Zone ID.', html());
    return;
  }
  await requestVerificationCode(ctx, state.roleId, value);
}

/**
 * Pede o código de verificação à API e coloca o usuário no passo de digitar o código.
 * Usado tanto no cadastro novo quanto no relogin rápido (/entrar).
 */
async function requestVerificationCode(ctx, roleId, zoneId) {
  await ctx.reply(
    '🔎 <b>Solicitando código de verificação...</b>\n\n' +
      `🆔 ID <code>${escapeHtml(String(roleId))}</code>  •  🌐 Zone <code>${escapeHtml(String(zoneId))}</code>\n\n` +
      '📩 O código chega no correio interno do Mobile Legends.\n⏱️ Validade: 5 minutos.',
    html()
  );

  const result = await apiJson('/user/auth/send-vc', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ role_id: Number(roleId), zone_id: Number(zoneId) })
  });

  if (!result.ok) {
    console.error('❌ send-vc falhou:', result.status, result.message, '|', result.diagnostic);
    registration.delete(ctx.from.id);
    await ctx.reply(explainApiFailure(result, roleId, zoneId), html(mainKeyboard()));
    return;
  }

  setRegistration(ctx.from.id, { step: 'verification_code', roleId, zoneId });
  await ctx.reply(
    '🔐 <b>VERIFICAÇÃO DO JOGADOR</b>\n\n' +
      '📩 O código foi enviado para o <b>correio interno do Mobile Legends</b>.\n\n' +
      '🔢 Quando receber, envie <b>somente o código</b> aqui.\n\n' +
      '🔒 <b>Segurança:</b> nunca pedimos sua senha, e-mail ou códigos de outras plataformas.\n\n' +
      '⏱️ O código é válido por 5 minutos.\n\nDigite /cancelar para desistir.',
    html()
  );
}

/** Traduz a falha da API numa explicação útil, em vez de um "deu erro" genérico. */
function explainApiFailure(result, roleId, zoneId) {
  const header = '⚠️ <b>Não consegui solicitar o código agora.</b>\n\n';

  if (result.status === 0) {
    return (
      header +
      '🌐 A API do MLBB não respondeu (fora do ar ou muito lenta).\n\n' +
      'Isso é do serviço externo, não do seu cadastro. Tente de novo em alguns minutos.'
    );
  }

  if (result.status === 422) {
    return (
      header +
      `O ID <code>${escapeHtml(String(roleId))}</code> ou o Zone <code>${escapeHtml(String(zoneId))}</code> foi recusado.\n\n` +
      'Confira os dois no jogo: <i>Perfil → o número aparece como ID(Zone)</i>, por exemplo <code>907314674(1375)</code>.\n\n' +
      'Depois tente /cadastrar de novo.' +
      (result.message ? `\n\n📋 API: <code>${escapeHtml(result.message).slice(0, 150)}</code>` : '')
    );
  }

  if (result.status === 429) {
    return (
      header +
      '🚦 Muitas tentativas em pouco tempo. A API limitou temporariamente.\n\nEspere uns 10 minutos e tente de novo.'
    );
  }

  return (
    header +
    `A API respondeu <b>HTTP ${result.status}</b>.\n\n` +
    (result.message ? `📋 <code>${escapeHtml(result.message).slice(0, 200)}</code>\n\n` : '') +
    'Se continuar, avise o admin do clã para rodar /diag.'
  );
}

async function handleVerificationCode(ctx, value, state) {
  if (!/^\d{4,8}$/.test(value)) {
    await ctx.reply('⚠️ Código inválido. Envie somente os números do código recebido no correio do Mobile Legends.', html());
    return;
  }

  await ctx.reply('🔐 <b>Validando o código...</b>', html());

  const login = await apiJson('/user/auth/login', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({
      role_id: Number(state.roleId),
      zone_id: Number(state.zoneId),
      vc: Number(value)
    })
  });

  const jwt = login.body?.data?.jwt || login.body?.data?.token || null;

  if (!login.ok || !jwt) {
    console.error('❌ Falha na autenticação:', login.status, login.message);
    await ctx.reply(
      '❌ <b>Não foi possível validar o código.</b>\n\n' +
        'Confira se digitou certo e se ainda está dentro dos 5 minutos de validade.\n\n' +
        'Você pode enviar o código novamente ou digitar /cancelar para recomeçar.' +
        (login.message ? `\n\n📋 API: <code>${escapeHtml(login.message).slice(0, 150)}</code>` : ''),
      html()
    );
    return;
  }

  const info = await apiJson('/user/info', { headers: authHeaders(jwt) });
  if (!info.ok) {
    console.error('❌ Login ok, mas /user/info falhou:', info.status, info.message);
    await ctx.reply(
      '⚠️ A autenticação retornou o token, mas a API não confirmou o perfil agora.\n\nTente novamente em alguns instantes.',
      html()
    );
    return;
  }

  const name = readUserName(info.body) ?? 'Jogador';
  rememberPlayer(ctx.from.id, { jwt, roleId: state.roleId, zoneId: state.zoneId, name });
  await saveSessions();
  registration.delete(ctx.from.id);

  await ctx.reply(
    '✅ <b>CONTA VERIFICADA!</b>\n\n' +
      `👤 <b>${escapeHtml(name)}</b>\n` +
      `🆔 ID: <code>${escapeHtml(state.roleId)}</code>\n` +
      `🌐 Zone: <code>${escapeHtml(state.zoneId)}</code>\n\n` +
      'Seu jogador foi vinculado ao <b>SEGA Stats</b>.\n\n' +
      privacyNotice +
      '\n\n📊 Agora é só usar /stats — a primeira consulta pode levar alguns minutos.',
    html(mainKeyboard())
  );
}

// ---------------------------------------------------------------- stats

async function sendStats(ctx) {
  const player = authenticatedPlayers.get(ctx.from.id);

  if (!player?.jwt) {
    await ctx.reply(expiredSessionMessage(ctx.from.id), html(mainKeyboard()));
    return;
  }

  await ctx.reply(loadingStatsMessage, html());
  const stopTyping = keepTyping(ctx);
  try {
    await runStats(ctx, player);
  } finally {
    stopTyping();
  }
}

async function runStats(ctx, player) {
  const info = await apiJson('/user/info', { headers: authHeaders(player.jwt) });

  if (info.unauthorized) {
    await dropSession(ctx.from.id);
    await ctx.reply(expiredSessionMessage(ctx.from.id), html(mainKeyboard()));
    return;
  }

  if (!info.ok) {
    await ctx.reply(
      `⚠️ A API respondeu com erro ao validar sua sessão.\n\n${escapeHtml(info.message || 'Tente novamente em instantes.')}`,
      html(mainKeyboard())
    );
    return;
  }

  const name = readUserName(info.body) || player.name || null;
  if (name && name !== player.name) {
    rememberPlayer(ctx.from.id, { ...player, name });
    saveSessions();
  }

  const result = await fetchPlayerStats(player.jwt);

  if (result.source === 'error') {
    if (result.unauthorized) {
      await dropSession(ctx.from.id);
      await ctx.reply(expiredSessionMessage(ctx.from.id), html(mainKeyboard()));
      return;
    }

    console.error('❌ Erro da API de stats:', result.status, result.message);
    await ctx.reply(
      '⚠️ <b>Sua sessão está válida, mas a API não retornou estatísticas.</b>\n\n' +
        (result.message ? `📋 Detalhe: <code>${escapeHtml(result.message).slice(0, 150)}</code>\n\n` : '') +
        privacyNotice +
        '\n\nAjuste a privacidade no jogo, aguarde alguns minutos e tente /stats de novo.',
      html(mainKeyboard())
    );
    return;
  }

  await ctx.reply(renderStats(normalizeStats(result.data), name), html(mainKeyboard()));
}

// ---------------------------------------------------------------- ranking

const RANKING_CONCURRENCY = 4;

async function mapWithLimit(items, limit, worker) {
  const results = [];
  let index = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = index++;
      try {
        results[current] = await worker(items[current]);
      } catch (error) {
        console.error('❌ Erro no ranking:', error.message);
        results[current] = null;
      }
    }
  });
  await Promise.all(runners);
  return results;
}

async function sendRanking(ctx) {
  const players = [...authenticatedPlayers.entries()];

  if (!players.length) {
    await ctx.reply(
      '🏆 <b>RANKING SEGA</b>\n\nAinda não há jogadores autenticados no clã.\n\nUse /cadastrar para vincular seu jogador.',
      html(mainKeyboard())
    );
    return;
  }

  await ctx.reply(loadingRankingMessage, html());
  const stopTyping = keepTyping(ctx);
  try {
    await runRanking(ctx, players);
  } finally {
    stopTyping();
  }
}

async function runRanking(ctx, players) {
  const expired = [];

  const rows = await mapWithLimit(players, RANKING_CONCURRENCY, async ([telegramId, player]) => {
    const info = await apiJson('/user/info', { headers: authHeaders(player.jwt) });
    if (info.unauthorized) {
      expired.push(telegramId);
      return null;
    }
    if (!info.ok) return null;

    const stats = await fetchPlayerStats(player.jwt);
    if (stats.source === 'error') {
      if (stats.unauthorized) expired.push(telegramId);
      return null;
    }

    const s = normalizeStats(stats.data);
    return {
      name: readUserName(info.body) || player.name || 'Jogador',
      matches: s.matches,
      wins: s.wins,
      winRate: s.winRate,
      avgScore: s.avgScore ?? 0,
      mvps: s.mvps
    };
  });

  if (expired.length) {
    for (const telegramId of expired) expireSession(telegramId);
    await saveSessions();
  }

  const ranking = rows
    .filter(Boolean)
    .filter((p) => p.matches > 0)
    .sort(
      (a, b) => b.winRate - a.winRate || b.wins - a.wins || b.avgScore - a.avgScore || b.matches - a.matches
    );

  if (!ranking.length) {
    await ctx.reply(
      '⚠️ <b>RANKING SEGA</b>\n\nOs jogadores estão autenticados, mas a API não retornou estatísticas agora.\n\n' +
        privacyNotice +
        '\n\n⏳ A API também pode estar lenta. Tente novamente em alguns minutos.',
      html(mainKeyboard())
    );
    return;
  }

  const lines = ranking.slice(0, 10).map((player, index) => {
    const medal = ['🥇', '🥈', '🥉'][index] || '🏅';
    return (
      `${medal} <b>${index + 1}. ${escapeHtml(player.name)}</b>\n` +
      `   📈 ${player.winRate.toFixed(1)}% WR  •  🏆 ${player.wins}/${player.matches}  •  ⭐ ${player.avgScore.toFixed(1)}`
    );
  });

  const skipped = players.length - ranking.length;
  await ctx.reply(
    '🏆 <b>RANKING SEGA</b>\n\n' +
      lines.join('\n\n') +
      (skipped > 0 ? `\n\n<i>${skipped} jogador(es) sem dados disponíveis no momento.</i>` : '') +
      '\n\n<i>Ranking calculado com os dados disponíveis na API.</i>',
    html(mainKeyboard())
  );
}

// ---------------------------------------------------------------- diagnóstico

/**
 * Testa a API de dentro da Railway e mostra exatamente o que está acontecendo.
 * É o atalho para descobrir se a culpa é do bot, da API ou do cadastro do jogador.
 */
async function sendDiagnostics(ctx) {
  if (ADMIN_ID && ctx.from.id !== ADMIN_ID) {
    await ctx.reply('Esse comando é só para o admin do clã.', html(mainKeyboard()));
    return;
  }

  await ctx.reply('🩺 <b>Testando a API...</b>', html());

  const checks = [];

  // 1. Endpoint público: mostra se a API responde e se o WAF está deixando passar.
  const heroes = await apiJson('/heroes?size=1');
  checks.push({
    name: 'API pública (/heroes)',
    ok: heroes.ok,
    detail: heroes.ok ? 'respondeu JSON normalmente' : `HTTP ${heroes.status} — ${heroes.message || 'sem mensagem'}`
  });

  // 2. Sessão do próprio usuário, se houver.
  const player = authenticatedPlayers.get(ctx.from.id);
  if (player?.jwt) {
    const info = await apiJson('/user/info', { headers: authHeaders(player.jwt) });
    checks.push({
      name: 'Sua sessão (/user/info)',
      ok: info.ok,
      detail: info.ok ? `válida — ${readUserName(info.body) || 'sem nome'}` : `HTTP ${info.status} — ${info.message || 'expirada'}`
    });
  } else {
    checks.push({ name: 'Sua sessão', ok: false, detail: 'nenhuma sessão ativa neste Telegram' });
  }

  const lines = checks.map((c) => `${c.ok ? '✅' : '❌'} <b>${c.name}</b>\n   ${escapeHtml(c.detail)}`);

  const diagnostic = heroes.diagnostic ? `\n\n🔍 Tentativas:\n<code>${escapeHtml(heroes.diagnostic).slice(0, 400)}</code>` : '';

  await ctx.reply(
    '🩺 <b>DIAGNÓSTICO</b>\n\n' +
      lines.join('\n\n') +
      '\n\n⚙️ <b>Ambiente</b>\n' +
      `   Host em uso: <code>${escapeHtml(currentBase())}</code>\n` +
      `   Hosts configurados: ${API_BASES.length}\n` +
      `   Volume persistente: ${HAS_PERSISTENT_DISK ? '✅ sim' : '❌ NÃO (cadastros somem no deploy)'}\n` +
      `   Jogadores conhecidos: ${knownPlayers.size}\n` +
      `   Sessões ativas: ${authenticatedPlayers.size}\n` +
      `   Uptime: ${Math.round(process.uptime() / 60)} min` +
      diagnostic,
    html(mainKeyboard())
  );
}

// ---------------------------------------------------------------- handlers
// Ordem importa no Telegraf: comandos e botões ANTES do handler genérico de texto.

bot.start(sendMenu);
bot.command('menu', sendMenu);
bot.command('cadastrar', askForRoleId);
bot.command('entrar', quickLogin);
bot.command('diag', sendDiagnostics);
bot.command('ajuda', sendHelp);
bot.command('help', sendHelp);
bot.command('stats', sendStats);
bot.command('ranking', sendRanking);
bot.command('clan', sendClan);
bot.command('lore', sendLore);

bot.command('cancelar', async (ctx) => {
  const had = registration.delete(ctx.from.id);
  await ctx.reply(
    had ? '❌ Cadastro cancelado. Nenhuma alteração foi feita.' : 'Não havia nenhum cadastro em andamento.',
    html(mainKeyboard())
  );
});

bot.command('sair', async (ctx) => {
  if (!knownPlayers.has(ctx.from.id)) {
    await ctx.reply('Você não tem nenhuma conta vinculada.', html(mainKeyboard()));
    return;
  }
  forgetPlayer(ctx.from.id);
  await saveSessions();
  await ctx.reply('👋 Conta desvinculada. Use /cadastrar quando quiser voltar.', html(mainKeyboard()));
});

// Botões do teclado persistente — registrados antes do handler de texto livre.
bot.hears(BUTTONS.register, askForRoleId);
bot.hears(BUTTONS.stats, sendStats);
bot.hears(BUTTONS.ranking, sendRanking);
bot.hears(BUTTONS.clan, sendClan);
bot.hears(BUTTONS.help, sendHelp);
bot.hears(BUTTONS.lore, sendLore);

// Botões inline.
bot.action('register', async (ctx) => {
  await ctx.answerCbQuery();
  await askForRoleId(ctx);
});
bot.action('stats', async (ctx) => {
  await ctx.answerCbQuery();
  await sendStats(ctx);
});
bot.action('ranking', async (ctx) => {
  await ctx.answerCbQuery();
  await sendRanking(ctx);
});
bot.action('clan', async (ctx) => {
  await ctx.answerCbQuery();
  await sendClan(ctx);
});
bot.action('lore', async (ctx) => {
  await ctx.answerCbQuery();
  await sendLore(ctx);
});
bot.action('help', async (ctx) => {
  await ctx.answerCbQuery();
  await sendHelp(ctx);
});

// Fluxo de cadastro (texto livre). Só roda se nada acima tratou a mensagem.
bot.on('text', async (ctx) => {
  const value = ctx.message.text.trim();

  // Botões do menu nunca devem ser lidos como ID/código.
  if (BUTTON_LABELS.has(value) || value.startsWith('/')) return;

  const state = getRegistration(ctx.from.id);
  if (!state) {
    await ctx.reply('🤔 Não entendi. Use /ajuda para ver os comandos disponíveis.', html(mainKeyboard()));
    return;
  }

  if (state.step === 'role_id') return handleRoleId(ctx, value);
  if (state.step === 'zone_id') return handleZoneId(ctx, value, state);
  if (state.step === 'verification_code') return handleVerificationCode(ctx, value, state);
});

bot.catch(async (error, ctx) => {
  console.error('❌ Erro no bot:', error);
  try {
    await ctx.reply('⚠️ Ops, algo deu errado por aqui. Tente novamente em alguns instantes.');
  } catch {
    /* ignora falha ao avisar o usuário */
  }
});

// ---------------------------------------------------------------- bootstrap

const COMMANDS = [
  { command: 'start', description: 'Abrir o menu principal' },
  { command: 'cadastrar', description: 'Cadastrar jogador' },
  { command: 'entrar', description: 'Reconectar sem redigitar os IDs' },
  { command: 'stats', description: 'Ver minhas estatísticas' },
  { command: 'ranking', description: 'Ver ranking do clã' },
  { command: 'clan', description: 'Ver o clã SEGA' },
  { command: 'lore', description: 'Crônicas e heróis' },
  { command: 'cancelar', description: 'Cancelar cadastro' },
  { command: 'sair', description: 'Desvincular minha conta' },
  { command: 'ajuda', description: 'Mostrar ajuda' }
];

let server = null;

function startHealthServer() {
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');

    if (req.method === 'POST' && WEBHOOK_URL && url.pathname === WEBHOOK_PATH) {
      if (WEBHOOK_SECRET && req.headers['x-telegram-bot-api-secret-token'] !== WEBHOOK_SECRET) {
        res.writeHead(401).end('unauthorized');
        return;
      }
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      try {
        await bot.handleUpdate(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (error) {
        console.error('❌ Erro ao processar update:', error.message);
      }
      res.writeHead(200).end('ok');
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' }).end(
      JSON.stringify({
        ok: true,
        service: 'SEGA Stats Bot',
        mode: WEBHOOK_URL ? 'webhook' : 'polling',
        players: authenticatedPlayers.size,
        uptime: Math.round(process.uptime())
      })
    );
  });

  // 0.0.0.0 é obrigatório para o healthcheck da Railway enxergar o serviço.
  server.listen(PORT, '0.0.0.0', () => console.log(`🩺 Healthcheck HTTP em :${PORT}`));
}

async function main() {
  console.log('🌐 Hosts da API MLBB:', API_BASES.join(', '));
  console.log('💾 Arquivo de sessão:', SESSION_FILE);

  await restoreSessions();
  startHealthServer();

  await bot.telegram.setMyCommands(COMMANDS).catch((error) => {
    console.error('⚠️ Não consegui registrar os comandos:', error.message);
  });

  if (WEBHOOK_URL) {
    const url = `${WEBHOOK_URL.replace(/\/+$/, '')}${WEBHOOK_PATH}`;
    await bot.telegram.setWebhook(url, {
      secret_token: WEBHOOK_SECRET || undefined,
      drop_pending_updates: true
    });
    console.log('🎮 SEGA Stats Bot online (webhook):', url);
    return;
  }

  // Remove webhook antigo, senão o getUpdates falha com 409.
  await bot.telegram.deleteWebhook({ drop_pending_updates: true }).catch(() => {});

  // bot.launch() só resolve quando o bot PARA — por isso logamos no callback,
  // e tratamos o erro aqui para a Railway reiniciar em vez de ficar zumbi.
  bot
    .launch({ dropPendingUpdates: true }, () => {
      console.log('🎮 SEGA Stats Bot online (long polling)!');
    })
    .catch((error) => {
      console.error('❌ O polling parou com erro:', error?.message || error);
      // 409 = outra instância usando o mesmo token. Rodar apenas 1 réplica.
      if (String(error?.message || '').includes('409')) {
        console.error('   ⚠️  Há outra instância do bot rodando com este mesmo BOT_TOKEN.');
      }
      process.exit(1);
    });
}

function shutdown(signal) {
  console.log(`\n⏹️  Encerrando (${signal})...`);
  try {
    bot.stop(signal);
  } catch {
    /* já parado */
  }
  server?.close();
  setTimeout(() => process.exit(0), 1000).unref();
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

process.on('unhandledRejection', (reason) => console.error('❌ Promise rejeitada sem tratamento:', reason));
process.on('uncaughtException', (error) => console.error('❌ Exceção não capturada:', error));

main().catch((error) => {
  console.error('❌ Falha fatal ao iniciar o bot:', error);
  process.exit(1);
});
