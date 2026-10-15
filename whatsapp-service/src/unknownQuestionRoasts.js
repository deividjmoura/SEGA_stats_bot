import crypto from 'node:crypto';

const QUIPS = [
  'Até o minion parou de andar pra tentar entender essa pergunta. 😂',
  'Meu processador procurou a resposta e pediu transferência de clã. 🤖',
  'O Lord ouviu isso e preferiu continuar dormindo. 💀',
  'Minha base de conhecimento entrou em modo espectador depois dessa. 👀',
  'A resposta tava no minimapa... pena que ninguém olha pra ele. 🗺️',
  'Sua pergunta veio com skin épica e zero contexto. 🎭',
  'O tutorial tentou ajudar, mas abandonou a partida. 🎮',
  'A build dessa pergunta é: bom senso, mapa e coragem. 🔮',
  'Pedi socorro ao matchmaking e ele respondeu: boa sorte. 📡',
  'Até a torre do meio pediu silêncio depois dessa. 🏰',
  'Essa pergunta foi banida do draft por excesso de criatividade. 🏆',
  'Nem seis itens e buff azul fazem milagre desse tamanho. 😂',
  'Erro 404: resposta não encontrada; zoeira, porém, disponível. 💻',
  'Se eu soubesse ganhar sempre, tava jogando, não respondendo aqui. 😎',
];

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
  const joke = QUIPS[randomInt(QUIPS.length)];
  return '💀 *NOX NÃO ENTENDEU ESSA*\n\n' + joke +
    '\n\n💡 Pra sugerir uma resposta ou função nova, envie *!sugestao*.' +
    '\n🎮 Tente perguntar algo mais específico: *@NOX quem countera Harley?*';
}
