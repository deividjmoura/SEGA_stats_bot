const knowledge = {
  silvanna: {
    aliases: ['silvanna', 'silvana'],
    items: [
      'Athena\'s Shield',
      'Radiant Armor',
      'Tough Boots',
      'Dominance Ice'
    ],
    heroes: ['Barats', 'Khufra', 'Masha', 'Edith', 'Karina'],
    answer:
      '🛡️ <b>CONTRA SILVANNA</b>\n\n' +
      'Se você está apanhando da Silvanna, a prioridade é reduzir o impacto do dano mágico e não deixar ela transformar a luta numa sessão particular de tortura. 😂\n\n' +
      '🧱 <b>Itens:</b> Athena\'s Shield para burst mágico; Radiant Armor para dano mágico repetido; Tough Boots quando o controle/slow estiver pesando; Dominance Ice é uma opção situacional quando a composição também depende de cura/lifesteal.\n\n' +
      '⚔️ <b>Heróis que aparecem bem nos dados atuais:</b> Barats, Khufra, Masha, Edith e Karina. O melhor depende da sua lane e da composição inteira.\n\n' +
      '💡 <b>Dica:</b> não escolha item só porque alguém publicou uma build. Veja se você precisa sobreviver ao burst, ao controle ou à sustentação do time inimigo. O jogo tem cinco inimigos, apesar de a Silvanna ser a que está gritando com você. 😂'
  }
};

export function answerMlbbQuestion(text) {
  const source = String(text || '').toLowerCase();
  const mentionsBot = /@sega(?:[ _]?stats)?(?:[ _]?bot)?\b/i.test(text);
  if (!mentionsBot) return null;

  if (knowledge.silvanna.aliases.some(alias => source.includes(alias))) {
    return knowledge.silvanna.answer;
  }

  if (/(equipamento|item|build|counter|contra)/i.test(text)) {
    return '🎮 Posso consultar counters e itens do MLBB. Por enquanto meu primeiro pacote de conhecimento está focado em Silvanna; vou ampliando por herói e matchup para não inventar build do nada.';
  }

  return '🎮 Tô na escuta. Pergunte algo como: <b>@SEGA Stats qual equipamento faço contra a Silvanna?</b>';
}
