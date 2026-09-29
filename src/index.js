import 'dotenv/config';
import { Telegraf, Markup } from 'telegraf';

const token = process.env.BOT_TOKEN;

if (!token) {
  console.error('❌ BOT_TOKEN não configurado. Crie um arquivo .env com o token do BotFather.');
  process.exit(1);
}

const bot = new Telegraf(token);

const startMessage = `🎮 <b>CEGA STATS BOT</b>

Fala, guerreiro! 👊

Bem-vindo ao bot oficial do clã <b>CEGA</b>.

Aqui você vai poder:

🏆 Consultar o ranking do clã
⚔️ Ver suas partidas e desempenho
🛡️ Conferir sua rota mais jogada
📊 Acompanhar seus pontos e estatísticas
👥 Comparar seu desempenho com a galera do clã

<b>Para começar:</b>
👉 Use <code>/cadastrar</code> para vincular seu jogador.

Bora descobrir quem realmente carrega nesse clã. 😎🔥`;

const helpMessage = `📚 <b>COMANDOS DO CEGA STATS</b>

🎮 <code>/start</code> — abrir o menu principal
📝 <code>/cadastrar</code> — cadastrar seu jogador
🏆 <code>/ranking</code> — ranking do clã
📊 <code>/stats</code> — suas estatísticas
❓ <code>/ajuda</code> — mostrar esta ajuda

🚧 Alguns recursos ainda estão sendo construídos.`;

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
  await ctx.reply(
    '📝 <b>CADASTRO DO JOGADOR</b>\n\n' +
    'Vamos vincular seu Telegram ao seu jogador do Mobile Legends.\n\n' +
    '🚧 O cadastro completo será conectado à API do MLBB na próxima etapa.',
    { parse_mode: 'HTML' }
  );
});

bot.command('ranking', async (ctx) => {
  await ctx.reply('🏆 O ranking do clã será liberado quando conectarmos os dados dos jogadores.');
});

bot.command('stats', async (ctx) => {
  await ctx.reply('📊 Suas estatísticas serão exibidas aqui depois que seu jogador estiver cadastrado.');
});

bot.command('ajuda', async (ctx) => {
  await ctx.reply(helpMessage, { parse_mode: 'HTML' });
});

bot.action('register', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(
    '📝 <b>Vamos cadastrar você!</b>\n\n' +
    'Na próxima etapa vou pedir os dados necessários para encontrar seu jogador no Mobile Legends.',
    { parse_mode: 'HTML' }
  );
});

bot.action('ranking', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply('🏆 O ranking entra na próxima etapa, assim que os dados do clã estiverem conectados.');
});

bot.action('stats', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply('📊 Primeiro precisamos vincular seu jogador. Use /cadastrar.');
});

bot.action('help', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(helpMessage, { parse_mode: 'HTML' });
});

bot.catch((error) => {
  console.error('❌ Erro no bot:', error);
});

bot.launch().then(() => {
  console.log('🎮 CEGA Stats Bot online!');
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
