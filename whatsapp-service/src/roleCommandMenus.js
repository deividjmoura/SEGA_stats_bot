// Role-scoped interactive menus. A row ID is never treated as an arbitrary command:
// every click is resolved through the fixed allowlist for the current chat role.
import { buildInteractiveList } from './clickableMenuPrototype.js';

export const ROLE_MENU_ITEMS = Object.freeze({
  conselho: Object.freeze([
    {key:'agenda',title:'📅 Ver agenda',command:'!agenda',description:'Próximos eventos e horários'},
    {key:'agendar',title:'➕ Agendar evento',command:'!agendar',description:'Nome, data e horário'},
    {key:'editarevento',title:'✏️ Editar evento',command:'!editarevento',description:'Escolher e alterar um evento'},
    {key:'cancelarevento',title:'❌ Cancelar evento',command:'!cancelarevento',description:'Excluir com confirmação'},
    {key:'presencas',title:'👥 Consultar presenças',command:'!presencas',description:'Confirmados e ausentes'},
    {key:'aprovarpresenca',title:'⚖️ Autorizar presença',command:'!aprovarpresenca',description:'Permitir exceção ao prazo'},
    {key:'guia',title:'📖 Todos os comandos',command:'!comandosadm detalhes',description:'Instruções e permissões'},
  ]),
  revisor: Object.freeze([
    {key:'propostas',title:'📥 Avaliar sugestões',command:'!propostas',description:'Selecionar e aprovar/reprovar'},
    {key:'conhecimentos',title:'📚 Conhecimentos salvos',command:'!conhecimentos',description:'Consultar, editar e excluir'},
    {key:'guia',title:'📖 Todos os comandos',command:'!comandosrevisor detalhes',description:'Aprovações, edição e segurança'},
  ]),
  dono: Object.freeze([
    {key:'revisor',title:'🔐 Revisor atual',command:'!revisor',description:'Consultar permissão ativa'},
    {key:'listar',title:'🎮 Jogadores verificados',command:'!revisor listar',description:'Nicks e IDs cadastrados'},
    {key:'autorizar',title:'✅ Definir revisor',description:'Escolher jogador verificado'},
    {key:'revogar',title:'🚫 Revogar revisor',description:'Exige confirmação'},
    {key:'grupos',title:'🏠 Grupos NOX',command:'!grupos',description:'Identificadores da comunidade'},
    {key:'guia',title:'📖 Todos os comandos',command:'!comandosdono detalhes',description:'Lista completa do proprietário'},
  ]),
});

export function buildRoleCommandsMenu(role) {
  const entries=ROLE_MENU_ITEMS[role];
  if(!entries)throw new Error('Papel de menu inválido');
  const headings={
    conselho:'👑 COMANDOS DO CONSELHO',
    revisor:'⚖️ COMANDOS DO REVISOR',
    dono:'🔐 COMANDOS DO DONO',
  };
  return buildInteractiveList({
    title:headings[role],
    body:'Escolha uma função. Se o menu clicável não abrir, use os comandos escritos na mensagem de ajuda.',
    buttonText:'📋 ESCOLHER COMANDO',
    rows:entries.map(item=>({
      id:'nox:role:'+role+':'+item.key,
      title:item.title,
      description:item.description
    }))
  });
}

export function resolveRoleClick(id,expectedRole) {
  if(!ROLE_MENU_ITEMS[expectedRole])return null;
  const matched=/^nox:role:(conselho|revisor|dono):([a-z]+)$/.exec(String(id||''));
  if(!matched||matched[1]!==expectedRole)return null;
  return ROLE_MENU_ITEMS[expectedRole].find(item=>item.key===matched[2])||null;
}

export function buildOwnerReviewerPicker(players,page=0) {
  const perPage=8,pages=Math.max(1,Math.ceil(players.length/perPage));
  if(!players.length||!Number.isInteger(page)||page<0||page>=pages)throw new Error('Página de jogadores inválida');
  const rows=players.slice(page*perPage,(page+1)*perPage).map((p,i)=>({
    id:'nox:owner:pick:'+(page*perPage+i),
    title:String(p.nick||'Jogador').slice(0,24),
    description:'Role ID '+p.roleId+' · Zone '+p.zoneId
  }));
  if(page>0)rows.push({id:'nox:owner:page:'+(page-1),title:'⬅️ Anterior'});
  if(page+1<pages)rows.push({id:'nox:owner:page:'+(page+1),title:'➡️ Próxima'});
  return buildInteractiveList({
    title:'🔐 DEFINIR REVISOR',
    body:'Escolha uma conta verificada (página '+(page+1)+' de '+pages+').'+
      ' A autorização só será aplicada depois de confirmar.',
    buttonText:'🎮 ESCOLHER JOGADOR',
    rows
  });
}

export function buildOwnerConfirmMenu(kind,nick='') {
  if(!['assign','revoke'].includes(kind))throw new Error('Decisão inválida');
  return buildInteractiveList({
    title:kind==='assign'?'✅ CONFIRMAR REVISOR':'🚫 REVOGAR REVISOR',
    body:kind==='assign'
      ? 'Autorizar *'+String(nick).slice(0,65)+'* como revisor exclusivo?'
      : 'Revogar a permissão do revisor atual? Nenhuma dica aprovada será apagada.',
    buttonText:'🔐 CONFIRMAR',
    rows:[
      {id:'nox:owner:confirm:'+kind,title:kind==='assign'?'✅ Autorizar':'🚫 Sim, revogar'},
      {id:'nox:owner:cancel',title:'↩️ Cancelar'},
    ],
  });
}
