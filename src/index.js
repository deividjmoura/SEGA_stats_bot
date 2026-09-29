import 'dotenv/config';
import { Telegraf, Markup } from 'telegraf';

const token = process.env.BOT_TOKEN;
const RONE_API = 'https://arena.rone.dev/api';

if (!token) {
  console.error('❌ BOT_TOKEN não configurado. Crie um arquivo .env com o token do BotFather.');
  process.exit(1);
}

const bot = new Telegraf(token);

bot.telegram.setMyCommands([
  { command: 'start', description: 'Abrir o menu principal' },
  { command: 'cadastrar', description: 'Cadastrar jogador' },
  { command: 'ranking', description: 'Ver ranking do clã' },
  { command: 'stats', description: 'Ver minhas estatísticas' },
  { command: 'ajuda', description: 'Mostrar ajuda' },
  { command: 'cancelar', description: 'Cancelar cadastro' }
]).catch((error) => console.error('❌ Erro ao registrar comandos:', error));
const registration = new Map();

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

🚧 Alguns recursos ainda estão sendo construídos.`;

function askForRoleId(ctx) {
  registration.set(ctx.from.id, { step: 'role_id' });
  return ctx.reply(
    '📝 <b>CADASTRO DO JOGADOR</b>\n\n' +
    'Me manda agora o seu <b>ID do Mobile Legends</b> (Role ID).\n\n' +
    'Exemplo: <code>123456789</code>',
    { parse_mode: 'HTML' }
  );
}

bot.start(async (ctx) => {
  await ctx.reply(startMessage, {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('📝 Cadastrar jogador', 'register')],
      [
        Markup.button.callback('🏆 Ranking', 'ranking'),
        Markup.button.callback('📊 Minhas stats', 'stats')
      ],
      [Markup.button.callback('❓ Ajuda', 'help')]
    ])
  });
});

bot.command('cadastrar', async (ctx) => {
  await askForRoleId(ctx);
});

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
    await ctx.reply(
      '🌐 Agora me manda o <b>Zone ID</b> do seu jogador.\n\n' +
      'Exemplo: <code>1234</code>',
      { parse_mode: 'HTML' }
    );
    return;
  }

  if (state.step === 'zone_id') {
    if (!/^\d{1,8}$/.test(value)) {
      await ctx.reply('⚠️ Zone ID inválido. Envie somente os números do seu Zone ID.');
      return;
    }

    const { roleId } = state;

    await ctx.reply('🔎 <b>Solicitando código de verificação...</b>\n\n' +
      '📩 Um código será enviado para o correio interno do Mobile Legends.\n' +
      '⏱️ O código é válido por 5 minutos.', { parse_mode: 'HTML' });

    try {
      const response = await fetch(`${RONE_API}/user/auth/send-vc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role_id: Number(roleId),
          zone_id: Number(value)
        })
      });

      const body = await response.json().catch(() => ({}));

      if (!response.ok || body.code !== 0) {
        console.error('❌ Falha ao solicitar código:', response.status, body);
        await ctx.reply(
          '⚠️ Não consegui solicitar o código de verificação agora. Confira o ID e o Zone ID e tente novamente.'
        );
        registration.delete(ctx.from.id);
        return;
      }

      registration.set(ctx.from.id, {
        step: 'verification_code',
        roleId,
        zoneId: value
      });

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
        body: JSON.stringify({
          role_id: Number(roleId),
          zone_id: Number(zoneId),
          vc: Number(value)
        })
      });

      const body = await response.json().catch(() => ({}));

      if (!response.ok || body.code !== 0 || !body.data?.jwt) {
        console.error('❌ Falha na autenticação:', response.status, body);
        await ctx.reply(
          '❌ <b>Não foi possível validar o código.</b>\n\n' +
          'Verifique se você digitou o código corretamente e se ele ainda está dentro do prazo de validade (5 minutos).',
          { parse_mode: 'HTML' }
        );
        return;
      }

      const jwt = body.data.jwt;
      const infoResponse = await fetch(`${RONE_API}/user/info`, {
        headers: { Authorization: `Bearer ${jwt}` }
      });

      const infoBody = await infoResponse.json().catch(() => ({}));

      if (!infoResponse.ok || infoBody.code !== 0) {
        console.error('❌ Login realizado, mas não consegui consultar o perfil:', infoResponse.status, infoBody);
        registration.delete(ctx.from.id);
        await ctx.reply(
          '✅ <b>Conta verificada!</b>\n\n' +
          'A autenticação foi concluída, mas não consegui carregar suas estatísticas agora. Tente novamente mais tarde.',
          { parse_mode: 'HTML' }
        );
        return;
      }

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

bot.command('stats', async (ctx) => {
  await ctx.reply('📊 Suas estatísticas serão exibidas aqui depois que seu jogador estiver autenticado e vinculado.');
});

bot.command('ajuda', async (ctx) => {
  await ctx.reply(helpMessage, { parse_mode: 'HTML' });
});

bot.action('ranking', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply('🏆 O ranking entra na próxima etapa, usando os dados da API.');
});

bot.action('stats', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply('📊 Primeiro precisamos vincular e autenticar seu jogador. Use /cadastrar.');
});

bot.action('help', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(helpMessage, { parse_mode: 'HTML' });
});

bot.catch((error) => {
  console.error('❌ Erro no bot:', error);
});

bot.launch().then(() => {
  console.log('🎮 SEGA Stats Bot online!');
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
