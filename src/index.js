import 'dotenv/config';
import { Telegraf, Markup } from 'telegraf';

const token = process.env.BOT_TOKEN;
const RONE_API = 'https://arena.rone.dev/api';

if (!token) {
  console.error('❌ BOT_TOKEN não configurado. Crie um arquivo .env com o token do BotFather.');
  process.exit(1);
}

const bot = new Telegraf(token);
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
    registration.delete(ctx.from.id);

    await ctx.reply('🔎 <b>Consultando a Rone Arena...</b>', { parse_mode: 'HTML' });

    try {
      const response = await fetch(`${RONE_API}/user/info`, {
        headers: { Authorization: 'Bearer invalid' }
      });

      if (response.status === 401 || response.status === 403) {
        await ctx.reply(
          '🔐 Recebi seu ID e Zone ID, mas a Rone exige autenticação do jogador para consultar os dados privados.\n\n' +
          `🆔 ID: <code>${roleId}</code>\n` +
          `🌐 Zone: <code>${value}</code>\n\n` +
          'O próximo passo é implementar a autenticação por código enviado pelo próprio jogo. Assim o jogador autoriza o vínculo com segurança.',
          { parse_mode: 'HTML' }
        );
        return;
      }

      if (!response.ok) throw new Error(`Rone HTTP ${response.status}`);

      const body = await response.json();
      await ctx.reply(
        `✅ <b>Jogador encontrado!</b>\n\n` +
        `👤 ${body.data?.name ?? 'Nome não informado'}\n` +
        `🆔 <code>${roleId}</code>\n` +
        `🌐 <code>${value}</code>`,
        { parse_mode: 'HTML' }
      );
    } catch (error) {
      console.error('❌ Erro ao consultar Rone:', error);
      await ctx.reply(
        '⚠️ Não consegui consultar a API agora. Seus dados foram recebidos, mas ainda não foram vinculados. Tente novamente mais tarde.'
      );
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
