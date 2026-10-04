import knowledge from '../data/mlbb-knowledge.json' with { type: 'json' };

const KNOWN_HEROES = [
  "Aamon",
  "Akai",
  "Aldous",
  "Alice",
  "Alpha",
  "Alucard",
  "Angela",
  "Argus",
  "Arlott",
  "Atlas",
  "Aulus",
  "Aurora",
  "Badang",
  "Balmond",
  "Bane",
  "Barats",
  "Baxia",
  "Beatrix",
  "Belerick",
  "Benedetta",
  "Brody",
  "Bruno",
  "Carmilla",
  "Cecilion",
  "Chang'e",
  "Chip",
  "Chou",
  "Cici",
  "Claude",
  "Clint",
  "Cyclops",
  "Diggie",
  "Dyrroth",
  "Edith",
  "Esmeralda",
  "Estes",
  "Eudora",
  "Fanny",
  "Faramis",
  "Floryn",
  "Franco",
  "Fredrinn",
  "Freya",
  "Gatotkaca",
  "Gloo",
  "Gord",
  "Granger",
  "Grock",
  "Guinevere",
  "Gusion",
  "Hanabi",
  "Hanzo",
  "Harith",
  "Harley",
  "Hayabusa",
  "Helcurt",
  "Hilda",
  "Hirara",
  "Hylos",
  "Irithel",
  "Ixia",
  "Jawhead",
  "Johnson",
  "Joy",
  "Julian",
  "Kadita",
  "Kagura",
  "Kaja",
  "Kalea",
  "Karina",
  "Karrie",
  "Khaleed",
  "Khufra",
  "Kimmy",
  "Lancelot",
  "Lapu-Lapu",
  "Layla",
  "Leomord",
  "Lesley",
  "Ling",
  "Lolita",
  "Lukas",
  "Lunox",
  "Luo Yi",
  "Lylia",
  "Marcel",
  "Martis",
  "Masha",
  "Mathilda",
  "Melissa",
  "Minotaur",
  "Minsitthar",
  "Miya",
  "Moskov",
  "Nana",
  "Natalia",
  "Natan",
  "Nolan",
  "Novaria",
  "Obsidia",
  "Odette",
  "Paquito",
  "Pharsa",
  "Phoveus",
  "Popol e Kupa",
  "Rafaela",
  "Roger",
  "Ruby",
  "Saber",
  "Selena",
  "Silvanna",
  "Sora",
  "Sun",
  "Suyou",
  "Terizla",
  "Thamuz",
  "Tigreal",
  "Uranus",
  "Vale",
  "Valentina",
  "Valir",
  "Vexana",
  "Wanwan",
  "X.Borg",
  "Xavier",
  "Yi Sun-shin",
  "Yin",
  "Yu Zhong",
  "Yve",
  "Zetian",
  "Zhask",
  "Zhuxin",
  "Zilong"
];

const compact = (value) => String(value || '')
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

function findHero(text) {
  const source = compact(text);

  // Primeiro procura na base detalhada (counters, itens, dicas etc.).
  for (const [key, hero] of Object.entries(knowledge.heroes)) {
    const names = [key, hero.pt, hero.en, ...(hero.aliases || [])];
    if (names.some(name => {
      const n = compact(name);
      return n && (source === n || source.includes(' ' + n + ' ') || source.startsWith(n + ' ') || source.endsWith(' ' + n));
    })) return { key, ...hero, detailed: true };
  }

  // Depois reconhece todo o roster atual. Isso impede que heróis fora da
  // base detalhada caiam como "herói não identificado".
  const exact = KNOWN_HEROES.find(name => {
    const n = compact(name);
    return n && (source === n || source.includes(' ' + n + ' ') || source.startsWith(n + ' ') || source.endsWith(' ' + n));
  });
  if (exact) return { key: compact(exact), pt: exact, en: exact, counters: [], items: [], tips: [], detailed: false };

  return null;
}

function levenshtein(a, b) {
  const rows = Array.from({ length: a.length + 1 }, (_, i) => i);
  for (let j = 1; j <= b.length; j += 1) {
    let prev = rows[0];
    rows[0] = j;
    for (let i = 1; i <= a.length; i += 1) {
      const saved = rows[i];
      rows[i] = Math.min(
        rows[i] + 1,
        rows[i - 1] + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      prev = saved;
    }
  }
  return rows[a.length];
}

function suggestHero(text) {
  const source = compact(text);
  const candidates = [];
  for (const name of KNOWN_HEROES) {
    const n = compact(name);
    if (!n) continue;
    const distance = levenshtein(source, n);
    const threshold = n.length <= 5 ? 1 : n.length <= 8 ? 2 : 3;
    if (distance <= threshold) candidates.push({ name, distance });
  }

  candidates.sort((a, b) => a.distance - b.distance);
  return candidates[0]?.name || null;
}

const LIVE_HEROES_URL = 'https://arda.ozyurt.tr/mlbb/data/heroes.min.json';
const LIVE_MATRIX_URL = 'https://arda.ozyurt.tr/mlbb/data/matrix.json';
let liveDataCache = null;
let liveDataFetchedAt = 0;
let liveDataPromise = null;

async function loadLiveMatchups() {
  const now = Date.now();
  if (liveDataCache && now - liveDataFetchedAt < 10 * 60 * 1000) return liveDataCache;
  if (liveDataPromise) return liveDataPromise;

  liveDataPromise = (async () => {
    try {
      const [heroesResponse, matrixResponse] = await Promise.all([
        fetch(LIVE_HEROES_URL),
        fetch(LIVE_MATRIX_URL)
      ]);

      if (!heroesResponse.ok || !matrixResponse.ok) {
        throw new Error('fonte de matchup indisponível');
      }

      const heroes = await heroesResponse.json();
      const matrix = await matrixResponse.json();

      if (!Array.isArray(heroes) || !matrix?.counters) {
        throw new Error('formato de matchup inválido');
      }

      liveDataCache = { heroes, matrix };
      liveDataFetchedAt = Date.now();
      return liveDataCache;
    } catch (error) {
      console.warn('⚠️ Base live de counters indisponível:', error?.message || error);
      return liveDataCache;
    } finally {
      liveDataPromise = null;
    }
  })();

  return liveDataPromise;
}

function liveHeroByName(name, heroes) {
  const target = compact(name);
  return heroes.find(hero => compact(hero.n) === target);
}

async function getLiveCounters(heroName) {
  const live = await loadLiveMatchups();
  if (!live) return null;

  const target = liveHeroByName(heroName, live.heroes);
  if (!target) return null;

  const counters = live.matrix.counters;
  const rows = [];

  for (const [attackerId, matchups] of Object.entries(counters)) {
    const edge = Number(matchups?.[String(target.i)] ?? matchups?.[target.i]);
    if (!Number.isFinite(edge) || edge <= 0) continue;

    const attacker = live.heroes.find(hero => String(hero.i) === String(attackerId));
    if (!attacker) continue;

    rows.push({ name: attacker.n, edge });
  }

  rows.sort((a, b) => b.edge - a.edge);
  return rows.slice(0, 5).map(row => row.name);
}

function canonicalHeroName(name) {
  const target = compact(name);
  for (const hero of Object.values(knowledge.heroes)) {
    const names = [hero.pt, hero.en, ...(hero.aliases || [])];
    if (names.some(n => compact(n) === target)) return hero.pt + ' (' + hero.en + ')';
  }
  return name;
}

function intentOf(text) {
  const source = compact(text);
  if (/(counter|couter|countera|counteram|counterado|counterada|ganha|vence|bom contra|forte contra)/.test(source)) return 'counter';
  if (/(item|itens|equipamento|equipamentos).*(contra|counter)/.test(source) ||
      /(contra|counter).*(item|itens|equipamento|equipamentos)/.test(source)) return 'items';
  if (/(como jogar|como luto|como enfrentar|como jogar contra|dica|dicas).*(contra|vs|versus)/.test(source)) return 'tips';
  if (/(build|montar|montagem).*(de|do|da)/.test(source)) return 'build';
  if (/(funcao|lane|rota|papel|role|quem e|quem eh|qual heroi)/.test(source)) return 'hero';
  if (/(counter|couter|contra|build|item|equipamento|heroi)/.test(source)) return 'unknown_mlbb';
  return 'unknown';
}

export function listKnowledgeExamples() {
  return [
    '@SEGA Stats quem countera Harley?',
    '@SEGA Stats quem é bom contra Gusion?',
    '@SEGA Stats qual item faço contra Silvanna?',
    '@SEGA Stats como jogar contra Fanny?',
    '@SEGA Stats qual a função do Khufra?',
    '@SEGA Stats qual build faço de Harley?'
  ];
}

export function knowledgeSummary() {
  return {
    heroes: KNOWN_HEROES.length,
    detailedHeroes: Object.keys(knowledge.heroes).length,
    items: Object.keys(knowledge.items).length,
    version: knowledge.version,
    updatedAt: knowledge.updatedAt
  };
}

export async function answerMlbbQuestion(text) {
  const hero = findHero(text);
  const intent = intentOf(text);

  if (!hero) {
    if (intent === 'counter' || intent === 'items' || intent === 'tips' || intent === 'hero' || intent === 'build') {
      const suggestion = suggestHero(text.replace(/.*(?:countera|counter|contra|sobre|do|da|de)\\s+/i, ''));
      return '🎮 <b>Não identifiquei esse herói.</b>\n\n' +
        (suggestion
          ? '🤔 Você quis dizer <b>' + suggestion + '</b>?\n\nEnvie a pergunta novamente usando esse nome.'
          : 'Tente escrever o nome completo em português ou inglês.') +
        '\n\nEx.: <code>@SEGA Stats quem countera Harley?</code>';
    }
    return null;
  }

  const title = hero.pt + ' (' + hero.en + ')';

  if (intent === 'counter') {
    // A fonte live cobre o roster completo. A base local continua como fallback
    // para quando a fonte externa estiver indisponível.
    const liveCounters = await getLiveCounters(hero.pt);
    const counters = liveCounters?.length ? liveCounters : hero.counters;

    if (!counters?.length) {
      return '🎮 <b>' + title + '</b> foi identificado corretamente.\n\n' +
        '⚠️ Não consegui carregar os dados de matchup agora. Tente novamente em alguns segundos.';
    }

    return '⚔️ <b>COUNTERS DE ' + title.toUpperCase() + '</b>\n\n' +
      counters.map(name => '• ' + canonicalHeroName(name)).join('\n') +
      '\n\n📌 <b>Importante:</b> counter não é garantia de vitória. O resultado muda conforme rank, composição, execução e patch.\n📊 Dados de matchup atualizados para o SEGA Stats.';
  }

  if (intent === 'items') {
    return '🛡️ <b>ITENS CONTRA ' + title.toUpperCase() + '</b>\n\n' +
      hero.items.map(item => {
        const found = Object.values(knowledge.items).find(i => compact(i.pt) === compact(item) || compact(i.en) === compact(item));
        return '• ' + (found ? found.pt + ' (' + found.en + ')' : item);
      }).join('\n') +
      '\n\n💡 A escolha depende do tipo de dano, controle e composição.';
  }

  if (intent === 'tips') {
    return '🧠 <b>COMO JOGAR CONTRA ' + title.toUpperCase() + '</b>\n\n' +
      hero.tips.map(tip => '• ' + tip).join('\n') +
      '\n\n⚔️ Adapte a decisão à sua rota e à composição.';
  }

  if (intent === 'hero') {
    return '🎮 <b>' + title + '</b>\n\n🎭 Função: <b>' + hero.role + '</b>\n🗺️ Rota comum: <b>' + hero.lane + '</b>\n⚔️ Counters conhecidos: <b>' + hero.counters.slice(0, 3).map(canonicalHeroName).join(', ') + '</b>';
  }

  if (intent === 'build') {
    return '🧩 <b>BUILD / ' + title.toUpperCase() + '</b>\n\nA base de matchup está pronta, mas a build completa precisa considerar função, rota e situação.\n\nEnquanto isso, pergunte: <code>qual item faço contra ' + hero.pt + '?</code>';
  }

  return '🎮 <b>' + title + '</b> foi reconhecido.\n\nTente perguntar:\n• quem countera ' + hero.pt + '?\n• qual item faço contra ' + hero.pt + '?\n• como jogar contra ' + hero.pt + '?';
}
