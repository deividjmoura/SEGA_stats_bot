// Display bilingual names without altering the source IDs or recommended item order.
// Rone Academy `lang=pt` is preferred when it returns a distinct localized label.
const ITEMS = {
  "Arcane Boots": "Botas Arcanas",
  "Swift Boots": "Botas Velozes",
  "Tough Boots": "Botas Resistentes",
  "Warrior Boots": "Botas de Guerreiro",
  "Magic Shoes": "Sapatos Mágicos",
  "Demon Shoes": "Sapatos Demoníacos",
  "Rapid Boots": "Botas Rápidas",
  "Corrosion Scythe": "Foice da Corrosão",
  "Demon Hunter Sword": "Espada do Caçador de Demônios",
  "Golden Staff": "Cajado Dourado",
  "Haas's Claws": "Garras de Haas",
  "Haas' Claws": "Garras de Haas",
  "Malefic Roar": "Rugido Maléfico",
  "Malefic Gun": "Arma Maléfica",
  "Genius Wand": "Varinha Genial",
  "Starlium Scythe": "Foice Estelar",
  "Holy Crystal": "Cristal Sagrado",
  "Divine Glaive": "Glaive Divina",
  "Blood Wings": "Asas de Sangue",
  "Winter Crown": "Coroa Invernal",
  "Concentrated Energy": "Energia Concentrada",
  "Glowing Wand": "Varinha Brilhante",
  "Antique Cuirass": "Couraça Antiga",
  "Immortality": "Imortalidade",
  "Blade of the Heptaseas": "Lâmina dos Sete Mares",
  "Hunter Strike": "Golpe do Caçador",
  "Blade of Despair": "Lâmina do Desespero",
  "Athena's Shield": "Escudo de Athena",
  "Radiant Armor": "Armadura Radiante",
  "Dominance Ice": "Gelo Dominante",
  "Blade Armor": "Armadura de Lâmina",
  "Windtalker": "Falador dos Ventos",
  "Berserker's Fury": "Fúria do Berserker",
  "Endless Battle": "Batalha Sem Fim",
  "Wind of Nature": "Vento da Natureza",
  "Rose Gold Meteor": "Meteoro de Ouro Rosa",
  "Sea Halberd": "Alabarda Marinha",
  "Great Dragon Spear": "Lança do Grande Dragão",
  "Brute Force Breastplate": "Peitoral da Força Bruta",
  "Thunder Belt": "Cinto do Trovão",
  "Sky Piercer": "Perfurador Celeste",
  "Oracle": "Oráculo",
  "Guardian Helmet": "Elmo do Guardião",
  "Cursed Helmet": "Elmo Amaldiçoado",
  "Twilight Armor": "Armadura do Crepúsculo",
  "Queen's Wings": "Asas da Rainha",
  "Clock of Destiny": "Relógio do Destino",
  "Lightning Truncheon": "Bastão Relâmpago",
  "Enchanted Talisman": "Talismã Encantado",
  "Ice Queen Wand": "Varinha da Rainha do Gelo",
  "Wishing Lantern": "Lanterna dos Desejos",
  "Feather of Heaven": "Pena do Céu",
  "Fleeting Time": "Tempo Efêmero",
  "Necklace of Durance": "Colar da Perseverança",
  "Flask of the Oasis": "Frasco do Oásis",
  "War Axe": "Machado de Guerra",
  "Bloodlust Axe": "Machado da Sede de Sangue",
  "Rose Gold Meteor": "Meteoro de Ouro Rosa",
  "Great Dragon Spear": "Lança do Grande Dragão",
  "Haas’s Claws": "Garras de Haas"
};
const EMBLEMS = {
  "Assassin": "Assassino",
  "Mage": "Mago",
  "Marksman": "Atirador",
  "Fighter": "Lutador",
  "Tank": "Tanque",
  "Support": "Suporte",
  "Common": "Comum",
  "Custom Assassin": "Assassino Personalizado",
  "Custom Mage": "Mago Personalizado",
  "Custom Marksman": "Atirador Personalizado",
  "Custom Fighter": "Lutador Personalizado",
  "Custom Tank": "Tanque Personalizado",
  "Custom Support": "Suporte Personalizado",
  "Custom Common": "Comum Personalizado",
  "Assassin Emblem": "Emblema de Assassino",
  "Mage Emblem": "Emblema de Mago",
  "Marksman Emblem": "Emblema de Atirador",
  "Fighter Emblem": "Emblema de Lutador",
  "Tank Emblem": "Emblema de Tanque",
  "Support Emblem": "Emblema de Suporte",
  "Weapons Master": "Mestre das Armas",
  "Rupture": "Ruptura",
  "Agility": "Agilidade",
  "Thrill": "Emoção",
  "Swift": "Veloz",
  "Fatal": "Fatal",
  "Inspire": "Inspiração",
  "Bargain Hunter": "Caçador de Pechinchas",
  "Seasoned Hunter": "Caçador Experiente",
  "Master Assassin": "Assassino Mestre",
  "Lethal Ignition": "Ignição Letal",
  "Impure Rage": "Fúria Impura",
  "Quantum Charge": "Carga Quântica",
  "Weakness Finder": "Detector de Fraqueza",
  "War Cry": "Grito de Guerra",
  "Brave Smite": "Golpe Corajoso",
  "Concussive Blast": "Explosão Concussiva",
  "Festival of Blood": "Festival de Sangue",
  "Pull Yourself Together": "Recomponha-se",
  "Tenacity": "Tenacidade",
  "Firmness": "Firmeza",
  "Vitality": "Vitalidade",
  "Magic Worship": "Adoração Mágica",
  "Mystery Shop": "Loja Misteriosa"
};
const SPELLS = {
  "Retribution": "Retribuição",
  "Bloody Retribution": "Retribuição Sangrenta",
  "Ice Retribution": "Retribuição de Gelo",
  "Flame Retribution": "Retribuição Flamejante",
  "Flicker": "Cintilar",
  "Sprint": "Corrida",
  "Inspire": "Inspirar",
  "Execute": "Executar",
  "Purify": "Purificar",
  "Petrify": "Petrificar",
  "Aegis": "Égide",
  "Revitalize": "Revitalizar",
  "Vengeance": "Vingança",
  "Arrival": "Chegada",
  "Flameshot": "Tiro Flamejante"
};
const ATTRIBUTES = {
  "Physical Attack": "Ataque Físico",
  "Magic Power": "Poder Mágico",
  "Physical Defense": "Defesa Física",
  "Magic Defense": "Defesa Mágica",
  "Physical Penetration": "Penetração Física",
  "Magic Penetration": "Penetração Mágica",
  "Adaptive Penetration": "Penetração Adaptativa",
  "Adaptive Attack": "Ataque Adaptativo",
  "Attack Speed": "Velocidade de Ataque",
  "Movement Speed": "Velocidade de Movimento",
  "Cooldown Reduction": "Redução de Recarga",
  "Spell Vamp": "Vampirismo de Habilidade",
  "Lifesteal": "Roubo de Vida",
  "HP Regen": "Regeneração de Vida",
  "Mana Regen": "Regeneração de Mana",
  "Crit Chance": "Chance de Crítico",
  "Critical Chance": "Chance de Crítico",
  "Critical Damage": "Dano Crítico"
};
function compact(text) {
  return String(text || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim();
}
function index(dictionary) {
  return new Map(Object.entries(dictionary).map(([en, pt]) => [compact(en), pt]));
}
const itemNames = index(ITEMS);
const emblemNames = index(EMBLEMS);
const spellNames = index(SPELLS);
function safeText(value) {
  return String(value ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 180);
}
export function bilingualLabel(english, portuguese = '', kind = 'item') {
  const original = safeText(english || portuguese);
  if (!original) return 'não informado';
  const fromApi = safeText(portuguese);
  const fromGlossary = (kind === 'item' ? itemNames : kind === 'emblem' ? emblemNames : spellNames).get(compact(original));
  // Don't render an invented translation or duplicate names if the provider
  // doesn't localize a newly introduced item yet.
  const pt = fromApi && compact(fromApi) !== compact(original) ? fromApi : fromGlossary;
  return pt && compact(pt) !== compact(original) ? original + ' (' + pt + ')' : original;
}
export function bilingualAttributes(value) {
  const raw = String(value || '').replace(/<[^>]*>/g, '').replace(/\\n|\r?\n/g, ' • ').trim();
  if (!raw) return '';
  let output = raw;
  // Longest first so "Physical Attack" is not translated inside another term.
  for (const [en, pt] of Object.entries(ATTRIBUTES).sort((a, b) => b[0].length - a[0].length)) {
    const escaped = en.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    output = output.replace(new RegExp('\\b' + escaped + '\\b', 'gi'), matched => matched + ' (' + pt + ')');
  }
  return output.replace(/\s*•\s*/g, ' • ').trim();
}
