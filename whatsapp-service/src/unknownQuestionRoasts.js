import crypto from 'node:crypto';

// 10 themes × 10 unique openings × 10 matched punchlines = 1,000 full jokes.
// Each joke is delivered once before the shuffled pool replenishes.
const THEMES = [
  {
    "name": "Minions perdidos",
    "openings": [
      "Até o minion parou a rota pra tentar entender essa pergunta.",
      "Um minion ouviu isso e pediu substituição no próximo patch.",
      "Os minions largaram a lane quando essa dúvida apareceu.",
      "O minion canhão desviou da batalha só pra não responder isso.",
      "Um minion tentou interpretar essa pergunta e virou creep neutro.",
      "Até o minion que só anda pra frente ficou indeciso depois dessa.",
      "O minion viu essa pergunta no chat e esqueceu de atacar a torre.",
      "Três minions fizeram reunião de emergência por causa dessa dúvida.",
      "O minion da EXP escutou isso e resolveu estudar outra função.",
      "Essa pergunta fez o minion pedir férias antes do primeiro wave."
    ],
    "punchlines": [
      "Conclusão: até a tropa automática exigiu explicação.",
      "O relatório oficial veio com três pontos de interrogação.",
      "Pelo menos eles sabem qual direção seguir, né?",
      "Dá pra ouvir o barulho de confusão lá da base.",
      "Se perguntar de novo, a wave inteira dá meia-volta.",
      "A estratégia recomendada foi fingir que o chat caiu.",
      "Parabéns: você confundiu quem nem tem livre-arbítrio.",
      "A única resposta foi um ping pedindo ajuda.",
      "A inteligência da rota entrou em manutenção.",
      "A tropa decidiu deixar essa pros humanos. Que azar o nosso."
    ]
  },
  {
    "name": "Minimapa",
    "openings": [
      "O minimapa piscou três vezes quando essa pergunta apareceu.",
      "Essa dúvida chegou ao minimapa e ele virou pro outro lado.",
      "O mapa tentou localizar a resposta e encontrou um vazio.",
      "Até o ícone de visão se recusou a mostrar o caminho dessa pergunta.",
      "O minimapa pediu zoom máximo pra procurar alguma lógica nisso.",
      "Seu ping de pergunta deu uma volta completa no minimapa.",
      "O mapa revelou todos os inimigos, menos o sentido dessa pergunta.",
      "O minimapa chamou reforço pra analisar esse raciocínio.",
      "A bússola do jogo enlouqueceu tentando apontar a resposta.",
      "Um ward imaginário foi colocado só pra vigiar essa ideia."
    ],
    "punchlines": [
      "O único lugar marcado foi 'território da confusão'.",
      "E olha que tem gente que nem abre o mapa.",
      "A resposta deve estar escondida na névoa de guerra.",
      "Meu ping só conseguiu escrever: boa sorte.",
      "Nem visão total salvaria essa estratégia.",
      "Tenta localizar um pouco de contexto primeiro.",
      "O sistema respondeu com um sinal de perigo.",
      "Parece que o raciocínio tomou gank no caminho.",
      "O objetivo foi marcado, mas ninguém quis ir.",
      "O GPS do NOX sugeriu retornar ao tutorial."
    ]
  },
  {
    "name": "Draft maluco",
    "openings": [
      "A sala de draft ficou muda depois que essa pergunta entrou.",
      "O capitão do draft baniu essa ideia sem nem olhar os heróis.",
      "Essa pergunta foi escolhida de first pick e o time pediu remake.",
      "Os cinco jogadores pediram tempo pra processar essa sugestão.",
      "O draft tentou encaixar essa dúvida em alguma composição.",
      "Uma ban phase inteira foi gasta tentando evitar essa pergunta.",
      "O último pick viu isso e escolheu virar espectador.",
      "O capitão perguntou se essa dúvida era de um jogador ou de um bug.",
      "Até o botão de confirmar pick hesitou depois dessa.",
      "O draft montou uma composição só pra sobreviver a essa pergunta."
    ],
    "punchlines": [
      "O counter mais indicado foi o silêncio estratégico.",
      "Resultado: cinco funções, zero respostas.",
      "Nem herói flex resolve falta de contexto.",
      "O treinador pediu banimento preventivo da ideia.",
      "A composição ficou boa; o raciocínio não entrou na fila.",
      "Na próxima, manda um objetivo junto com a pergunta.",
      "O último slot ficou reservado pro bom senso.",
      "O time inteiro digitou '??' ao mesmo tempo.",
      "A única sinergia foi entre confusão e desespero.",
      "O draft terminou e a dúvida ainda tava escolhendo rota."
    ]
  },
  {
    "name": "Jungle e buffs",
    "openings": [
      "O jungler largou o buff azul quando leu essa pergunta.",
      "O buff vermelho se recusou a participar desse raciocínio.",
      "Até o monstro da jungle pediu uma explicação mais clara.",
      "O caçador ficou três minutos rodando em círculo atrás dessa resposta.",
      "Essa pergunta entrou na jungle e nunca mais foi vista.",
      "O jungler gastou Retribuição tentando apagar essa dúvida.",
      "O buff azul enviou um pedido de transferência depois dessa.",
      "Um monstro neutro pediu neutralidade também nessa conversa.",
      "O jungler foi procurar a resposta e perdeu o objetivo.",
      "A jungle inteira entrou em negação quando isso apareceu."
    ],
    "punchlines": [
      "Nem com vantagem de nível dá pra carregar essa lógica.",
      "O farm da resposta ficou em zero.",
      "A rotação recomendada é voltar pro básico.",
      "Pelo menos o buff dá mana; essa ideia só consome.",
      "Até a Retribuição perdeu a vontade de funcionar.",
      "Esse caminho de jungle não aparece em guia nenhum.",
      "O próximo objetivo é encontrar uma pergunta específica.",
      "Resultado do gank: ninguém entendeu nada.",
      "O único drop foi um ponto de interrogação.",
      "Se insistir, o monstro neutro vira inimigo pessoal."
    ]
  },
  {
    "name": "Torres",
    "openings": [
      "A torre do meio tentou defender o time dessa pergunta.",
      "A torre inimiga ouviu isso e ofereceu proteção diplomática.",
      "O cristal da base tremeu quando essa dúvida chegou.",
      "Até a torre da rota ouro ficou sem reação depois dessa.",
      "O escudo da torre foi ativado só pra bloquear esse raciocínio.",
      "A torre pediu relatório de dano emocional após essa pergunta.",
      "Um tiro da torre tentou acertar a resposta e passou longe.",
      "A torre da EXP acionou protocolo de emergência pra esse chat.",
      "O cristal inimigo mandou flores de condolências pela pergunta.",
      "A torre se recusou a cair enquanto essa dúvida não fosse explicada."
    ],
    "punchlines": [
      "A defesa segura é perguntar de outro jeito.",
      "Até a estrutura pediu um tutorial.",
      "O cristal respondeu: isso aqui não é milagre.",
      "O dano foi baixo, mas a confusão foi crítica.",
      "Se fosse objetivo, pelo menos daria pra marcar no mapa.",
      "Essa ideia tem menos resistência que torre sem minion.",
      "A única coisa destruída foi a clareza da conversa.",
      "A base pediu pra começar um novo tópico.",
      "O sistema de defesa identificou ameaça ao bom senso.",
      "Não tem item de defesa contra pergunta sem contexto."
    ]
  },
  {
    "name": "Lord e Turtle",
    "openings": [
      "O Lord acordou, leu essa pergunta e voltou a dormir.",
      "A Turtle escondeu a cabeça quando essa dúvida apareceu.",
      "O Lord pediu votação antes de tentar responder isso.",
      "Até a Turtle resolveu acelerar a própria fuga do mapa.",
      "O Lord exigiu buff de paciência pra lidar com essa pergunta.",
      "O objetivo épico saiu da caverna e entrou no modo avião.",
      "A Turtle tentou carregar essa ideia e perdeu a carapaça.",
      "O Lord marcou uma reunião de chefes por causa dessa dúvida.",
      "A caverna do Lord ficou em silêncio depois dessa pergunta.",
      "O Lord mandou um ping de retirada quando leu o chat."
    ],
    "punchlines": [
      "O prêmio foi zero ouro e cem por cento de confusão.",
      "Nem objetivo épico resolve raciocínio em manutenção.",
      "A recomendação é coletar contexto antes de coletar buff.",
      "Se isso fosse uma luta, o cronômetro já teria expirado.",
      "O mapa até oferece objetivos; resposta mágica, não.",
      "O monstro falou: volto quando fizer sentido.",
      "Todo mundo quer o Lord, ninguém quer essa explicação.",
      "É mais fácil roubar objetivo sem visão do que adivinhar isso.",
      "A Turtle só concordou com uma coisa: fugir.",
      "O placar dessa pergunta ficou empatado em interrogações."
    ]
  },
  {
    "name": "Builds e itens",
    "openings": [
      "Abri a loja de itens pra tentar montar uma resposta pra isso.",
      "O vendedor da loja pediu demissão depois dessa pergunta.",
      "Seis slots de item não foram suficientes pra equipar esse raciocínio.",
      "O emblema tentou dar atributos extras pra essa dúvida.",
      "Essa pergunta entrou na loja e saiu sem comprar nada.",
      "O item lendário se recusou a ser combinado com essa ideia.",
      "O ferreiro do jogo examinou essa pergunta e devolveu o orçamento.",
      "Até o item defensivo precisou de proteção contra essa dúvida.",
      "A build automática congelou no primeiro item ao ler isso.",
      "O sistema recomendou botas pra essa pergunta sair andando."
    ],
    "punchlines": [
      "O único item disponível era um manual de instruções.",
      "A build completa ficou: contexto, detalhe e mais contexto.",
      "Faltou ouro pra comprar a parte que faz sentido.",
      "O bônus de inteligência não era compatível com esse pedido.",
      "Não existe item mítico de adivinhação, infelizmente.",
      "A taxa de vitória caiu só de ler a descrição.",
      "O emblema sugerido foi Paciência nível máximo.",
      "Nem desconto na loja salva essa escolha.",
      "O patch não trouxe equipamento pra isso.",
      "A recomendação da loja foi tentar outra pergunta."
    ]
  },
  {
    "name": "Ranqueada e matchmaking",
    "openings": [
      "O matchmaking analisou essa pergunta e mandou um pedido de desculpas.",
      "Essa dúvida entrou na ranqueada e caiu direto na fila de revisão.",
      "O sistema de classificação tentou ranquear o sentido dessa pergunta.",
      "Até o MVP da derrota pediu explicação dessa ideia.",
      "O matchmaking encontrou uma equipe inteira de interrogações pra você.",
      "A seleção ranqueada pausou só pra conferir se isso era sério.",
      "O histórico de partidas tentou apagar essa pergunta sozinho.",
      "A fila mítica considerou essa dúvida um novo modo de jogo.",
      "O cálculo de MMR deu erro quando essa pergunta chegou.",
      "Essa pergunta entrou como estrela e saiu como dúvida existencial."
    ],
    "punchlines": [
      "O sistema respondeu: partida encontrada, resposta não.",
      "Não dá pra subir de elo na base da telepatia.",
      "A penalidade foi uma aula gratuita de contexto.",
      "Nem o elo mais alto tem resposta automática pra tudo.",
      "O único MVP foi o ponto de interrogação.",
      "O relatório final mostrou confusão em todas as rotas.",
      "A promoção foi adiada por falta de explicação.",
      "A fila pediu que você selecione uma dúvida mais específica.",
      "Até o matchmaking quis evitar essa composição.",
      "A partida acaba, mas essa pergunta ainda tá carregando."
    ]
  },
  {
    "name": "Suporte e roamer",
    "openings": [
      "O roamer saiu da rota pra tentar socorrer essa pergunta.",
      "O suporte gastou a ultimate tentando curar esse raciocínio.",
      "Até o tanque ficou sem defesa diante dessa dúvida.",
      "O suporte abriu o mapa inteiro procurando a intenção da pergunta.",
      "O roamer marcou um gank só pra interromper essa conversa.",
      "A cura em área não conseguiu recuperar o sentido dessa frase.",
      "O tanque ativou escudo e se escondeu da explicação.",
      "Essa dúvida pediu peel, mas nenhum aliado respondeu.",
      "O suporte tomou stun só de ler isso no chat.",
      "O roamer perdeu a paciência antes de perder a luta."
    ],
    "punchlines": [
      "Nem cura de equipe recupera contexto perdido.",
      "O único CC dessa história é Confusão Coletiva.",
      "O time pediu visão, não vidência.",
      "A assistência foi registrada como tentativa desesperada.",
      "Até escudo mágico tem limite, pô.",
      "O melhor suporte aqui é reformular a pergunta.",
      "Falta um aliado chamado Bom Senso nessa composição.",
      "O cooldown da resposta vai durar até você explicar melhor.",
      "O roamer recomendou voltar para a base de conhecimento.",
      "O relatório diz: ninguém morreu, mas todo mundo ficou confuso."
    ]
  },
  {
    "name": "NOX e informática",
    "openings": [
      "Meu processador tentou entender essa pergunta e abriu chamado no suporte.",
      "A inteligência artificial pediu férias depois dessa dúvida.",
      "Rodei um diagnóstico no NOX pra conferir se isso era pergunta.",
      "A memória do bot tentou salvar essa dúvida e recusou o arquivo.",
      "Meu antivírus acusou excesso de criatividade nesse pedido.",
      "O NOX abriu dez abas procurando algum sentido nisso.",
      "O algoritmo pediu café duplo ao ler essa pergunta.",
      "Minha base de conhecimento fez backup e fugiu desse assunto.",
      "O servidor solicitou um tradutor de pensamentos pra lidar com isso.",
      "Até o botão de ajuda pareceu assustado com essa dúvida."
    ],
    "punchlines": [
      "Status final: funcionando normalmente, pergunta nem tanto.",
      "Erro 404: contexto não encontrado.",
      "Tente desligar a confusão e ligar a especificidade.",
      "O suporte técnico respondeu com um emoji de desespero.",
      "Minha IA é artificial, mas a paciência era de verdade.",
      "A solução recomendada foi reenviar com detalhes.",
      "Se isso fosse código, nem o compilador aceitaria.",
      "O log registrou apenas: socorro, humanos.",
      "Tenho dados de heróis; bola de cristal não veio no pacote.",
      "Relatório concluído: precisava de pergunta, veio uma aventura."
    ]
  }
];

export const ROAST_VARIANT_COUNT = THEMES.reduce(
  (total, theme) => total + theme.openings.length * theme.punchlines.length, 0
);

const ALL_JOKES = THEMES.flatMap(theme =>
  theme.openings.flatMap(opening =>
    theme.punchlines.map(punchline => opening + ' ' + punchline)
  )
);

let unseen = [];

function drawJoke(randomInt) {
  if (unseen.length === 0) unseen = ALL_JOKES.map((_, index) => index);
  const index = randomInt(unseen.length);
  if (!Number.isInteger(index) || index < 0 || index >= unseen.length) {
    throw new RangeError('Invalid random joke index');
  }
  const chosen = unseen[index];
  unseen[index] = unseen[unseen.length - 1];
  unseen.pop();
  return ALL_JOKES[chosen];
}

export function isVagueWinQuestion(question) {
  const words = String(question || '').normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const has = value => words.includes(value);
  if (['contra','counter','countera','cautera','cauter'].some(has)) return false;
  const vagueHero = ['personagem','heroi','boneco','pick'].some(has);
  const win = ['ganhar','vencer','vitoria','subir','carregar'].some(has);
  const choice = ['uso','usar','escolho','pego','jogo','qual','que'].some(has);
  const impossible = has('ganhar') && ['todas','sempre'].some(has);
  return vagueHero && win && choice || impossible;
}

export function makeUnknownQuestionRoast(randomInt = crypto.randomInt) {
  const joke = drawJoke(randomInt);
  return '💀 *NOX NÃO ENTENDEU ESSA*\\n\\n' + joke +
    '\\n\\n💡 Quer ensinar algo novo pro bot? Envie *!sugestao*.' +
    '\\n🎮 Tente algo mais específico: *@NOX quem countera Harley?*';
}
