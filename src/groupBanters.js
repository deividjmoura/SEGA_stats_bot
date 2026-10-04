const WAIT_MS = 5 * 60 * 1000;
const COOLDOWN_MS = 30 * 60 * 1000;

const pendingByChat = new Map();
const lastBanterByChat = new Map();

const phrases = [
  'Vish... pelo jeito ninguém tá afim da sua companhia pra jogar hoje 😂',
  'Ih... essa mensagem caiu no limbo do grupo. Alguém resgata o cidadão. 👀',
  'Silêncio absoluto. Acho que seu convite foi rejeitado pelo servidor. 😂',
  'Nem no matchmaking você toma tanto silêncio assim.',
  'Alguém responde esse cidadão antes que ele comece a jogar solo. ⚔️',
  'O grupo visualizou em espírito. 👻',
  'Convite detectado. Interessados encontrados: 0. Situação crítica. 😂',
  'A mensagem foi enviada com sucesso. O interesse do grupo, aparentemente, não. 💀',
  'Cinco minutos e nem um “bora”. Isso aí foi um dodge coletivo. 😂',
  'Pelo silêncio, parece que o time inteiro foi desconectado.',
  'Esse chamado por companhia está com mais atraso que conexão ruim no ranked. 📶',
  'O SEGA recebeu sua mensagem. O resto do grupo aparentemente está em outra dimensão. 👻'
];

function isGroup(ctx) {
  return ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup';
}

function isIgnoredText(ctx) {
  const text = String(ctx.message?.text || '').trim();
  if (!text || text.startsWith('/')) return true;
  if (ctx.from?.is_bot) return true;
  return false;
}

function clearPending(chatId) {
  const pending = pendingByChat.get(chatId);
  if (pending?.timer) clearTimeout(pending.timer);
  pendingByChat.delete(chatId);
}

async function scheduleBanter(ctx, resolvePlayerName) {
  if (!isGroup(ctx) || isIgnoredText(ctx)) return;

  const chatId = ctx.chat.id;
  clearPending(chatId);

  const lastBanter = lastBanterByChat.get(chatId) || 0;
  if (Date.now() - lastBanter < COOLDOWN_MS) return;

  const messageId = ctx.message.message_id;
  const userId = ctx.from.id;
  const displayName =
    (await resolvePlayerName?.(userId)) ||
    ctx.from.first_name ||
    ctx.from.username ||
    'guerreiro';

  const timer = setTimeout(async () => {
    const current = pendingByChat.get(chatId);
    if (!current || current.messageId !== messageId || current.userId !== userId) return;

    pendingByChat.delete(chatId);
    lastBanterByChat.set(chatId, Date.now());

    const phrase = phrases[Math.floor(Math.random() * phrases.length)];
    try {
      await ctx.telegram.sendMessage(
        chatId,
        '👀 <b>' + displayName.replace(/[&<>]/g, '') + '</b>...\n\n' + phrase,
        {
          parse_mode: 'HTML',
          reply_parameters: { message_id: messageId }
        }
      );
    } catch (error) {
      console.error('⚠️ Não consegui mandar a zoeira do grupo:', error.message);
    }
  }, WAIT_MS);

  pendingByChat.set(chatId, { timer, messageId, userId });
}

export function groupBanterMiddleware(resolvePlayerName) {
  return async (ctx, next) => {
    try {
      await scheduleBanter(ctx, resolvePlayerName);
    } catch (error) {
      console.error('⚠️ Erro no monitor de zoeira do grupo:', error);
    }
    await next();
  };
}
