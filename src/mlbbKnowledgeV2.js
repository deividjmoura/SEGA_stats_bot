import knowledge from '../data/mlbb-knowledge.json' with { type: 'json' };

const compact = (value) => String(value || '')
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

function findHero(text) {
  const source = compact(text);
  for (const [key, hero] of Object.entries(knowledge.heroes)) {
    const names = [key, hero.pt, hero.en, ...(hero.aliases || [])];
    if (names.some(name => {
      const n = compact(name);
      return n && (source === n || source.includes(' ' + n + ' ') || source.startsWith(n + ' ') || source.endsWith(' ' + n));
    })) return { key, ...hero };
  }
  return null;
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
  return { heroes: Object.keys(knowledge.heroes).length, items: Object.keys(knowledge.items).length, version: knowledge.version, updatedAt: knowledge.updatedAt };
}

export function answerMlbbQuestion(text) {
  const hero = findHero(text);
  const intent = intentOf(text);
  if (!hero) return intent !== 'unknown' ? '🎮 <b>Não identifiquei o herói.</b>\n\nTente escrever o nome em português ou inglês. Ex.: <code>@SEGA Stats quem countera Harley?</code>' : null;

  const title = hero.pt + ' (' + hero.en + ')';

  if (intent === 'counter') {
    return '⚔️ <b>COUNTERS DE ' + title.toUpperCase() + '</b>\n\n' +
      hero.counters.map(name => '• ' + canonicalHeroName(name)).join('\n') +
      '\n\n📌 <b>Importante:</b> counter não é garantia de vitória. O resultado muda conforme rank, composição, execução e patch.\n📊 Snapshot de matchup pesquisado para o SEGA Stats.';
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
