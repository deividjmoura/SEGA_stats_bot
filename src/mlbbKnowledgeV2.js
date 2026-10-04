import knowledge from '../data/mlbb-knowledge.json' assert { type: 'json' };

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

const RONE_API = 'https://arena.rone.dev/api';
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
  const against = '(?:contra|conta|cotra|conra|counter|couter)';

  // Aceita erros de digitação comuns sem perder a intenção da pergunta.
  if (new RegExp('(?:counter|couter|countera|counteram|counterado|counterada|ganha|vence|bom\\s+' + against + '|forte\\s+' + against + ')').test(source)) return 'counter';
  if (new RegExp('(?:item|itens|equipamento|equipamentos).*' + against + '|' + against + '.*(?:item|itens|equipamento|equipamentos)').test(source)) return 'items';
  if (new RegExp('(?:como jogar|como luto|como enfrentar|dica|dicas).*' + against + '|como jogar\\s+' + against).test(source)) return 'tips';
  if (/(?:build|buildar|montar|montagem)(?:.*(?:de|do|da)\b|\s+[a-z0-9áàâãéêíóôõúçü' -]+$)/.test(source)) return 'build';
  if (/(funcao|lane|rota|papel|role|quem e|quem eh|qual heroi)/.test(source)) return 'hero';
  if (new RegExp('(?:counter|couter|' + against + '|build|item|equipamento|heroi)').test(source)) return 'unknown_mlbb';
  return 'unknown';
}

const buildKnowledge = {
  argus: {
    name: 'Argus',
    role: 'Lutador',
    lane: 'EXP',
    items: ['Swift Boots', 'Corrosion Scythe', 'Demon Hunter Sword', 'Golden Staff', "Haas's Claws", 'Malefic Roar'],
    emblem: 'Emblema de Atirador',
    spell: 'Flicker',
    note: 'Linha de ataque contínuo/efeitos de ataque. Os dois primeiros picos são Corrosion Scythe + Demon Hunter Sword; adapte os dois últimos slots à armadura, sustain ou burst mágico do adversário.',
    sourceLabel: 'build curada e builds da comunidade',
    patch: '2.2.16'
  },
  harley: {
    name: 'Harley',
    role: 'Assassino/Mago',
    lane: 'Jungle/Mid',
    items: ['Arcane Boots', 'Genius Wand', 'Starlium Scythe', 'Holy Crystal', 'Divine Glaive', 'Winter Crown'],
    emblem: 'Emblema de Mago',
    spell: 'Retribution',
    note: 'Foco em burst mágico e pickoff. Ajuste a penetração e a defesa conforme a composição inimiga.',
    sourceLabel: 'build curada',
    patch: '2.2.16'
  },
  gusion: {
    name: 'Gusion',
    role: 'Assassino',
    lane: 'Jungle',
    items: ['Arcane Boots', 'Genius Wand', 'Holy Crystal', 'Divine Glaive', 'Blood Wings', 'Winter Crown'],
    emblem: 'Emblema de Assassino',
    spell: 'Retribution',
    note: 'Build de burst mágico. A prioridade é penetração + poder mágico para finalizar o alvo rapidamente.',
    sourceLabel: 'build curada',
    patch: '2.2.16'
  },
  silvanna: {
    name: 'Silvanna',
    role: 'Lutadora',
    lane: 'EXP',
    items: ['Tough Boots', 'Genius Wand', 'Concentrated Energy', 'Glowing Wand', 'Antique Cuirass', 'Immortality'],
    emblem: 'Emblema de Mago',
    spell: 'Flicker',
    note: 'Linha de pickoff/bruiser. A defesa final deve responder ao tipo de dano e controle do inimigo.',
    sourceLabel: 'build curada',
    patch: '2.2.16'
  },
  fanny: {
    name: 'Fanny',
    role: 'Assassina',
    lane: 'Jungle',
    items: ['Tough Boots', 'Blade of the Heptaseas', 'Malefic Roar', 'Hunter Strike', 'Blade of Despair', 'Immortality'],
    emblem: 'Emblema de Assassino',
    spell: 'Retribution',
    note: 'Linha de pickoff para snowball. Immortality pode virar item situacional quando o risco de shutdown aumenta.',
    sourceLabel: 'build curada',
    patch: '2.2.16'
  }
};

function buildForHero(hero) {
  const key = compact(hero?.en || hero?.pt || '');
  return buildKnowledge[key] || null;
}

const liveProfileCache = new Map();

async function getLiveHeroProfile(heroName) {
  const key = compact(heroName);
  const cached = liveProfileCache.get(key);
  if (cached && Date.now() - cached.at < 30 * 60 * 1000) return cached.value;

  try {
    const response = await fetch(
      RONE_API + '/heroes/' + encodeURIComponent(heroName) + '?lang=pt&size=1'
    );
    if (!response.ok) return null;

    const body = await response.json();
    const record = body?.data?.records?.[0];
    const data = record?.data?.hero?.data || record?.data || {};
    const sort = data.sortid;
    const role = Array.isArray(sort)
      ? sort.map(item => item?.sort_title).filter(Boolean).join('/')
      : sort?.sort_title || null;

    const roads = Array.isArray(data.roadsort)
      ? data.roadsort.map(item => item?.sort_title).filter(Boolean)
      : [];
    const lane =
      data?.story?.road_sort_title ||
      data?.road_sort_title ||
      roads[0] ||
      null;

    const value = {
      name: data.name || heroName,
      role,
      lane
    };
    liveProfileCache.set(key, { at: Date.now(), value });
    return value;
  } catch (error) {
    console.warn('⚠️ Perfil live do herói indisponível:', error?.message || error);
    return null;
  }
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
    if (!Array.isArray(hero.items) || !hero.items.length) {
      return '🛡️ <b>ITENS CONTRA ' + title.toUpperCase() + '</b>\n\n' +
        'Ainda não tenho uma recomendação local de itens confiável para esse herói. ' +
        'Prefiro não inventar uma build. Você pode perguntar pelos counters atualizados enquanto essa parte da base é ampliada.';
    }

    return '🛡️ <b>ITENS CONTRA ' + title.toUpperCase() + '</b>\n\n' +
      hero.items.map(item => {
        const found = Object.values(knowledge.items).find(i => compact(i.pt) === compact(item) || compact(i.en) === compact(item));
        return '• ' + (found ? found.pt + ' (' + found.en + ')' : item);
      }).join('\n') +
      '\n\n💡 A escolha depende do tipo de dano, controle e composição.';
  }

  if (intent === 'tips') {
    if (!Array.isArray(hero.tips) || !hero.tips.length) {
      return '🧠 <b>COMO JOGAR CONTRA ' + title.toUpperCase() + '</b>\n\n' +
        'Ainda não tenho dicas detalhadas cadastradas para esse herói. ' +
        'Posso reconhecer o herói e consultar matchups, mas não vou preencher a resposta com informação inventada.';
    }

    return '🧠 <b>COMO JOGAR CONTRA ' + title.toUpperCase() + '</b>\n\n' +
      hero.tips.map(tip => '• ' + tip).join('\n') +
      '\n\n⚔️ Adapte a decisão à sua rota e à composição.';
  }

  if (intent === 'hero') {
    const liveProfile = (!hero.role || !hero.lane)
      ? await getLiveHeroProfile(hero.pt)
      : null;
    const role = hero.role || liveProfile?.role || 'ainda não disponível';
    const lane = hero.lane || liveProfile?.lane || 'ainda não disponível';
    const counters = Array.isArray(hero.counters) && hero.counters.length
      ? hero.counters.slice(0, 3).map(canonicalHeroName).join(', ')
      : 'pergunte “quem countera ' + hero.pt + '?” para consultar o matchup atualizado';

    return '🎮 <b>' + title + '</b>\n\n' +
      '🎭 Função: <b>' + role + '</b>\n' +
      '🗺️ Rota comum: <b>' + lane + '</b>\n' +
      '⚔️ Counters: <b>' + counters + '</b>';
  }

  if (intent === 'build') {
    const build = buildForHero(hero);

    if (!build) {
      const liveProfile = await getLiveHeroProfile(hero.pt);
      return '🧩 <b>BUILD / ' + title.toUpperCase() + '</b>\n\n' +
        (liveProfile
          ? '🎯 Função: <b>' + liveProfile.role + '</b> • Rota: <b>' + liveProfile.lane + '</b>\n\n'
          : '') +
        'Ainda não tenho uma build curada específica para esse herói. Prefiro não inventar seis itens.\n\n' +
        'Posso consultar os counters atualizados e, conforme a base crescer, adicionar a build recomendada.';
    }

    return '🧩 <b>BUILD / ' + title.toUpperCase() + '</b>\n\n' +
      '🎯 <b>' + build.role + '</b> • ' + build.lane + '\n' +
      '🛒 <b>Ordem sugerida:</b>\n' +
      build.items.map((item, index) => (index + 1) + '. ' + item).join('\n') + '\n\n' +
      '🧿 Emblema: <b>' + build.emblem + '</b>\n' +
      '✨ Feitiço: <b>' + build.spell + '</b>\n\n' +
      '💡 ' + build.note + '\n\n' +
      '📚 Referência: <b>' + build.sourceLabel + '</b> no patch ' + build.patch + '. É uma base, não uma regra fixa; a partida deve decidir os itens situacionais.';
  }

  return '🎮 <b>' + title + '</b> foi reconhecido.\n\nTente perguntar:\n• quem countera ' + hero.pt + '?\n• qual item faço contra ' + hero.pt + '?\n• como jogar contra ' + hero.pt + '?';
}
