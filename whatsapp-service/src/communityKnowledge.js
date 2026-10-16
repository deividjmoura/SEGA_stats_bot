// Reviewed, opt-in community knowledge. No suggestion is trusted before approval.
export const KNOWLEDGE_CATEGORIES = Object.freeze({
  counter: 'Counters',
  build: 'Build',
  item: 'Itens',
  dica: 'Dicas',
});

export function normalizeKnowledgeCategory(text) {
  const normalized = String(text||'').trim().normalize('NFD')
    .replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const category = {
    counter:'counter',counters:'counter',countera:'counter',
    build:'build',builds:'build',
    item:'item',itens:'item',items:'item',
    dica:'dica',dicas:'dica',tips:'dica',
  }[normalized];
  return category || null;
}

export function safeKnowledgeText(value, limit=600) {
  return String(value || '')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/(?:https?:\/\/|www\.)\S+/gi, '[link removido]')
    .replace(/@(?=\S)/g, 'arroba-')
    .replace(/[*_~]/g, '')
    .replace(/\s+/g,' ').trim().slice(0,limit);
}

export function parseKnowledgeSubmission(command, resolveHero) {
  const match = /^!conhecimento\s+([^|]{2,75})\s*\|\s*([^|]{2,20})\s*\|\s*(.{1,1500})$/is.exec(String(command||'').trim());
  if (!match) return {ok:false,error:'Use *!conhecimento Herói | counter/build/item/dica | informação*.'};
  const hero=typeof resolveHero==='function' ? resolveHero(match[1].trim()) : null;
  if (!hero) return {ok:false,error:'Não reconheci o herói. Use o nome exato do Mobile Legends.'};
  const category=normalizeKnowledgeCategory(match[2]);
  if(!category) return {ok:false,error:'Categoria inválida. Escolha *counter*, *build*, *item* ou *dica*.'};
  const content=safeKnowledgeText(match[3]);
  if(content.length<20) return {ok:false,error:'Descreva a dica com pelo menos 20 caracteres e explique o motivo.'};
  if(content.includes('[link removido]')) return {ok:false,error:'Não envie links. Escreva a sugestão diretamente no texto.'};
  if(content.length>580) return {ok:false,error:'Sugestão muito longa. Limite de 580 caracteres.'};
  return {ok:true,hero,category,content};
}

export function emptyKnowledgeState(){
  return {reviewer:null,proposals:[]};
}

export function validKnowledgeState(raw) {
  const val=raw && typeof raw==='object'&&!Array.isArray(raw)?raw:{};
  return {reviewer:val.reviewer && typeof val.reviewer==='object'?val.reviewer:null,
    proposals:Array.isArray(val.proposals)?val.proposals:[]};
}

export function isVerifiedReviewer(player, config){
  return Boolean(player?.nameVerified===true && config?.roleId && config?.zoneId
    && String(player.roleId)===String(config.roleId)
    && String(player.zoneId)===String(config.zoneId));
}

export function appendPendingKnowledge(state, payload, now=Date.now()) {
  const doc=validKnowledgeState(state);
  if(doc.proposals.length>=1000) return {ok:false,error:'O histórico está cheio; avise os administradores.'};
  const authorIds=Array.isArray(payload.authorIds)?payload.authorIds:[];
  if(!authorIds.length) return {ok:false,error:'Não consegui identificar o remetente.'};
  const pending=doc.proposals.filter(p=>p.status==='pending');
  if(pending.length>=100) return {ok:false,error:'Muitas sugestões pendentes. Tente novamente mais tarde.'};
  const sameAuthor=pending.filter(p=>p.authorIds?.some(id=>authorIds.includes(id)));
  if(sameAuthor.length>=3) return {ok:false,error:'Você já tem 3 sugestões aguardando análise.'};
  const previous=doc.proposals.filter(p=>p.authorIds?.some(id=>authorIds.includes(id))).at(-1);
  if(previous && Date.parse(previous.submittedAt)>now-60*1000) {
    return {ok:false,error:'Aguarde pelo menos 1 minuto antes de enviar outra dica.'};
  }
  if(pending.some(p=>p.hero===payload.hero && p.category===payload.category
      && p.content.toLowerCase()===payload.content.toLowerCase())) {
    return {ok:false,error:'Essa sugestão já está aguardando avaliação.'};
  }
  const proposed={id:payload.id,hero:payload.hero,category:payload.category,
    content:payload.content,authorIds,authorName:safeKnowledgeText(payload.authorName,65)||'Integrante',
    status:'pending',submittedAt:new Date(now).toISOString()};
  return {ok:true,data:{...doc,proposals:[...doc.proposals,proposed]},proposal:proposed};
}

export function reviewKnowledge(state,id,verdict,reviewerName,now=Date.now(),correction=null){
  const doc=validKnowledgeState(state);
  if(!['approved','rejected'].includes(verdict))return {ok:false,error:'Decisão inválida.'};
  const index=doc.proposals.findIndex(p=>p.id===id && p.status==='pending');
  if(index<0) return {ok:false,error:'Sugestão inexistente ou já analisada.'};
  const previous=doc.proposals[index];
  const improved=correction==null?previous.content:safeKnowledgeText(correction);
  if(improved.length<20||improved.length>580)return {ok:false,error:'A correção precisa ter entre 20 e 580 caracteres.'};
  const proposal={...previous,content:improved,status:verdict,
    reviewedAt:new Date(now).toISOString(),reviewedBy:safeKnowledgeText(reviewerName,65)};
  const proposals=[...doc.proposals];proposals[index]=proposal;
  return {ok:true,data:{...doc,proposals},proposal};
}

// The reviewer may correct text before approval, revise previously approved
// knowledge or remove it from answers. Original submissions are never erased.
function updatedKnowledgeText(input) {
  const text=safeKnowledgeText(input,600);
  if(text.length<20 || text.length>580 || text.includes('[link removido]'))
    return {ok:false,error:'A descrição deve ter entre 20 e 580 caracteres, sem links.'};
  return {ok:true,text};
}
function updatedKnowledgeProposal(state,id,requiredStatus,actor,change,now=Date.now()) {
  const doc=validKnowledgeState(state);
  const index=doc.proposals.findIndex(p=>p.id===id && p.status===requiredStatus);
  if(index<0) return {ok:false,error:'Conhecimento não encontrado nesse status ou já alterado.'};
  const before=doc.proposals[index];
  const after=change(before,new Date(now).toISOString(),safeKnowledgeText(actor,65));
  if(!after?.ok) return {ok:false,error:after?.error||'Alteração inválida.'};
  const proposals=[...doc.proposals];
  proposals[index]=after.proposal;
  return {ok:true,data:{...doc,proposals},proposal:after.proposal};
}

export function approveKnowledgeWithEdit(state,id,text,reviewer,now=Date.now()) {
  const checked=updatedKnowledgeText(text);
  if(!checked.ok)return checked;
  return updatedKnowledgeProposal(state,id,'pending',reviewer,(before,time,name)=>({
    ok:true,proposal:{
      ...before,
      originalContent:before.originalContent||before.content,
      content:checked.text,status:'approved',reviewedBy:name,reviewedAt:time,
      revisions:[...(before.revisions||[]).slice(-19),
        {kind:'approval_edit',before:before.content,after:checked.text,by:name,at:time}]
    }
  }),now);
}

export function editApprovedKnowledge(state,id,text,reviewer,now=Date.now()) {
  const checked=updatedKnowledgeText(text);
  if(!checked.ok)return checked;
  return updatedKnowledgeProposal(state,id,'approved',reviewer,(before,time,name)=>{
    if(checked.text===before.content)return {ok:false,error:'A nova descrição é igual à atual.'};
    return {ok:true,proposal:{
      ...before,
      content:checked.text,
      updatedAt:time,updatedBy:name,
      revisions:[...(before.revisions||[]).slice(-19),
        {kind:'edit',before:before.content,after:checked.text,by:name,at:time}]
    }};
  },now);
}

export function deleteApprovedKnowledge(state,id,reviewer,now=Date.now()) {
  return updatedKnowledgeProposal(state,id,'approved',reviewer,(before,time,name)=>({
    ok:true,proposal:{
      ...before,status:'deleted',deletedAt:time,deletedBy:name,
      revisions:[...(before.revisions||[]).slice(-19),
        {kind:'delete',before:before.content,by:name,at:time}]
    }
  }),now);
}

export function listKnowledgeByStatus(state,status) {
  return validKnowledgeState(state).proposals
    .filter(p=>p.status===status && /^[a-f0-9]{8}$/i.test(p.id||''))
    .sort((a,b)=>String(b.submittedAt||'').localeCompare(String(a.submittedAt||'')));
}

export function matchApprovedKnowledge(state,hero,intent){
  const category=({counter:'counter',items:'item',build:'build',tips:'dica'})[intent];
  if(!category||!hero)return [];
  const query=String(hero).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  return validKnowledgeState(state).proposals
    .filter(p=>p.status==='approved'&&p.category===category&&String(p.hero)
      .normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()===query)
    .slice(-3);
}
