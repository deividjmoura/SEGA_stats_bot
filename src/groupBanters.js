const WAIT_MS = 5 * 60 * 1000;
const COOLDOWN_MS = 30 * 60 * 1000;

const pendingByChat = new Map();
const lastBanterByChat = new Map();

const phrases = [
  "Chamou pra jogar e o grupo ficou em silêncio. Acho que ativaram o modo espectador. 👀",
  "Seu convite está aguardando aprovação do conselho dos anciões do SEGA. 😂",
  "Detectei um pedido de companhia. O sistema também detectou zero voluntários. 💀",
  "Esse convite foi tão ignorado que já pode pedir aposentadoria.",
  "O cidadão convocou reforços. Os reforços aparentemente estão no café. ☕",
  "Nem a torre respondeu esse chamado. Situação delicada. 😂",
  "Se o objetivo era formar squad, o objetivo ainda está em fase de desenvolvimento.",
  "Convocação registrada. Presença confirmada: você. O resto segue misterioso. 👻",
  "Seu “bora?” entrou na fila. A fila parece estar vazia.",
  "O matchmaking encontrou seu convite e decidiu meditar sobre ele. 🧘",
  "Tem alguém vivo nesse grupo ou estamos todos jogando no modo fantasma?",
  "Seu chamado por duo foi recebido. A resposta foi enviada pelo silêncio. 😂",
  "O grupo está analisando seu convite com a mesma velocidade de uma partida travada.",
  "Esse convite precisa de um patch urgente. Nenhum jogador encontrado.",
  "Pelo visto, hoje o squad é você, você mesmo e mais ninguém.",
  "O SEGA recomenda tentar novamente quando os guerreiros saírem da toca. ⚔️",
  "Seu convite foi colocado em análise. O analista também não respondeu.",
  "Se silêncio desse MVP, esse grupo já teria um campeão.",
  "Convite sem resposta detectado. Talvez seja hora de ameaçar um ranked. 😂",
  "Você chamou o squad e recebeu o lendário “visualizado por ninguém”.",
  "Esse grupo está com latência emocional alta. 📶",
  "Seu convite chegou. A coragem dos demais aparentemente não.",
  "Cinco minutos de silêncio. Até o creeper do mapa faria mais barulho.",
  "Formação de equipe: 1/5. O restante está desaparecido em combate.",
  "O grupo recebeu seu pedido de duo e entrou em manutenção preventiva.",
  "Seu “bora” foi mais solitário que um jungler sem retri.",
  "Nenhuma resposta. Talvez estejam esperando o convite chegar por correio.",
  "Essa mensagem pede companhia e recebeu apenas contemplação filosófica.",
  "O radar do SEGA procurou parceiros. Encontrou apenas você. 👀",
  "Tem vaga no squad. Falta o pequeno detalhe chamado squad.",
  "Seu chamado foi tão ignorado que o bot resolveu fazer hora extra.",
  "Se ninguém responder, vou considerar que foi um treino solo.",
  "Convite detectado. Interesse do grupo: estatisticamente questionável.",
  "O silêncio está tão forte que já parece objetivo do mapa.",
  "Você pediu parceiro. O destino respondeu: “joga sozinho”. 😂",
  "Nenhum guerreiro se apresentou. A fila de desculpas já começou.",
  "Esse chamado está esperando resposta desde a era dos dinossauros.",
  "Grupo online, respostas offline. Um clássico.",
  "O SEGA confirma: seu convite existe. A cooperação, ainda não.",
  "Você convocou a tropa. A tropa aparentemente tirou férias.",
  "Nem o buff azul está tão disputado quanto uma vaga nesse squad.",
  "Seu pedido de companhia foi recebido com uma técnica avançada: ignorar.",
  "Se aparecer alguém agora, será considerado evento raro.",
  "Formação atual: você. Estratégia: improvisar. Resultado: veremos. 😂",
  "Seu convite está mais perdido que herói sem mapa.",
  "Esse “bora” precisa de mais impacto que uma ult bem colocada.",
  "Chamado enviado. Resposta pendente. Paciência também.",
  "Parece que o grupo está praticando uma nova estratégia: não responder.",
  "Um minuto de silêncio pela ausência dos parceiros de ranked. 👻",
  "Você chamou geral. Geral aparentemente chamou a própria cama.",
  "O squad não se formou, mas pelo menos o bot apareceu.",
  "Esse grupo tem jogadores, só não tem testemunhas do convite.",
  "Seu pedido por companhia entrou no modo sobrevivência.",
  "Nenhum parceiro encontrado. Recomendo tentar depois do próximo reset. 😂",
  "O radar detectou um jogador procurando outro jogador. Resultado inconclusivo.",
  "Se isso fosse draft, já teríamos banido o silêncio.",
  "Você abriu a convocação. O lobby fechou as portas.",
  "Esse chamado está com menos resposta que tutorial ignorado.",
  "Convite recebido. O grupo está usando a build “ausência total”.",
  "Tem alguém aí? Pergunta retórica. O bot já sabe a resposta.",
  "Você está procurando duo e encontrou um bot fofoqueiro. Parabéns. 😂",
  "Esse grupo está tão quieto que dá pra ouvir a torre caindo.",
  "Seu convite aguarda guerreiros. Os guerreiros aguardam motivação.",
  "Nenhum “bora” detectado. O sistema recomenda insistência moderada.",
  "Convocação oficial do SEGA. Comparecimento: preocupantemente baixo.",
  "Seu squad imaginário já está completo. Falta só a parte real.",
  "Esse silêncio tem potencial para virar estratégia defensiva.",
  "Pedido de companhia registrado. Alguém provavelmente está fingindo não ver.",
  "Você tentou montar time. O grupo tentou montar desculpas.",
  "Nem precisa de visão de mapa para saber que ninguém respondeu.",
  "Se aparecer um parceiro agora, merece MVP honorário.",
  "Seu convite está em cooldown emocional. 😂",
  "O grupo recebeu a mensagem e escolheu a diplomacia do silêncio.",
  "Você lançou o chamado. O chamado caiu no mato.",
  "SEGA Stats informa: ainda não foi encontrado um companheiro de lane.",
  "Esse pedido de duo está mais demorado que algumas filas de ranked.",
  "Seu convite foi enviado com sucesso. A vontade alheia não foi localizada.",
  "Parece que o grupo está economizando palavras para a próxima partida.",
  "Um guerreiro pede reforço. O conselho permanece em silêncio.",
  "Seu “vamos?” encontrou o lendário “depois eu vejo”.",
  "Não há resposta, mas há esperança. E um bot observando tudo. 👀",
  "Convite detectado. O grupo desbloqueou a habilidade passiva “não responder”.",
  "Você chamou a tropa e a tropa ativou camuflagem.",
  "Esse lobby precisa de jogadores, não de testemunhas.",
  "Seu pedido de companhia foi analisado por especialistas. Resultado: ninguém sabe.",
  "Hoje o modo cooperativo parece estar com problemas.",
  "Se ninguém responder, vou registrar como partida solo oficial.",
  "Você tentou recrutar. O recrutamento entrou em fila infinita.",
  "Esse convite merece uma resposta. Até um “não” já seria assistência.",
  "Nenhum parceiro apareceu. O SEGA está investigando o desaparecimento.",
  "Chamado recebido. Jogadores disponíveis: classificados como lenda urbana.",
  "Seu convite está intacto. A dignidade do grupo, nem tanto. 😂",
  "Parece que todo mundo está ocupado sendo carregado por alguém.",
  "Você quer jogar com alguém. O grupo quer paz. Temos um conflito diplomático.",
  "Esse chamado está tão sozinho que já pode pedir cidadania.",
  "SEGA Stats recomenda: marcar alguém pode aumentar a taxa de resposta em 0,01%.",
  "Se o objetivo era chamar atenção, parabéns. O bot percebeu.",
  "Convite enviado. Agora resta esperar o milagre do “bora”.",
  "Mais cinco minutos e esse convite vira patrimônio histórico do grupo.",
  "Seu squad está a um jogador de existir. E esse jogador aparentemente sou eu, um bot.",
  "Pedido de duo identificado. Nenhum humano se manifestou.",
  "Esse grupo está em modo economia de energia social.",
  "Você chamou para jogar e ganhou uma resposta automática. A tecnologia venceu. 🤖",
  "Nenhum guerreiro respondeu. Talvez estejam preparando a build perfeita.",
  "Esse silêncio é quase uma estratégia de macro.",
  "Você convocou reforços. O reforço veio em forma de bot.",
  "Caso alguém esteja procurando uma desculpa para não jogar, o grupo já forneceu o cenário perfeito.",
  "Seu convite continua vivo. Diferente da esperança de resposta. 😂",
  "Formação do SEGA: vaga aberta, coragem em falta.",
  "Esse chamado foi tão discreto que até o minimapa ignorou.",
  "Você pediu um parceiro. O universo entregou sarcasmo.",
  "Nenhum “partiu” detectado. Alerta amarelo no squad.",
  "Se responder agora, alguém pode até achar que o grupo funciona.",
  "Convite oficializado. Agora aguardamos o nascimento de um “bora”.",
  "Esse lobby tem potencial. Só faltam os jogadores.",
  "Você chamou o grupo inteiro. O grupo inteiro está estudando a mensagem.",
  "SEGA Stats concluiu a análise: jogar sozinho continua sendo uma possibilidade.",
  "Mais uma convocação sem resposta. O histórico começa a ficar suspeito.",
  "Seu convite recebeu silêncio premium, edição limitada.",
  "Os guerreiros estão ausentes, mas a zoeira está online.",
  "Se ninguém aparecer, pelo menos você ganhou uma mensagem do bot.",
  "Convite encerrado com sucesso: parceiro não encontrado, dignidade parcialmente preservada."
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

function isCallForPlayers(text) {
  const source = String(text || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9@]+/g, ' ')
    .trim();

  // Perguntas dirigidas ao próprio bot nunca entram no monitor de ausência.
  if (/@sega(?:_?stats)?(?:_?bot)?\b/i.test(String(text || ''))) return false;

  return [
    /\bbora\b/,
    /\bpartiu\b/,
    /\bduo\b/,
    /\bquem (?:vai|vem|joga|anima)\b/,
    /\balguem (?:vai|vem|joga|anima|on)\b/,
    /\bvamos jogar\b/,
    /\bquer jogar\b/,
    /\bquer (?:duo|ranked)\b/,
    /\bfecha(?:r)? (?:duo|time|squad)\b/,
    /\bfalta (?:um|1|alguem)\b/
  ].some(pattern => pattern.test(source));
}

function clearPending(chatId) {
  const pending = pendingByChat.get(chatId);
  if (pending?.timer) clearTimeout(pending.timer);
  pendingByChat.delete(chatId);
}

async function scheduleBanter(ctx, resolvePlayerName) {
  if (!isGroup(ctx) || ctx.from?.is_bot) return;

  const chatId = ctx.chat.id;
  const previous = pendingByChat.get(chatId);

  // Qualquer interação humana posterior encerra a espera anterior e já conta
  // como resposta. Não armamos outro timer nessa mesma mensagem, mesmo que a
  // resposta seja algo como “bora!”. Fotos, stickers e comandos também contam.
  if (previous) {
    clearPending(chatId);
    return;
  }

  if (isIgnoredText(ctx) || !isCallForPlayers(ctx.message?.text)) return;

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

export function markBanterHandled(ctx) {
  if (!isGroup(ctx) || !ctx.chat?.id) return;

  const pending = pendingByChat.get(ctx.chat.id);
  if (!pending) return;

  // Se o bot respondeu à mesma mensagem que armou o timer, consideramos a
  // conversa atendida e a zoeira de ausência não deve disparar.
  const sourceMessageId = ctx.message?.message_id;
  const sameMessage = !sourceMessageId || pending.messageId === sourceMessageId;
  const sameUser = !ctx.from?.id || pending.userId === ctx.from.id;

  if (sameMessage && sameUser) clearPending(ctx.chat.id);
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
