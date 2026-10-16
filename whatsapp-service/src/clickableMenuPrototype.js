import { brandNoxInteractiveTitle } from './noxBranding.js';

// WhatsApp native-flow menus. Callers enforce chat permissions before sending.
export const NOX_MENU_OPTIONS = Object.freeze([
  { id: '!stats', title: '📊 Minhas estatísticas' },
  { id: '!ranking', title: '🏆 Ranking do clã' },
  { id: '!highlights', title: '🌟 Destaques' },
  { id: '!cadastrar', title: '🎮 Cadastrar jogador' },
  { id: '!agenda', title: '📅 Agenda do clã' },
  { id: '!sugestao', title: '💡 Sugestões' },
  { id: '!ajuda', title: '❓ Ajuda' },
]);

export function buildInteractiveList({ title, body, buttonText, rows }) {
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 10) {
    throw new Error('A lista interativa precisa de 1 a 10 opções');
  }
  if (new Set(rows.map(row => row.id)).size !== rows.length) {
    throw new Error('A lista interativa possui opções duplicadas');
  }
  const branded = brandNoxInteractiveTitle(title, body);
  return {
    interactiveMessage: {
      header: { title: branded.headerTitle, hasMediaAttachment: false },
      body: { text: branded.bodyText },
      footer: { text: '🐺 Clã Tenebrozos' },
      nativeFlowMessage: {
        buttons: [{
          name: 'single_select',
          buttonParamsJson: JSON.stringify({
            title: buttonText,
            sections: [{ title: 'Escolha uma opção', rows: rows.map(row => ({
              id: row.id,
              title: row.title,
              description: row.description || '',
            })) }],
          }),
        }],
        messageParamsJson: '{}',
        messageVersion: 1,
      },
    },
  };
}

export function buildSuggestionCategoryMenu() {
  return buildInteractiveList({
    title: '💡 SUGESTÕES DO NOX',
    body: 'O que você quer sugerir? Escolha o destino da sua ideia.',
    buttonText: '💡 TIPO DE SUGESTÃO',
    rows: [
      {id:'nox:suggestion:bot',title:'🛠️ Melhoria do bot',description:'Enviar diretamente ao responsável'},
      {id:'nox:suggestion:knowledge',title:'🧠 Conhecimento MLBB',description:'Passar pela revisão do André A.'},
    ],
  });
}

export function buildKnowledgeReviewMenu(proposal) {
  if (!/^[a-f0-9]{8}$/i.test(proposal?.id||'')) throw new Error('ID inválido');
  return buildInteractiveList({
    title: '🧠 REVISÃO DE CONHECIMENTO',
    body: 'Só o revisor autorizado pode aprovar ou rejeitar. Sugestão #'+proposal.id,
    buttonText: '⚖️ AVALIAR SUGESTÃO',
    rows: [
      {id:'nox:knowledge:approve:'+proposal.id,title:'✅ Aprovar direto'},
      {id:'nox:knowledge:approveedit:'+proposal.id,title:'✏️ Aprovar com edição'},
      {id:'nox:knowledge:reject:'+proposal.id,title:'❌ Rejeitar sugestão'},
    ],
  });
}

// Both pending and published knowledge can be selected from paginated lists.
export function buildKnowledgeRecordsMenu(records,status,page=0) {
  if(!['pending','approved'].includes(status))throw new Error('Status inválido');
  const perPage=8, pages=Math.max(1,Math.ceil(records.length/perPage));
  if(!Number.isInteger(page)||page<0||page>=pages||!records.length)throw new Error('Página inválida');
  const rows=records.slice(page*perPage,(page+1)*perPage).map(item=>({
    id:'nox:knowledge:open:'+status+':'+item.id,
    title:(String(item.hero||'Herói').slice(0,12)+' · '+String(item.id)).slice(0,24),
    description:(String(item.category||'')+' · '+String(item.content||'').slice(0,56)).slice(0,72)
  }));
  if(page>0)rows.push({id:'nox:knowledge:page:'+status+':'+(page-1),title:'⬅️ Página anterior'});
  if(page+1<pages)rows.push({id:'nox:knowledge:page:'+status+':'+(page+1),title:'➡️ Próxima página'});
  return buildInteractiveList({
    title:status==='pending'?'🧠 SUGESTÕES PENDENTES':'📚 CONHECIMENTOS APROVADOS',
    body:'Escolha um registro (página '+(page+1)+' de '+pages+'). '+
      'Se os botões não funcionarem, use o ID no comando de texto.',
    buttonText:'📚 ESCOLHER REGISTRO',
    rows,
  });
}

export function buildKnowledgeApprovedActionsMenu(item) {
  if(!/^[a-f0-9]{8}$/i.test(item?.id||''))throw new Error('ID inválido');
  return buildInteractiveList({
    title:'📚 CONHECIMENTO APROVADO',
    body:String(item.hero)+' · '+String(item.category)+' · ID '+item.id+
      '\n'+String(item.content).slice(0,420),
    buttonText:'⚙️ GERENCIAR',
    rows:[
      {id:'nox:knowledge:edit:'+item.id,title:'✏️ Editar informação'},
      {id:'nox:knowledge:delete:'+item.id,title:'🗑️ Excluir informação'},
    ],
  });
}

export function buildKnowledgeConfirmMenu(item,action) {
  if(!/^[a-f0-9]{8}$/i.test(item?.id||''))throw new Error('ID inválido');
  if(!['approveedit','edit','delete'].includes(action))throw new Error('Ação inválida');
  return buildInteractiveList({
    title:action==='delete'?'🗑️ CONFIRMAR EXCLUSÃO':'✏️ CONFIRMAR ALTERAÇÃO',
    body:String(item.hero)+' · '+item.id+'\n'+
      (action==='delete'?'Retirar esta informação das respostas do NOX?':
      'Confirmar o novo texto enviado na conversa?'),
    buttonText:'⚖️ CONFIRMAR',
    rows:[
      {id:'nox:knowledge:save:'+item.id,title:action==='delete'?'✅ Sim, excluir':'✅ Confirmar mudança'},
      {id:'nox:knowledge:cancel:'+item.id,title:'↩️ Cancelar'},
    ],
  });
}

export function buildNoxClickableMenu() {
  return buildInteractiveList({
    title: '🎮 NOX — MENU PRINCIPAL',
    body: 'Escolha uma opção no botão abaixo:',
    buttonText: '📋 ABRIR MENU',
    rows: NOX_MENU_OPTIONS,
  });
}

// Pagination ensures that every page fits WhatsApp's 10-row single-select limit.
export function buildAgendaEventChoices(events, mode, page = 0) {
  const perPage = 8;
  const totalPages = Math.max(1, Math.ceil(events.length / perPage));
  if (!Number.isInteger(page) || page < 0 || page >= totalPages) throw new Error('Página inválida');
  const from = page * perPage;
  const rows = events.slice(from, from + perPage).map(event => ({
    id: 'nox:event:' + event.id,
    title: String(event.title || 'Evento').slice(0, 24),
    description: new Date(event.date).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }).slice(0, 72),
  }));
  if (page > 0) rows.push({ id: 'nox:page:' + (page - 1), title: '⬅️ Página anterior' });
  if (page + 1 < totalPages) rows.push({ id: 'nox:page:' + (page + 1), title: '➡️ Próxima página' });
  return buildInteractiveList({
    title: mode === 'presencas' ? '👥 PRESENÇAS DO EVENTO' : mode === 'aprovarpresenca' ? '⚖️ AUTORIZAR PRESENÇA' : mode === 'editarevento' ? '✏️ EDITAR EVENTO' : '❌ CANCELAR EVENTO',
    body: 'Selecione o evento (página ' + (page + 1) + ' de ' + totalPages + '). Envie !sair para desistir.',
    buttonText: '📅 ESCOLHER EVENTO',
    rows,
  });
}

export function buildAgendaConfirmationChoice(event) {
  return buildInteractiveList({
    title: '❌ CONFIRMAR EXCLUSÃO',
    body: 'Deseja realmente cancelar "' + String(event.title).slice(0, 100) + '"?',
    buttonText: '⚠️ CONFIRMAR',
    rows: [
      { id: 'nox:confirm:sim', title: '✅ Sim, excluir evento' },
      { id: 'nox:confirm:nao', title: '↩️ Não, manter evento' },
    ],
  });
}

export function buildApprovalMemberChoices(members, event, page = 0) {
  const perPage=8;
  const totalPages=Math.max(1,Math.ceil(members.length/perPage));
  if (!members.length || !Number.isInteger(page) || page<0 || page>=totalPages) {
    throw new Error('Página inválida para autorização');
  }
  const rows=members.slice(page*perPage,(page+1)*perPage).map((member,i)=>({
    id: 'nox:approval:member:'+(page*perPage+i),
    title: String(member.name||'Integrante').slice(0,24),
    description:'Ainda não confirmou presença',
  }));
  if(page>0)rows.push({id:'nox:approval:page:'+(page-1),title:'⬅️ Anterior'});
  if(page+1<totalPages)rows.push({id:'nox:approval:page:'+(page+1),title:'➡️ Próxima página'});
  return buildInteractiveList({
    title:'⚖️ EXCEÇÃO DO CONSELHO',
    body:'Evento: '+String(event.title).slice(0,70)+' — escolha um integrante para autorizar.',
    buttonText:'👥 ESCOLHER INTEGRANTE',rows
  });
}
export function buildApprovalConfirmationChoice(event, member) {
  return buildInteractiveList({
    title:'⚖️ AUTORIZAR PRESENÇA',
    body:'Autorizar *'+String(member.name).slice(0,60)+'* em *'+String(event.title).slice(0,70)+'* após o prazo?',
    buttonText:'⚖️ DECISÃO DO CONSELHO',
    rows:[
      {id:'nox:approval:confirm',title:'✅ Autorizar presença'},
      {id:'nox:approval:cancel',title:'↩️ Não autorizar'},
    ]
  });
}

// Public RSVP menus use separate action IDs to prevent accidental admin commands.
export function buildRsvpEventChoices(events, attendance, page = 0) {
  const perPage = 8;
  const totalPages = Math.max(1, Math.ceil(events.length / perPage));
  if (!events.length || !Number.isInteger(page) || page < 0 || page >= totalPages) {
    throw new Error('Página da agenda inválida');
  }
  const rows = events.slice(page * perPage, (page + 1) * perPage).map(event => ({
    id: 'nox:rsvp:event:' + event.id,
    title: String(event.title || 'Evento').slice(0, 24),
    description: new Date(event.date).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) +
      ' · ' + Number(attendance?.[event.id] || 0) + ' confirmado(s)',
  }));
  if (page > 0) rows.push({ id: 'nox:rsvp:page:' + (page - 1), title: '⬅️ Página anterior' });
  if (page + 1 < totalPages) rows.push({ id: 'nox:rsvp:page:' + (page + 1), title: '➡️ Próxima página' });
  return buildInteractiveList({
    title: '📅 PARTICIPAR DE EVENTO',
    body: 'Quer participar de algum evento? Toque abaixo e escolha (página ' +
      (page + 1) + ' de ' + totalPages + ').',
    buttonText: '🎮 ESCOLHER EVENTO',
    rows,
  });
}

export function buildRsvpConfirmationChoice(event, alreadyConfirmed) {
  const date = new Date(event.date).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  return buildInteractiveList({
    title: alreadyConfirmed ? '✅ PRESENÇA CONFIRMADA' : '📅 CONFIRMAR PRESENÇA',
    body: String(event.title).slice(0, 100) + ' — ' + date +
      (alreadyConfirmed ? '\nVocê já confirmou sua participação. Deseja cancelar?' :
      '\nVocê confirma que vai participar?'),
    buttonText: '✅ RESPONDER',
    rows: alreadyConfirmed ? [
      { id: 'nox:rsvp:withdraw:' + event.id, title: '❌ Não vou mais' },
      { id: 'nox:rsvp:keep:' + event.id, title: '✅ Manter presença' },
    ] : [
      { id: 'nox:rsvp:confirm:' + event.id, title: '✅ Vou participar' },
      { id: 'nox:rsvp:decline:' + event.id, title: '↩️ Agora não' },
    ],
  });
}

// The "bot" flag on a message may cause WhatsApp to display thumbs up/down
// feedback controls. Keep only the native-flow metadata required for interaction.
export function buildNoxNativeFlowRelayNodes(now = Date.now()) {
  return [{
    tag: 'biz',
    attrs: {
      actual_actors: '2',
      host_storage: '2',
      privacy_mode_ts: String(Math.floor(now / 1000) - 77980457),
    },
    content: [{
      tag: 'interactive',
      attrs: { type: 'native_flow', v: '1' },
      content: [{ tag: 'native_flow', attrs: { v: '9', name: 'mixed' } }],
    }],
  }];
}

export async function sendNoxInteractiveMenu(sock, jid, generateWAMessageFromContent, menu, allowedGroupJids = []) {
  const privateJid = /^\d+@(s\.whatsapp\.net|lid)$/.test(jid);
  const approvedGroup = jid?.endsWith('@g.us') && allowedGroupJids.includes(jid);
  if (!privateJid && !approvedGroup) throw new Error('Destino do menu não autorizado');
  if (!sock?.user?.id || typeof sock.relayMessage !== 'function' || typeof generateWAMessageFromContent !== 'function') {
    throw new Error('Transporte Baileys não está disponível');
  }
  const message = generateWAMessageFromContent(jid, menu, { userJid: sock.user.id });
  if (!message?.key?.id || !message.message) throw new Error('Falha ao gerar mensagem interativa');
  await sock.relayMessage(jid, message.message, {
    messageId: message.key.id,
    additionalNodes: buildNoxNativeFlowRelayNodes(),
  });
  return message;
}

export function isInteractiveChoice(message) {
  for (let current = message, i = 0; current && i < 6; i++) {
    if (current.interactiveResponseMessage?.nativeFlowResponseMessage ||
        current.listResponseMessage?.singleSelectReply) return true;
    current = current.ephemeralMessage?.message || current.viewOnceMessage?.message ||
      current.viewOnceMessageV2?.message || current.viewOnceMessageV2Extension?.message;
  }
  return false;
}

// Compatibility during rollout: keep existing production imports working.
export function sendPrivateNoxMenuPrototype(sock, jid, generator) {
  return sendNoxInteractiveMenu(sock, jid, generator, buildNoxClickableMenu());
}
