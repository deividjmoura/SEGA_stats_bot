import makeWASocket, { DisconnectReason, useMultiFileAuthState, Browsers, proto, generateWAMessageFromContent } from '@whiskeysockets/baileys';
import pino from 'pino';
import { NOX_MENU_OPTIONS, buildNoxClickableMenu, buildAgendaEventChoices, buildAgendaConfirmationChoice, buildRsvpEventChoices, buildRsvpConfirmationChoice, buildApprovalMemberChoices, buildApprovalConfirmationChoice, buildSuggestionCategoryMenu, buildKnowledgeReviewMenu, buildKnowledgeRecordsMenu, buildKnowledgeApprovedActionsMenu, buildKnowledgeConfirmMenu, sendNoxInteractiveMenu, isInteractiveChoice } from './clickableMenuPrototype.js';
import { dueAgendaActions, isRsvpOpen, participantAliases, partitionRoster, RSVP_CLOSE_BEFORE_MS } from './agendaTiming.js';
import { brandNoxText } from './noxBranding.js';
import { buildRoleCommandsMenu, resolveRoleClick, ROLE_MENU_ITEMS, buildOwnerReviewerPicker, buildOwnerConfirmMenu } from './roleCommandMenus.js';
import { parseKnowledgeSubmission, normalizeKnowledgeCategory, validKnowledgeState, isVerifiedReviewer, appendPendingKnowledge, reviewKnowledge, approveKnowledgeWithEdit, editApprovedKnowledge, deleteApprovedKnowledge, listKnowledgeByStatus, matchApprovedKnowledge, KNOWLEDGE_CATEGORIES, safeKnowledgeText } from './communityKnowledge.js';
import { validateAgendaDay, validateAgendaSchedule, agendaValidationMessage } from './agendaDateValidation.js';
import { isVagueWinQuestion, makeUnknownQuestionRoast } from './unknownQuestionRoasts.js';
import { attendeeIds, attendanceFor, attendanceCount, isAttending, changeAttendance, removeEventAttendance } from './agendaAttendance.js';
import { ANNOUNCEMENT_NOTICE, isAnnouncementPost, selectCommunityAnnouncementsGroup, buildAnnouncementMentionMessage } from './announcementRouting.js';
import { shouldProcessPrivateMessage, shouldProcessRegistrationPrivateMessage } from './privateChatRouting.js';
import { ownerIdentityMatchesPhone } from './ownerIdentity.js';
import crypto from 'node:crypto';
import { makeMentionRoast as roastFor } from './mentionRoasts.js';
import { isExplicitGroupInteraction } from './groupTriggerPolicy.js';
import { createNoxAiAssistant } from './noxAiAssistant.js';
import { createNoxBraveSearch } from './noxAiSearch.js';
import { collectMentionJids } from './mentionDetection.js';
import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import { apiFetch, isApiSuccess, apiErrorMessage, profileName, battleBelongsToPlayer, normalizeVerifiedMatch, fetchPlayerOverview } from './roneApi.js';
import { loadSeasonStats, formatSeasonStats } from './seasonStats.js';
import { sendStatsWithOptionalSeason } from './statsReplyFlow.js';
import { answerMlbbQuestion, listKnowledgeExamples, canonicalMlbbHero, intentOf } from './mlbbKnowledgeV2.js';
import { createOutgoingEchoGuard, ownerKnowledgeQuestion } from './messageSafety.js';

const REGISTRATION_TTL_MS = 15 * 60 * 1000;
const logger = pino({ level: 'silent' });
const authDir = process.env.WHATSAPP_AUTH_DIR || '/app/data/whatsapp-auth-v2';
const dataDir = process.env.WHATSAPP_DATA_DIR || '/app/data';
const sessionsFile = dataDir + '/whatsapp-players.json';
const registrationsFile = dataDir + '/whatsapp-registrations.json';
const battlesFile = dataDir + '/whatsapp-battles.json';
const announcementsFile = dataDir + '/whatsapp-announcement-deliveries.json';
const agendaFile = dataDir + '/whatsapp-agenda.json';
const communityKnowledgeFile = dataDir + '/whatsapp-community-knowledge.json';
let communityKnowledgeWrites = Promise.resolve();
async function readCommunityKnowledge() {
  return validKnowledgeState(await readJson(communityKnowledgeFile,{reviewer:null,proposals:[]}));
}
async function updateCommunityKnowledge(transform) {
  const op = communityKnowledgeWrites.then(async () => {
    const current = await readCommunityKnowledge();
    const result = transform(current);
    if (result?.data) await writeJson(communityKnowledgeFile,result.data);
    return result;
  });
  communityKnowledgeWrites = op.catch(()=>{});
  return op;
}
const attendanceFile = dataDir + '/whatsapp-attendance.json';
const attendanceAlertsFile = dataDir + '/whatsapp-attendance-alerts.json';
// The official clan roster is in the Integrantes group; it is never a command destination.
const membersGroup = process.env.WHATSAPP_MEMBERS_GROUP_JID || '120363432845996995@g.us';
const rsvpSessions = new Map();
const RSVP_SESSION_TTL_MS = 10 * 60 * 1000;
let attendanceWrites = Promise.resolve();

async function readAttendance() {
  const saved = await readJson(attendanceFile, {});
  return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
}
async function updateAttendance(transform) {
  // Serialize read/modify/write so simultaneous WhatsApp clicks cannot erase RSVPs.
  const op = attendanceWrites.then(async () => {
    const before = await readAttendance();
    const result = transform(before);
    if (result?.data) await writeJson(attendanceFile, result.data);
    return result;
  });
  attendanceWrites = op.catch(() => {});
  return op;
}
async function upcomingAgendaEvents() {
  const saved = await readJson(agendaFile, []);
  return (Array.isArray(saved) ? saved : [])
    .filter(event => /^[a-f0-9]{8}$/i.test(event?.id || '') &&
      Number.isFinite(Date.parse(event?.date)) && Date.parse(event.date) > Date.now())
    .sort((a,b) => a.date.localeCompare(b.date));
}
function rsvpActorIds(key) {
  return attendeeIds([key?.participant, key?.participantAlt,
    ...(key?.fromMe ? [ownJid, ...ownerAccountJids] : [])]
    .filter(Boolean).flatMap(linkedAliases));
}
function rsvpSessionKeys(jid, ids) {
  return ids.map(id => jid + ':' + id);
}
function storeRsvpSession(jid,ids,session) {
  for (const key of rsvpSessionKeys(jid,ids)) rsvpSessions.set(key,session);
}
function findRsvpSession(jid,ids) {
  return rsvpSessionKeys(jid,ids).map(key=>rsvpSessions.get(key)).find(Boolean);
}
function deleteRsvpSession(jid,ids) {
  const session=findRsvpSession(jid,ids);
  if(!session)return;
  for(const [key,value] of rsvpSessions)if(value===session)rsvpSessions.delete(key);
}
function readableAttendeeName(entry) {
  const player = (entry.ids || []).map(playerForJid).find(Boolean);
  return String(player?.name || entry.name || 'Participante')
    .replace(/[\r\n\t]+/g, ' ').trim().slice(0, 70);
}
// Text RSVP also works when a WhatsApp client cannot render native-flow buttons.
async function handleDirectRsvp(sock, message, rawText) {
  const match = /^!(confirmar|desistir) ([a-f0-9]{8})$/i.exec(rawText);
  if (!match) return false;
  const jid = message.key.remoteJid;
  if (jid !== targetGroup) return false;
  const ids = rsvpActorIds(message.key);
  if (!ids.length) {
    await sendText(sock,jid,'⚠️ Não consegui identificar seu WhatsApp. Tente novamente.');
    return true;
  }
  const [command, verb, requestedId] = match;
  const event = (await upcomingAgendaEvents()).find(item => item.id === requestedId.toLowerCase());
  if (!event) {
    await sendText(sock,jid,'⚠️ Evento não encontrado. Envie !agenda para consultar os IDs válidos.');
    return true;
  }
  if (!isRsvpOpen(event)) {
    await sendText(sock,jid,'🔒 Confirmações encerradas: o prazo acaba 30 minutos antes do evento. Apenas o Conselho pode autorizar exceções.');
    return true;
  }
  const attending = verb.toLowerCase() === 'confirmar';
  const name = ids.map(playerForJid).find(Boolean)?.name ||
    message.pushName || ids.map(id=>whatsappName(id,'')).find(Boolean) || 'Participante';
  const result = await updateAttendance(state=>changeAttendance(state,event.id,ids,name,attending));
  const count = attendanceCount(result.data,event.id);
  if (!result.changed) {
    await sendText(sock,jid,attending
      ? '✅ Sua presença já estava confirmada em *'+event.title+'*. 👥 '+count+' confirmado(s).'
      : 'ℹ️ Você não estava na lista de confirmados de *'+event.title+'*.');
    return true;
  }
  await sendText(sock,jid,attending
    ? '✅ Presença confirmada em *'+event.title+'*! 👥 '+count+' confirmado(s). Prazo: até 30 minutos antes do evento.'
    : '✅ Sua confirmação foi retirada de *'+event.title+'*. 👥 '+count+' confirmado(s).');
  return true;
}

async function sendRsvpAgenda(sock, message) {
  const jid = message.key.remoteJid;
  const ids = rsvpActorIds(message.key);
  if (!ids.length) {
    await sendText(sock, jid, '⚠️ Não consegui identificar seu perfil do WhatsApp para confirmar presença.');
    return;
  }
  const events = await upcomingAgendaEvents();
  if (!events.length) {
    await sendText(sock, jid, '📅 Não há eventos futuros cadastrados no momento.');
    return;
  }
  const state = await readAttendance();
  const openEvents=events.filter(event=>isRsvpOpen(event));
  const counts = Object.fromEntries(openEvents.map(event => [event.id, attendanceCount(state,event.id)]));
  await sendText(sock,jid,(await agendaText()) +
    '\n\n📱 *Se o menu clicável não abrir no seu WhatsApp:* envie *!confirmar ID* ou *!desistir ID*, usando o ID exibido no evento.');
  if (!openEvents.length) {
    await sendText(sock,jid,'⏰ O prazo de confirmação dos próximos eventos já encerrou. Só o Conselho pode autorizar exceções.');
    return;
  }
  const session = { step:'pick', page:0, expires:Date.now()+RSVP_SESSION_TTL_MS };
  storeRsvpSession(jid,ids,session);
  try {
    await sendInteractive(sock,jid,buildRsvpEventChoices(openEvents,counts,0),[targetGroup]);
  } catch (error) {
    console.warn('Menu da agenda não renderizado; os comandos de texto permanecem disponíveis:',error?.message);
  }
}
async function handleRsvpChoice(sock, message, action) {
  const jid = message.key.remoteJid;
  const ids = rsvpActorIds(message.key);
  if (!ids.length) {
    await sendText(sock,jid,'⚠️ Não consegui confirmar sua identidade. Abra !agenda novamente.');
    return;
  }
  const match=action.match(/^nox:rsvp:(page|event|confirm|decline|withdraw|keep):([a-f0-9]{8}|\d+)$/i);
  if (!match) return;
  const [, kind, value] = match;
  const events=(await upcomingAgendaEvents()).filter(event=>isRsvpOpen(event));
  let session = findRsvpSession(jid,ids);
  // Reminder menus are shared with the whole Geral. A player can tap one without
  // first opening a personal !agenda session during the final 30-minute window.
  if ((!session || session.expires <= Date.now()) && kind==='event') {
    const reminderEvent=events.find(event=>event.id===value.toLowerCase() &&
      Date.now()>=Date.parse(event.date)-60*60*1000);
    if(reminderEvent) {
      deleteRsvpSession(jid,ids);
      session={step:'confirm',eventId:reminderEvent.id,
        expires:Date.now()+RSVP_SESSION_TTL_MS};
      storeRsvpSession(jid,ids,session);
      const state=await readAttendance();
      await sendInteractive(sock,jid,
        buildRsvpConfirmationChoice(reminderEvent,isAttending(state,reminderEvent.id,ids)),
        [targetGroup]);
      return;
    }
  }
  if (!session || session.expires <= Date.now()) {
    deleteRsvpSession(jid,ids);
    await sendText(sock,jid,'⌛ Escolha expirada ou prazo encerrado. Envie !agenda para verificar eventos disponíveis.');
    return;
  }
  if (kind==='page') {
    const page=Number(value);
    if (session.step!=='pick' || !Number.isInteger(page) || page<0 || page>=Math.ceil(events.length/8)) {
      await sendText(sock,jid,'⚠️ Página inválida. Envie !agenda novamente.');
      return;
    }
    session.page=page;
    const state=await readAttendance();
    const counts=Object.fromEntries(events.map(event => [event.id,attendanceCount(state,event.id)]));
    await sendInteractive(sock,jid,buildRsvpEventChoices(events,counts,page),[targetGroup]);
    return;
  }
  const event=events.find(item => item.id === value.toLowerCase());
  if (!event) {
    deleteRsvpSession(jid,ids);
    await sendText(sock,jid,'⏰ Evento indisponível ou prazo encerrado. Confirmações fecham *30 minutos antes* do início. Exceções precisam de aprovação do Conselho.');
    return;
  }
  if (kind==='event') {
    if (session.step!=='pick' ||
        !events.slice(session.page*8,session.page*8+8).some(item=>item.id===event.id)) {
      await sendText(sock,jid,'⚠️ Escolha um evento da lista mais recente.');
      return;
    }
    session.step='confirm';
    session.eventId=event.id;
    const state=await readAttendance();
    await sendInteractive(sock,jid,buildRsvpConfirmationChoice(event,isAttending(state,event.id,ids)),[targetGroup]);
    return;
  }
  if (session.step!=='confirm' || session.eventId!==event.id) {
    await sendText(sock,jid,'⚠️ Confirmação inválida. Abra !agenda novamente.');
    return;
  }
  deleteRsvpSession(jid,ids);
  if (kind==='decline' || kind==='keep') {
    await sendText(sock,jid,kind==='decline' ? '↩️ Tudo bem! Nenhuma presença foi adicionada.' :
      '✅ Sua confirmação de participação continua ativa.');
    return;
  }
  if (kind!=='confirm' && kind!=='withdraw') return;
  const attending=kind==='confirm';
  const actorName=String(ids.map(playerForJid).find(Boolean)?.name ||
    message?.pushName || ids.map(id=>whatsappName(id,'')).find(Boolean) || 'Participante');
  const result=await updateAttendance(state=>changeAttendance(state,event.id,ids,actorName,attending));
  const count=attendanceCount(result.data,event.id);
  await sendText(sock,jid,attending
    ? '✅ Presença confirmada em *'+event.title+'*! 👥 '+count+' participante(s) confirmado(s). ⏰ O prazo termina *30 minutos antes* do evento. Para desistir dentro do prazo, abra !agenda novamente.'
    : '✅ Sua presença foi retirada de *'+event.title+'*. 👥 '+count+' participante(s) confirmado(s).');
}

const adminsGroup = process.env.WHATSAPP_ADMINS_GROUP_JID || null;
async function agendaText() {
  const events = await upcomingAgendaEvents();
  const attendance = await readAttendance();
  return events.length ? '📅 *AGENDA DO CLÃ*\n\n' +
    events.map(e => '• *' + e.title + '* — ' +
      new Date(e.date).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}) +
      '\n  👥 ' + attendanceCount(attendance,e.id) + ' confirmado(s) · ' +
      (isRsvpOpen(e) ? '⏰ Confirme até '+new Date(Date.parse(e.date)-RSVP_CLOSE_BEFORE_MS).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}) : '🔒 Confirmações encerradas') +
      ' · ID: ' + e.id).join('\n') +
    '\n\n🎮 No *Geral*, envie !agenda e toque em um evento para confirmar presença. ⚠️ A confirmação é obrigatória até *30 minutos antes* do início; depois, somente com aprovação do Conselho.'
    : '📅 Nenhum evento futuro cadastrado.';
}
// The reference population is the official Integrantes group, never the larger Geral.
async function getClanMemberRoster(sock) {
  if (!membersGroup || membersGroup===targetGroup || membersGroup===adminsGroup) {
    throw new Error('Grupo Integrantes sem configuração segura');
  }
  const metadata=await sock.groupMetadata(membersGroup);
  if (!metadata?.participants || !Array.isArray(metadata.participants)) {
    throw new Error('Integrantes indisponíveis na conta conectada');
  }
  for (const member of metadata.participants) {
    const ids=participantAliases(member);
    if (ids.length>1) linkIdentities(ids);
    const name=member?.notify || member?.name || member?.verifiedName || member?.username;
    if(name) for(const id of ids) rememberGroupName(id,name);
  }
  return metadata.participants.filter(member=>participantAliases(member).length);
}

function memberLabel(member,index) {
  const ids=participantAliases(member);
  const verified=ids.map(playerForJid).find(Boolean)?.name;
  const saved=ids.map(id=>whatsappName(id,'')).find(Boolean);
  const label=verified || member?.notify || member?.name || member?.verifiedName ||
    member?.username || saved || 'Integrante sem nome #' +(index+1);
  return String(label).replace(/[\r\n\t]+/g,' ').trim().slice(0,70);
}
async function formatAttendanceReport(sock,event,cutoff=false) {
  const state=await readAttendance();
  const attendees=attendanceFor(state,event.id);
  const lines=[
    (cutoff?'⏰ *PRAZO DE CONFIRMAÇÃO ENCERRADO*':'👥 *RELATÓRIO DE PRESENÇAS*'),
    '🎮 *'+event.title+'*',
    '🕗 '+new Date(event.date).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}),
    '',
    '✅ *CONFIRMADOS ('+attendees.length+')*',
    ...(attendees.length?attendees.map((entry,index)=>(index+1)+'. '+readableAttendeeName(entry)) :
      ['Nenhuma confirmação recebida']),
  ];
  try {
    const roster=await getClanMemberRoster(sock);
    const {absent}=partitionRoster(attendees,roster,ids=>ids.flatMap(linkedAliases));
    lines.push('','❌ *NÃO CONFIRMARAM ('+absent.length+')*');
    if(absent.length)for(let i=0;i<absent.length;i++) {
      lines.push((i+1)+'. '+memberLabel(absent[i].participant,i));
    } else lines.push('Todos os integrantes identificados já confirmaram.');
  } catch(error) {
    console.warn('Lista de ausência incompleta: não foi possível consultar Integrantes:',error?.message);
    lines.push('','⚠️ *Não confirmaram:* lista indisponível — não foi possível consultar o grupo Integrantes. Nenhuma ausência foi presumida.');
  }
  lines.push('','⚖️ *Exceções após o prazo:* somente mediante aprovação do Conselho com !aprovarpresenca.');
  return lines.join('\n');
}
async function sendAttendanceReport(sock,event,cutoff=false) {
  if(!adminsGroup)throw new Error('Grupo Conselho de ADMs não configurado');
  const message=await formatAttendanceReport(sock,event,cutoff);
  // WhatsApp can truncate extremely large messages.
  for (let offset=0;offset<message.length;offset+=3500) {
    await sendText(sock,adminsGroup,message.slice(offset,offset+3500));
  }
}
let agendaAlertBusy=false;
async function runAgendaNotificationTick(sock) {
  if(agendaAlertBusy || !enabled || !targetGroup || !adminsGroup)return;
  agendaAlertBusy=true;
  try {
    const events=await upcomingAgendaEvents();
    const history=await readJson(attendanceAlertsFile,{});
    const scheduled=dueAgendaActions(events,history);
    for(const {type,event} of scheduled) {
      // The send completes before persisting the idempotency key: never claim a notice was delivered on error.
      if(type==='reminder') {
        const minutes=Math.ceil((Date.parse(event.date)-Date.now())/60000);
        const deadline=new Date(Date.parse(event.date)-RSVP_CLOSE_BEFORE_MS)
          .toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'});
        await sendText(sock,targetGroup,
          '⏰ *LEMBRETE DO CLÃ — EVENTO PRÓXIMO!*\n\n🎮 *'+event.title+'*\n'+
          '🕗 '+new Date(event.date).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})+
          '\n⏳ Faltam aproximadamente '+minutes+' minutos!\n\n'+
          '✅ *PRAZO FINAL: CONFIRME SUA PARTICIPAÇÃO ATÉ '+deadline+'!*\n'+
          'Se o menu não abrir, envie *!agenda*, veja o ID e use *!confirmar ID*.\n'+
          '⚠️ Quem não confirmar até *30 minutos antes* fica fora da lista, salvo aprovação do Conselho.\n'+
          'Quem já confirmou permanece na lista — não precisa confirmar novamente.');
        const state=await readAttendance();
        await sendInteractive(sock,targetGroup,
          buildRsvpEventChoices([event],{[event.id]:attendanceCount(state,event.id)}),
          [targetGroup]);
        history[event.id]={...history[event.id],reminderAt:new Date().toISOString()};
      } else if(type==='report') {
        await sendAttendanceReport(sock,event,true);
        history[event.id]={...history[event.id],reportAt:new Date().toISOString()};
      }
      await writeJson(attendanceAlertsFile,history);
    }
  } finally {
    agendaAlertBusy=false;
  }
}
const agendaDrafts = new Map();
const AGENDA_DRAFT_TTL = 15 * 60 * 1000;
async function sendAgendaWizardEventPage(sock,jid,draft) {
  const page=draft.page||0,list=draft.list||[],pages=Math.ceil(list.length/8);
  const shown=list.slice(page*8,page*8+8);
  await sendText(sock,jid,'📅 *SELECIONAR EVENTO — '+(page+1)+'/'+pages+'*\n\n'+
    shown.map((item,i)=>(i+1)+'. *'+item.title+'* — '+new Date(item.date).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})+
      '\n   ID: '+item.id).join('\n')+
    '\n\n📱 *Sem menu clicável?* Envie o número da lista (*1 a '+shown.length+'*) ou o ID do evento.'+
    (pages>1?'\nUse *proxima* ou *anterior* para navegar.':'')+
    '\nEnvie *!sair* para cancelar.');
}
async function sendAgendaWizardMembersPage(sock,jid,draft) {
  const page=draft.page||0,list=draft.members||[],pages=Math.ceil(list.length/8);
  const shown=list.slice(page*8,page*8+8);
  await sendText(sock,jid,'👥 *ESCOLHER INTEGRANTE — '+(page+1)+'/'+pages+'*\n\n'+
    shown.map((item,i)=>(i+1)+'. '+item.name).join('\n')+
    '\n\n📱 *Sem botão?* Envie o número do integrante (*1 a '+shown.length+'*).'+
    (pages>1?'\nUse *proxima* ou *anterior* para navegar.':'')+
    '\nEnvie *!sair* para cancelar.');
}
async function handleAgendaWizard(sock, jid, message, raw) {
  // The linked account can have multiple participant JIDs; it must own one draft.
  // Other admins must never accidentally share a draft when metadata is absent.
  const actor = message?.key?.fromMe ? 'owner' : String(message?.key?.participant || message?.key?.participantAlt || '');
  if (!actor) return false;
  const key = jid + ':' + actor;
  const events = upcomingAgendaEvents;
  if (/^!(agendar|editarevento|cancelarevento|presencas|aprovarpresenca)$/i.test(raw)) {
    const mode = raw.slice(1).toLowerCase();
    if (mode === 'agendar') {
      agendaDrafts.set(key, { mode, step:'title', expires:Date.now()+AGENDA_DRAFT_TTL });
      await sendText(sock,jid,'📅 *Novo evento* (1/3)\nQual é o nome do evento?\nDigite !sair para cancelar.');
    } else {
      const list = await events();
      if (!list.length) { await sendText(sock,jid,'📅 Não há eventos futuros cadastrados.'); return true; }
      agendaDrafts.set(key,{mode,step:'select',list,page:0,expires:Date.now()+AGENDA_DRAFT_TTL});
      await sendAgendaWizardEventPage(sock,jid,agendaDrafts.get(key));
      try {await sendInteractive(sock,jid,buildAgendaEventChoices(list,mode,0),[adminsGroup]);}
      catch(error){console.warn('Menu de evento indisponível, escolha escrita ativa:',error?.message);}
    }
    return true;
  }
  const draft = agendaDrafts.get(key);
  if (!draft) return false;
  if (Date.now()>draft.expires) { agendaDrafts.delete(key); await sendText(sock,jid,'⌛ Operação expirada. Envie o comando novamente.'); return true; }
  if (/^!sair$/i.test(raw)) { agendaDrafts.delete(key); await sendText(sock,jid,'❌ Operação cancelada.'); return true; }
  if (raw.startsWith('!')) return false;
  if (draft.step==='select') {
    const clicked=isInteractiveChoice(message.message);
    const page=draft.page||0, pages=Math.ceil(draft.list.length/8);
    const lower=raw.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
    const nextPage=clicked&&/^nox:page:(\d+)$/.test(raw)
      ? Number(raw.slice('nox:page:'.length))
      : lower==='proxima'?page+1:lower==='anterior'?page-1:null;
    if(nextPage!==null){
      if(!Number.isInteger(nextPage)||nextPage<0||nextPage>=pages){
        await sendText(sock,jid,'⚠️ Não existe mais uma página nesse sentido.');return true;
      }
      draft.page=nextPage;
      await sendAgendaWizardEventPage(sock,jid,draft);
      try{await sendInteractive(sock,jid,buildAgendaEventChoices(draft.list,draft.mode,nextPage),[adminsGroup]);}
      catch(error){console.warn('Menu de evento indisponível; lista em texto ativa:',error?.message);}
      return true;
    }
    const match=clicked?raw.match(/^nox:event:([a-f0-9]{8})$/i):raw.match(/^([a-f0-9]{8})$/i);
    const current=draft.list.slice(page*8,page*8+8);
    let event=match?current.find(item=>item.id===(match[1]||'').toLowerCase()):null;
    if(!event&&!clicked&&/^[1-8]$/.test(raw)){
      event=current[Number(raw)-1]||null;
    }
    if(!event){
      await sendText(sock,jid,'⚠️ Escolha um evento válido: toque na lista, envie seu número ou o ID mostrado.');
      return true;
    }
    draft.event=event;
    if(draft.mode==='presencas') {
      agendaDrafts.delete(key);
      await sendAttendanceReport(sock,event,false);
      return true;
    }
    if(draft.mode==='aprovarpresenca') {
      let roster;
      try { roster=await getClanMemberRoster(sock); }
      catch(error) {
        agendaDrafts.delete(key);
        await sendText(sock,jid,'⚠️ Não consegui consultar o grupo Integrantes. A autorização não foi feita.');
        return true;
      }
      const state=await readAttendance();
      const members=roster.map((member,index)=>({
        ids:attendeeIds(participantAliases(member).flatMap(linkedAliases)),
        name:memberLabel(member,index)
      })).filter(member=>member.ids.length &&
        !isAttending(state,event.id,member.ids));
      if(!members.length) {
        agendaDrafts.delete(key);
        await sendText(sock,jid,'✅ Todos os integrantes identificados já estão confirmados.');
        return true;
      }
      draft.members=members;draft.step='approve_pick';draft.page=0;
      await sendAgendaWizardMembersPage(sock,jid,draft);
      try{await sendInteractive(sock,jid,buildApprovalMemberChoices(members,event,0),[adminsGroup]);}
      catch(error){console.warn('Menu de participantes indisponível, números em texto ativos:',error?.message);}
      return true;
    }
    if (draft.mode==='cancelarevento') {
      draft.step='confirm';
      await sendText(sock,jid,'⚠️ *Cancelar '+event.title+'?*\n📱 Se o menu não funcionar, responda *sim* ou *não*.');
      try{await sendInteractive(sock,jid,buildAgendaConfirmationChoice(event),[adminsGroup]);}
      catch(error){console.warn('Menu de cancelamento indisponível; confirmação escrita ativa:',error?.message);}
    } else {
      draft.step='title';
      await sendText(sock,jid,'✏️ Qual será o novo nome de *'+draft.event.title+'*?');
    }
    return true;
  }
  if(draft.step==='approve_pick') {
    const clicked=isInteractiveChoice(message.message);
    const page=draft.page||0,pages=Math.ceil(draft.members.length/8);
    const lower=raw.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
    const nav=clicked&&/^nox:approval:page:(\d+)$/.test(raw)
      ? Number(raw.slice('nox:approval:page:'.length))
      : lower==='proxima'?page+1:lower==='anterior'?page-1:null;
    if(nav!==null){
      if(!Number.isInteger(nav)||nav<0||nav>=pages){
        await sendText(sock,jid,'⚠️ Não existe essa página.');return true;
      }
      draft.page=nav;
      await sendAgendaWizardMembersPage(sock,jid,draft);
      try{await sendInteractive(sock,jid,buildApprovalMemberChoices(draft.members,draft.event,nav),[adminsGroup]);}
      catch(error){console.warn('Menu de membros indisponível; números em texto ativos:',error?.message);}
      return true;
    }
    const memberMatch=clicked?raw.match(/^nox:approval:member:(\d+)$/):null;
    const index=memberMatch?Number(memberMatch[1]):
      (!clicked && /^[1-8]$/.test(raw)?page*8+Number(raw)-1:-1);
    if(index<page*8||index>=page*8+8||index>=draft.members.length){
      await sendText(sock,jid,'⚠️ Escolha um integrante pelo botão ou envie um número da página.');
      return true;
    }
    draft.member=draft.members[index];draft.step='approve_confirm';
    await sendText(sock,jid,'⚖️ Autorizar '+draft.member.name+' em *'+draft.event.title+'*?\n'+
      '📱 Se o botão não funcionar, responda somente *sim* ou *não*.');
    try{await sendInteractive(sock,jid,buildApprovalConfirmationChoice(draft.event,draft.member),[adminsGroup]);}
    catch(error){console.warn('Menu de autorização indisponível; confirmação escrita ativa:',error?.message);}
    return true;
  }
  if(draft.step==='approve_confirm') {
    const selected=isInteractiveChoice(message.message) ? raw
      : (raw.toLowerCase()==='sim'?'nox:approval:confirm':
          /^n[aã]o$/i.test(raw)?'nox:approval:cancel':null);
    if(!['nox:approval:confirm','nox:approval:cancel'].includes(selected)) {
      await sendText(sock,jid,'⚠️ Confirme com o botão ou responda *sim* ou *não*.');
      return true;
    }
    agendaDrafts.delete(key);
    if(selected==='nox:approval:cancel') {
      await sendText(sock,jid,'↩️ Exceção cancelada. Nenhuma presença alterada.');
      return true;
    }
    const fresh=(await upcomingAgendaEvents()).find(event=>event.id===draft.event.id);
    if(!fresh) {
      await sendText(sock,jid,'⚠️ O evento já terminou ou foi cancelado. Aprovação não realizada.');
      return true;
    }
    const result=await updateAttendance(state=>
      changeAttendance(state,draft.event.id,draft.member.ids,draft.member.name,true));
    await sendText(sock,jid,'⚖️ *PRESENÇA AUTORIZADA PELO CONSELHO*\n🎮 '+draft.event.title+
      '\n✅ '+draft.member.name+'\n👥 Total confirmado: '+attendanceCount(result.data,draft.event.id));
    return true;
  }
  if (draft.step==='confirm') {
    const selected=isInteractiveChoice(message.message)?raw:
      (raw.toLowerCase()==='sim'?'nox:confirm:sim':/^n[aã]o$/i.test(raw)?'nox:confirm:nao':null);
    if (!['nox:confirm:sim','nox:confirm:nao'].includes(selected)) {
      await sendText(sock,jid,'⚠️ Confirme pelo menu ou responda *sim* ou *não*.');
      return true;
    }
    agendaDrafts.delete(key);
    if (selected==='nox:confirm:nao') { await sendText(sock,jid,'Exclusão cancelada.'); return true; }
    return handleAdminAgenda(sock,{...message,message:{conversation:'!cancelarevento '+draft.event.id}});
  }
  if (draft.step==='title') {
    if (!raw.trim()||raw.length>120) { await sendText(sock,jid,'⚠️ Informe um nome com até 120 caracteres.'); return true; }
    draft.title=raw.trim();draft.step='date';
    await sendText(sock,jid,'📅 Qual é a data do evento? Use DD/MM/AAAA.');
    return true;
  }
  if (draft.step==='date') {
    const check = validateAgendaDay(raw);
    if (!check.ok) {
      await sendText(sock,jid,agendaValidationMessage(check) + '\n\n📅 Informe outra data ou envie *!sair*.');
      return true;
    }
    draft.date=check.value;
    draft.step='time';
    await sendText(sock,jid,'🕗 Qual é o horário? Use *HH:MM* (Brasília).\nA data é *'+draft.date+'*. O horário precisa ser futuro.');
    return true;
  }
  if (draft.step==='time') {
    const check = validateAgendaSchedule(draft.date,raw);
    if (!check.ok) {
      if (check.reason.startsWith('date_')) {
        draft.step='date';
        await sendText(sock,jid,agendaValidationMessage(check) + '\n\n📅 Informe uma nova data (DD/MM/AAAA). O nome do evento foi preservado.');
      } else {
        await sendText(sock,jid,agendaValidationMessage(check) + '\n\n🕗 Informe outro horário (*HH:MM*). O nome e a data foram preservados. Envie *!sair* para cancelar.');
      }
      return true;
    }
    const command=draft.mode==='editarevento'
      ? '!editarevento '+draft.event.id+' | '+draft.title+' | '+draft.date+' '+raw
      : '!agendar '+draft.title+' | '+draft.date+' '+raw;
    // The payload has been validated. Keep draft until dispatch to avoid losing
    // fields on a bad date/time entry.
    agendaDrafts.delete(key);
    return handleAdminAgenda(sock,{...message,message:{conversation:command}});
  }
  return false;
}
async function handleAdminAgenda(sock, message) {
  const jid = message?.key?.remoteJid;
  if (!adminsGroup || jid !== adminsGroup || !message?.message || botSentMessageIds.has(message.key.id)) return false;
  const raw = messageText(message.message).trim();
  if (/^!(comandosadm|ajuda)$/i.test(raw)) {
    const actor=message.key?.fromMe?'owner':String(message.key?.participant||message.key?.participantAlt||'');
    if(actor)agendaDrafts.delete(jid+':'+actor);
    await sendRoleCommandsMenu(sock,jid,'conselho');
    return true;
  }
  if (/^!comandosadm detalhes$/i.test(raw)) {
    await sendText(sock,jid,councilHelpLines().join('\n'));
    return true;
  }
  const picked=isInteractiveChoice(message.message)?resolveRoleClick(raw,'conselho'):null;
  // Neither pasted UI IDs nor buttons belonging to another group may enter a wizard.
  if(/^nox:(?:role|owner):/.test(raw) && !picked) return true;
  if(picked){
    // A newly chosen command supersedes any previous unfinished council flow.
    const actor=message.key?.fromMe?'owner':String(message.key?.participant||message.key?.participantAlt||'');
    if(actor) agendaDrafts.delete(jid+':'+actor);
    if(picked.key==='guia'){
      await sendText(sock,jid,councilHelpLines().join('\n'));
      return true;
    }
    if(picked.command){
      return handleAdminAgenda(sock,{...message,message:{conversation:picked.command}});
    }
    return true;
  }
  if (raw.startsWith('!presencas ')) {
    const eventId = raw.slice('!presencas '.length).trim().toLowerCase();
    const chosen = (await upcomingAgendaEvents()).find(item => item.id === eventId);
    if (chosen) await sendAttendanceReport(sock, chosen, false);
    else await sendText(sock, jid, 'Evento não encontrado. Confira os IDs com !agenda.');
    return true;
  }
  if (await handleAgendaWizard(sock, jid, message, raw)) return true;
  if (/^!agenda$/i.test(raw)) { await sendText(sock,jid,(await agendaText())+'\n\n👥 Para consultar os participantes de cada evento, envie *!presencas*.'); return true; }
  const match = raw.match(/^!agendar\s+(.+?)\s*\|\s*(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})$/i);
  if (match) {
    const [,title,dd,mm,yyyy,hh,min] = match;
    if (!title.trim()) { await sendText(sock,jid,'⚠️ Informe o nome do evento.'); return true; }
    const schedule = validateAgendaSchedule(dd+'/'+mm+'/'+yyyy,hh+':'+min);
    if (!schedule.ok) {
      await sendText(sock,jid,agendaValidationMessage(schedule));
      return true;
    }
    const date = schedule.date;
    if (!announcementsGroup) { await sendText(sock,jid,'⚠️ Canal de Avisos ainda não confirmado. Evento não cadastrado.'); return true; }
    const events = await readJson(agendaFile, []);
    if (events.some(e => e.title.toLowerCase() === title.trim().toLowerCase() && e.date === date.toISOString())) { await sendText(sock,jid,'⚠️ Este evento já está cadastrado.'); return true; }
    const event = { id: crypto.randomBytes(4).toString('hex'), title: title.trim().slice(0,120), date: date.toISOString() };
    events.push(event);
    await writeJson(agendaFile,events);
    try { await sendText(sock,announcementsGroup,'📅 *NOVO EVENTO DO CLÃ*\n🎮 '+event.title+'\n🕗 '+date.toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})+'\n🆔 '+event.id);
    await notifyGeneralOfAgendaChange(sock); }
    catch (error) { await writeJson(agendaFile,events.filter(e=>e.id!==event.id)); throw error; }
    await sendText(sock,jid,'✅ Evento cadastrado e publicado nos Avisos! ID: '+event.id);
    return true;
  }
  const edit = raw.match(/^!editarevento\s+([a-f0-9]{8})\s*\|\s*(.+?)\s*\|\s*(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})$/i);
  if (edit) {
    const [,id,title,dd,mm,yyyy,hh,min] = edit;
    if (!title.trim()) {
      await sendText(sock,jid,'⚠️ O nome do evento não pode ficar vazio.');
      return true;
    }
    const schedule = validateAgendaSchedule(dd+'/'+mm+'/'+yyyy,hh+':'+min);
    if (!schedule.ok) {
      await sendText(sock,jid,agendaValidationMessage(schedule));
      return true;
    }
    const date = schedule.date;
    const events = await readJson(agendaFile, []);
    const index = events.findIndex(e=>e.id===id.toLowerCase());
    if (index<0) { await sendText(sock,jid,'⚠️ Evento não encontrado.'); return true; }
    if (events.some(e=>e.id!==id.toLowerCase() && e.title.toLowerCase()===title.trim().toLowerCase() && e.date===date.toISOString())) {
      await sendText(sock,jid,'⚠️ Já existe um evento com esse nome e horário.'); return true;
    }
    if (!announcementsGroup) { await sendText(sock,jid,'⚠️ Canal de Avisos indisponível. Alteração não realizada.'); return true; }
    const previousDate = events[index].date;
    const updated = {...events[index],title:title.trim().slice(0,120),date:date.toISOString()};
    await sendText(sock,announcementsGroup,'✏️ *EVENTO ATUALIZADO*\n🎮 '+updated.title+'\n🕗 '+date.toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})+'\n🆔 '+updated.id);
    await notifyGeneralOfAgendaChange(sock);
    events[index]=updated;
    await writeJson(agendaFile,events);
    if (previousDate !== updated.date) {
      const alertHistory=await readJson(attendanceAlertsFile,{});
      delete alertHistory[updated.id];
      await writeJson(attendanceAlertsFile,alertHistory);
    }
    await sendText(sock,jid,'✅ Evento atualizado e publicado nos Avisos.');
    return true;
  }
  const cancel = raw.match(/^!cancelarevento\s+([a-f0-9]{8})$/i);
  if (cancel) {
    const events = await readJson(agendaFile, []);
    const event = events.find(e=>e.id===cancel[1]);
    if (!event) { await sendText(sock,jid,'⚠️ Evento não encontrado.'); return true; }
    if (!announcementsGroup) { await sendText(sock,jid,'⚠️ Canal de Avisos indisponível. Cancelamento não realizado.'); return true; }
    await sendText(sock,announcementsGroup,'❌ *EVENTO CANCELADO*\n'+event.title+' (ID: '+event.id+')');
    await notifyGeneralOfAgendaChange(sock);
    await writeJson(agendaFile,events.filter(e=>e.id!==event.id));
    await updateAttendance(state=>({data:removeEventAttendance(state,event.id)}));
    const alertHistory=await readJson(attendanceAlertsFile,{});
    delete alertHistory[event.id];
    await writeJson(attendanceAlertsFile,alertHistory);
    await sendText(sock,jid,'✅ Evento cancelado.'); return true;
  }
  return false;
}
const targetGroup = process.env.WHATSAPP_GROUP_JID || null;
const configuredAnnouncementsGroup = process.env.WHATSAPP_ANNOUNCEMENTS_GROUP_JID || null;
let announcementsGroup = null; // Activated only after checking community metadata.
const announcementsEnabled = process.env.WHATSAPP_ANNOUNCEMENTS_ENABLED === 'true';
// Explicitly gated; production will not tag members until the correct
// community and participant list have been verified and this flag is enabled.
const announcementMentionsEnabled = process.env.WHATSAPP_ANNOUNCEMENT_MENTIONS_ENABLED === 'true';
const pairPhone = process.env.WHATSAPP_PAIR_PHONE?.replace(/\D/g, '');
const enabled = process.env.WHATSAPP_REPLY_ENABLED === 'true';
const secret = process.env.WHATSAPP_SESSION_ENCRYPTION_KEY;
if (!secret) throw new Error('WHATSAPP_SESSION_ENCRYPTION_KEY não configurada');
const SESSION_KEY = crypto.createHash('sha256').update(secret).digest();

const players = new Map();
const registrations = new Map();
const botSentMessageIds = new Set();
const outgoingEchoGuard = createOutgoingEchoGuard();
const announcedIds = new Set();
const pendingAnnouncementIds = new Set();
let announcementHistoryLoaded = false;
const groupNames = new Map();
const identityAliases = new Map();
function linkIdentities(jids) {
  const all = [...new Set(jids.filter(Boolean).flatMap(jidAliases))];
  for (const jid of all) {
    const known = identityAliases.get(jid) || [];
    identityAliases.set(jid, [...new Set([...known, ...all])]);
  }
  const name = all.map(jid => groupNames.get(jid)).find(Boolean);
  if (name) for (const jid of all) groupNames.set(jid, name);
}
function linkedAliases(jid) {
  const base = jidAliases(jid);
  return [...new Set([...base, ...base.flatMap(x => identityAliases.get(x) || [])])];
}
let ownJid = null;
let ownerAccountJids = [];

async function readJson(path, fallback) {
  try { return JSON.parse(await fs.readFile(path, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return fallback; throw e; }
}
async function writeJson(path, value) {
  await fs.mkdir(dirname(path), { recursive: true });
  const tmp = path + '.' + process.pid + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
  await fs.rename(tmp, path);
}
function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', SESSION_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
}
function decrypt(payload) {
  const data = Buffer.from(payload, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', SESSION_KEY, data.subarray(0, 12));
  decipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8');
}
async function savePlayers() {
  const out = {};
  for (const [jid, p] of players) out[jid] = { ...p, jwt: encrypt(p.jwt) };
  await writeJson(sessionsFile, out);
}
async function restorePlayers() {
  const stored = await readJson(sessionsFile, {});
  for (const [jid, p] of Object.entries(stored)) {
    try { players.set(jid, { ...p, jwt: decrypt(p.jwt) }); }
    catch (e) { console.warn('Sessão WhatsApp ignorada:', jid, e?.message); }
  }
  console.log('Jogadores WhatsApp restaurados:', players.size);
}
async function saveRegistrations() {
  await writeJson(registrationsFile, Object.fromEntries(registrations));
}
async function setRegistration(jid, state) {
  registrations.set(jid, { ...state, updatedAt: new Date().toISOString() });
  await saveRegistrations();
}
async function deleteRegistration(jid) {
  registrations.delete(jid); await saveRegistrations();
}
async function restoreRegistrations() {
  const stored = await readJson(registrationsFile, {});
  const now = Date.now();
  for (const [jid, state] of Object.entries(stored)) {
    const updated = Date.parse(state?.updatedAt || '');
    if (['role_id','zone_id','verification_code'].includes(state?.step) && Number.isFinite(updated) && now - updated < REGISTRATION_TTL_MS) registrations.set(jid, state);
  }
}
function unwrapMessage(message) {
  let current = message || {};
  for (let i = 0; i < 6; i += 1) {
    const next =
      current?.ephemeralMessage?.message ||
      current?.viewOnceMessage?.message ||
      current?.viewOnceMessageV2?.message ||
      current?.viewOnceMessageV2Extension?.message ||
      current?.documentWithCaptionMessage?.message ||
      current?.editedMessage?.message?.protocolMessage?.editedMessage ||
      current?.protocolMessage?.editedMessage;
    if (!next) break;
    current = next;
  }
  return current;
}
function messageText(message) {
  const m = unwrapMessage(message);
  return String(
    m?.conversation ||
    m?.extendedTextMessage?.text ||
    m?.imageMessage?.caption ||
    m?.videoMessage?.caption ||
    m?.documentMessage?.caption ||
    m?.buttonsResponseMessage?.selectedButtonId ||
    m?.listResponseMessage?.singleSelectReply?.selectedRowId ||
    (() => { try { return JSON.parse(m?.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson || '{}').id || ''; } catch { return ''; } })() ||
    ''
  ).trim();
}
function aliasesFor(key) {
  return [...new Set([key?.participant, key?.participantAlt, key?.remoteJid].filter(Boolean))];
}
function findPlayer(aliases) {
  for (const jid of aliases) if (players.has(jid)) return players.get(jid);
  if (aliases.some(jid => jid === ownJid) && players.has('self')) return players.get('self');
  return null;
}
async function discoverAnnouncementsGroup(sock) {
  if (!targetGroup) return;
  // Safe startup check also runs with notifications disabled.
  // It only reads group metadata; no broadcast is sent during discovery.
  announcementsGroup = null;
  try {
    const generalMetadata = await sock.groupMetadata(targetGroup);
    const groups = await sock.groupFetchAllParticipating();
    const found = selectCommunityAnnouncementsGroup(groups, generalMetadata);
    if (!found) {
      console.warn('Avisos NOX desativados: canal oficial da mesma comunidade não identificado sem ambiguidade.');
      return;
    }
    if (configuredAnnouncementsGroup && configuredAnnouncementsGroup !== found) {
      console.error('Avisos NOX desativados: o ID configurado não corresponde ao canal oficial da comunidade.');
      return;
    }
    announcementsGroup = found;
    console.log('Avisos NOX: canal oficial da comunidade verificado:', found);
  } catch (error) {
    console.error('Avisos NOX desativados: falha ao confirmar canal oficial:', error?.message);
  }
}

async function notifyAnnouncement(sock, message, type) {
  if (!announcementsEnabled || !announcementsGroup || !targetGroup ||
      announcementsGroup === targetGroup ||
      !isAnnouncementPost(message, type, announcementsGroup)) return false;
  const sourceId = announcementsGroup + ':' + message.key.id;
  if (botSentMessageIds.has(message.key.id) ||
      announcedIds.has(sourceId) || pendingAnnouncementIds.has(sourceId)) return false;
  // Only recent events can announce. Old backfilled messages must never trigger broadcasts.
  const rawTimestamp = message.messageTimestamp;
  const seconds = typeof rawTimestamp === 'number' ? rawTimestamp
    : typeof rawTimestamp === 'string' ? Number(rawTimestamp)
    : rawTimestamp?.toNumber?.();
  if (!Number.isFinite(seconds) || Math.abs(Date.now() / 1000 - seconds) > 600) return false;
  pendingAnnouncementIds.add(sourceId);
  try {
    let outgoing = { text: ANNOUNCEMENT_NOTICE, mentionAll: false };
    if (announcementMentionsEnabled) {
      // Check that the destination really is Geral; WhatsApp handles current group membership for native @all.
      const metadata = await sock.groupMetadata(targetGroup);
      outgoing = buildAnnouncementMentionMessage(metadata, targetGroup);
      if (!outgoing) {
        console.warn('Avisos NOX: não foi possível verificar o grupo Geral; @all não enviado.');
        return false;
      }
    }
    await sendText(sock, targetGroup, outgoing.text, [], outgoing.mentionAll === true);
    announcedIds.add(sourceId);
    const recent = [...announcedIds].slice(-500);
    announcedIds.clear();
    for (const id of recent) announcedIds.add(id);
    await writeJson(announcementsFile, recent);
    console.log('Aviso de comunicado enviado ao grupo Geral.');
    return true;
  } catch (error) {
    console.error('Falha ao notificar comunicado:', error?.message);
    return false;
  } finally {
    pendingAnnouncementIds.delete(sourceId);
  }
}

async function notifyGeneralOfAgendaChange(sock) {
  if (!announcementsEnabled || !announcementsGroup || !targetGroup || announcementsGroup === targetGroup) {
    console.warn('Aviso de agenda publicado, mas notificação no Geral está desabilitada.');
    return;
  }
  try {
    let outgoing = { text: ANNOUNCEMENT_NOTICE, mentionAll: false };
    if (announcementMentionsEnabled) {
      const metadata = await sock.groupMetadata(targetGroup);
      outgoing = buildAnnouncementMentionMessage(metadata, targetGroup);
      if (!outgoing) throw new Error('Grupo Geral não validado para menção');
    }
    await sendText(sock, targetGroup, outgoing.text, [], outgoing.mentionAll === true);
    console.log('Notificação de alteração da agenda enviada ao Geral.');
  } catch (error) {
    console.error('Evento publicado nos Avisos, mas falhou notificação no Geral:', error?.message);
  }
}
async function sendText(sock, jid, text, mentions = [], mentionAll = false) {
  // Reserve before sending, because the echo may arrive before sendMessage returns.
  const brandedText = brandNoxText(text);
  const cancelReservation = outgoingEchoGuard.reserve(jid, brandedText);
  try {
    const payload = { text: brandedText };
    if (mentions.length) payload.mentions = mentions;
    if (mentionAll) payload.mentionAll = true;
    const sent = await sock.sendMessage(jid, payload);
    if (sent?.key?.id) {
      outgoingEchoGuard.rememberId(sent.key.id);
      botSentMessageIds.add(sent.key.id);
      if (botSentMessageIds.size > 1000) {
        for (const oldId of [...botSentMessageIds].slice(0, 300)) botSentMessageIds.delete(oldId);
      }
    }
    return sent;
  } catch (error) {
    cancelReservation();
    throw error;
  }
}
async function sendInteractive(sock, jid, menu, permittedGroups = []) {
  const sent = await sendNoxInteractiveMenu(sock, jid, generateWAMessageFromContent, menu, permittedGroups);
  if (sent?.key?.id) {
    botSentMessageIds.add(sent.key.id);
    outgoingEchoGuard.rememberId(sent.key.id);
    if (botSentMessageIds.size > 1000) {
      for (const oldId of [...botSentMessageIds].slice(0, 300)) botSentMessageIds.delete(oldId);
    }
  }
  return sent;
}
async function sendNoxMenu(sock, jid) {
  const fallback = '📱 *Se o menu clicável aparecer como incompatível no seu WhatsApp,* use os comandos de texto:\n' +
    '📊 !stats · 🏆 !ranking · 🌟 !highlights\n' +
    '📅 !agenda · 💡 !sugestao · ❓ !ajuda · 🎮 !cadastrar';
  try {
    await sendInteractive(sock, jid, buildNoxClickableMenu(), [targetGroup].filter(Boolean));
  } catch (error) {
    console.warn('Menu interativo indisponível; mantendo atalhos de texto:',error?.message);
  }
  return sendText(sock, jid, fallback);
}

async function loadBattles() { return readJson(battlesFile, {}); }
async function saveVerifiedBattle(jid, player, verification) {
  const all = await loadBattles();
  const owner = verification.match || {};
  const normalized = normalizeVerifiedMatch(owner, verification.matchId, {});
  const playerKey = String(player.roleId) + ':' + String(player.zoneId);
  const rows = Array.isArray(all[playerKey]) ? all[playerKey] : [];
  if (rows.some(row => String(row.battleId) === String(normalized.battleId))) return { duplicate: true, match: normalized };
  rows.push({ ...normalized, playerName: player.name, verifiedAt: new Date().toISOString(), via: 'whatsapp', jidAlias: jid });
  all[playerKey] = rows.slice(-500);
  await writeJson(battlesFile, all);
  return { duplicate: false, match: normalized };
}
function savedStats(rows) {
  const games = rows.length;
  const wins = rows.filter(r => r.result === 'win').length;
  const losses = rows.filter(r => r.result === 'loss').length;
  const totals = rows.reduce((a,r) => ({
    k: a.k + Number(r.kda?.kills || 0),
    d: a.d + Number(r.kda?.deaths || 0),
    a: a.a + Number(r.kda?.assists || 0),
    mvp: a.mvp + Number(Boolean(r.mvp))
  }), {k:0,d:0,a:0,mvp:0});
  return {games,wins,losses,totals,rate:games ? (100*wins/games).toFixed(1) : '0.0'};
}
let cachedRankRecords = [];
let rankRecordsCachedUntil = 0;
async function getRankRecords() {
  if (cachedRankRecords.length && Date.now() < rankRecordsCachedUntil) return cachedRankRecords;
  try {
    const response = await apiFetch('/academy/ranks?size=100&index=1&lang=en');
    const body = await response.json().catch(() => ({}));
    const records = body?.data?.records;
    if (response.ok && isApiSuccess(body) && Array.isArray(records) && records.length) {
      cachedRankRecords = records;
      rankRecordsCachedUntil = Date.now() + 6 * 60 * 60 * 1000;
    }
  } catch (error) { console.warn('Patentes indisponíveis:', error?.message); }
  return cachedRankRecords;
}
function portugueseRankName(name) {
  const text = String(name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (/immortal|imortal|不朽/.test(text)) return 'Mítico Imortal';
  if (/glory|gloria|荣耀/.test(text)) return 'Glória Mítica';
  if (/honor|honour|honra|荣誉/.test(text)) return 'Honra Mítica';
  if (/mythic|mitico|神话/.test(text)) return 'Mítico';
  if (/grand.?master|grao.?mestre|宗师/.test(text)) return 'Grão-Mestre';
  if (/legend|lenda|传奇/.test(text)) return 'Lenda';
  if (/epic|epico|史诗/.test(text)) return 'Épico';
  if (/master|mestre|大师/.test(text)) return 'Mestre';
  if (/elite|精英/.test(text)) return 'Elite';
  if (/warrior|guerreiro|勇士/.test(text)) return 'Guerreiro';
  return null;
}
function displayRankFromApi(code, records) {
  const rank = Number(code);
  if (!Number.isFinite(rank)) return 'Não disponível';
  // Entries can overlap; prefer the narrowest documented range rather than
  // silently taking whichever record the provider returned first.
  const candidates = records.filter(entry => {
    const data = entry?.data || {};
    const low = Number(data.rankid_start), high = Number(data.rankid_end);
    return Number.isFinite(low) && Number.isFinite(high) && low <= rank && rank <= high;
  });
  candidates.sort((a, b) => {
    const width = entry => Number(entry.data.rankid_end) - Number(entry.data.rankid_start);
    return width(a) - width(b);
  });
  const found = candidates[0];
  if (!found) return 'Patente não identificada';
  const data = found.data || {};
  // Rone sometimes gives a broad major rank and a more specific caption.
  // Prefer Honra, Glória or Imortal explicitly named by the API.
  const names = [data.bigrank_name, data.minrank_name, found.caption]
    .map(portugueseRankName).filter(Boolean);
  const name = names.find(rankName => ['Honra Mítica', 'Glória Mítica', 'Mítico Imortal'].includes(rankName))
    || names[0];
  if (!name) return 'Patente não identificada';
  // Rank IDs must never be treated as star counts. Imortal is not inferred
  // from a generic Glória record (Rone may group rank 236..9999 together).
  const roman = String(data.minrank_name || '').trim();
  return !['Mítico', 'Honra Mítica', 'Glória Mítica', 'Mítico Imortal'].includes(name) &&
    /^[IVXⅠⅡⅢⅣⅤⅥ]+$/i.test(roman)
    ? name + ' ' + roman : name;
}
async function sendPlayerStats(sock, jid, player) {
  if (!player?.jwt) return sendText(sock, jid, '🔐 Cadastre seu nick com !cadastrar para consultar seus dados.');
  const headers = { Authorization: 'Bearer ' + player.jwt };
  const lines = ['📊 *MEUS STATS — ' + player.name + '*'];
  let profile = null;
  let stats = null;
  try {
    const response = await apiFetch('/user/info?lang=pt', { headers });
    const body = await response.json().catch(() => ({}));
    if (response.ok && isApiSuccess(body)) profile = body.data || null;
  } catch (error) { console.warn('Perfil indisponível:', error?.message); }
  try {
    const response = await apiFetch('/user/stats?lang=pt', { headers });
    const body = await response.json().catch(() => ({}));
    if (response.ok && isApiSuccess(body)) stats = body.data || null;
  } catch (error) { console.warn('Estatísticas indisponíveis:', error?.message); }
  if (profile) {
    lines.push('', '🎮 *PERFIL*');
    if (profile.level != null) lines.push('⭐ Nível: ' + profile.level);
    if (profile.rank_level != null || profile.history_rank_level != null) {
      const rankRecords = await getRankRecords();
      const currentLabel = profile.rank_level == null ? null : displayRankFromApi(profile.rank_level, rankRecords);
      const bestLabel = profile.history_rank_level == null ? null : displayRankFromApi(profile.history_rank_level, rankRecords);
      if (currentLabel) lines.push('🏅 Patente atual: ' + currentLabel);
      if (bestLabel) lines.push('🥇 Melhor patente: ' + bestLabel);
      // Diagnose upstream ambiguity without storing player names, JWTs, or game IDs.
      if (currentLabel === bestLabel && profile.rank_level != null &&
          profile.history_rank_level != null && profile.rank_level !== profile.history_rank_level) {
        const recordsForCode = code => rankRecords.filter(row => {
          const d = row?.data || {};
          return Number(d.rankid_start) <= Number(code) && Number(code) <= Number(d.rankid_end);
        }).slice(0, 5).map(row => ({
          range: [row.data.rankid_start, row.data.rankid_end],
          major: String(row.data.bigrank_name || '').slice(0, 60),
          minor: String(row.data.minrank_name || '').slice(0, 30),
          caption: String(row.caption || '').slice(0, 60)
        }));
        console.info('[nox-rank-diagnostic]', JSON.stringify({
          currentCode: profile.rank_level,
          bestCode: profile.history_rank_level,
          sameDisplay: true,
          currentMatches: recordsForCode(profile.rank_level),
          bestMatches: recordsForCode(profile.history_rank_level)
        }));
      }
    }
  }
  if (stats) {
    const rows = [];
    if (stats.tc != null) rows.push('⚔️ Partidas totais: ' + stats.tc);
    if (stats.wc != null) rows.push('🏆 Vitórias totais: ' + stats.wc);
    if (Number(stats.tc) > 0 && stats.wc != null)
      rows.push('📈 Taxa de vitórias: ' + (100 * Number(stats.wc) / Number(stats.tc)).toFixed(1).replace('.', ',') + '%');
    if (stats.mvpc != null) rows.push('👑 MVPs totais: ' + stats.mvpc);
    if (stats.wsc != null) rows.push('🔥 Maior sequência: ' + stats.wsc);
    if (stats.as != null) rows.push('⭐ Nota média: ' + (Number(stats.as) / 100).toFixed(2).replace('.', ','));
    if (rows.length) lines.push('', '📊 *ESTATÍSTICAS DO JOGO*', ...rows);
  }
  if (!profile && !stats) lines.push('', '⚠️ Não consegui consultar seus dados agora. Tente novamente mais tarde.');
  // Nunca deixe as consultas opcionais atrasarem a ficha que já funciona.
  return sendStatsWithOptionalSeason(
    () => sendText(sock, jid, lines.join('\n')),
    process.env.WHATSAPP_SEASON_STATS_ENABLED === 'true'
      ? async () => formatSeasonStats(await loadSeasonStats(player.jwt))
      : null,
    extraLines => sendText(sock, jid, extraLines.join('\n').trim()),
    error => console.warn('Resumo de temporada indisponível:', error?.name || 'error')
  );
}

async function sendSavedRanking(sock, jid) {
  // Clã ranking stays paused until we can compare equally complete API
  // periods for every verified member. Never use manually selected matches.
  return sendText(sock, jid, '🏆 *RANKING DO CLÃ*\n\n⏳ Em desenvolvimento. O ranking oficial será baseado em dados confiáveis do jogo, sem prints ou partidas escolhidas pelos jogadores.');
}
async function sendHighlights(sock, jid) {
  return sendText(sock, jid, '🌟 *HIGHLIGHTS NOX*\n\n⏳ Em desenvolvimento. Os destaques serão liberados quando conseguirmos consultar os dados necessários com segurança.');
}

function matchSummary(match) {
  const k = match?.kda || {};
  const result = match?.result === 'win' ? '🏆 Vitória' : match?.result === 'loss' ? '💀 Derrota' : '⚔️ Resultado';
  return result + '\n🎮 Herói: ' + (match?.hero || 'não informado') +
    '\n📊 K/D/A: ' + Number(k.kills || 0) + '/' + Number(k.deaths || 0) + '/' + Number(k.assists || 0) +
    (Number.isFinite(match?.score) ? '\n⭐ Nota: ' + match.score : '') +
    (match?.mvp ? '\n👑 MVP' : '');
}

function noxKnowledgeQuery(text) {
  const raw = String(text || '').trim();
  const textual = /@nox(?:[ _]?stats)?(?:[ _]?bot)?\b/i.test(raw);
  const cleaned = raw.replace(/@nox(?:[ _]?stats)?(?:[ _]?bot)?\b/ig, '').trim();
  return { textual, cleaned };
}
function isOwnMention(jid) {
  if (!jid || !ownJid) return false;
  const own = new Set(linkedAliases(ownJid));
  return linkedAliases(jid).some(alias => own.has(alias));
}
function fullHelpLines() {
  const examples = listKnowledgeExamples().slice(0, 8);
  return [
    '🎮 *NOX — CENTRAL DE AJUDA*',
    '━━━━━━━━━━━━━━━━',
    '',
    '🐺 *COMO COMEÇAR*',
    'No grupo *Geral*, envie *!nox* e toque em *ABRIR MENU*. Se seu WhatsApp mostrar que o menu não é compatível, use os comandos de texto enviados logo abaixo pelo NOX.',
    'Para ver estas instruções novamente: *!ajuda*.',
    '',
    '📅 *AGENDA E CONFIRMAÇÃO DE PRESENÇA*',
    '1️⃣ No *Geral*, envie *!agenda* (com o ponto de exclamação).',
    '2️⃣ Veja os eventos, horários e quantos participantes confirmaram.',
    '3️⃣ Toque em *ESCOLHER EVENTO*, selecione o evento e depois *✅ Vou participar*.',
    '4️⃣ O NOX confirma sua inscrição. Se mudar de ideia, abra *!agenda* novamente, escolha o evento e toque em *❌ Não vou mais*.',
    '📱 *SEM BOTÃO?* Use *!confirmar ID* para participar ou *!desistir ID* para sair. O ID aparece na lista de eventos enviada com *!agenda*; o mesmo prazo vale para os dois caminhos.',
    '',
    '⏰ *ATENÇÃO AO PRAZO*',
    'A confirmação deve ser feita até *30 minutos antes* do início do evento. Não confirmar dentro do prazo significa ficar fora da lista de participantes, salvo autorização do Conselho de ADMs.',
    '📣 *1 hora antes* do evento, o NOX envia um lembrete no Geral com uma opção clicável para confirmar sua presença. Restam 30 minutos até o encerramento.',
    '🔒 *30 minutos antes*, a lista fecha e o NOX envia ao Conselho o relatório de quem confirmou e de quem não confirmou.',
    '✅ Quem confirmou antes do lembrete NÃO precisa confirmar outra vez.',
    '⚖️ Após o prazo, somente o Conselho pode autorizar uma exceção; o jogador não consegue se incluir sozinho.',
    '',
    '📊 *ESTATÍSTICAS E JOGADORES*',
    '• *!stats* — consulta suas estatísticas disponíveis do Mobile Legends.',
    '• *!cadastrar* — cadastro pelo privado: Role ID → Zone ID → código recebido no correio do jogo. A conta fica vinculada ao nick confirmado.',
    '• *!ranking* — classificação do clã *(em desenvolvimento)*.',
    '• *!highlights* — destaques *(em desenvolvimento)*.',
    'O Battle ID e o envio de prints não são necessários para as consultas atuais de !stats.',
    '',
    '💡 *SUGESTÕES*',
    '*!sugestao* — exclusivo para jogadores cadastrados e verificados no NOX. Abre duas opções: *Melhoria do bot* (link privado para o responsável) e *Conhecimento MLBB* (análise pelo revisor autorizado).',
    '*!sugestao bot* — envia uma proposta de melhoria diretamente ao responsável.',
    '*!sugestao conhecimento* — inicia a sugestão guiada no Geral (categoria → herói → descrição).',
    '*!conhecimento* — inicia o cadastro guiado: o NOX pergunta a categoria (*counter*, *build*, *item* ou *dica*), depois o herói e por último a descrição.',
    'Cada resposta é enviada separadamente, sem barras nem formatos complicados. Use *!sair* para cancelar. A proposta é encaminhada ao grupo Integrantes após as três etapas.',
    'Categorias: *counter*, *build*, *item* e *dica*. Só o revisor autorizado pode aprovar conteúdo. Nenhuma sugestão passa automaticamente a fazer parte da base.',
    '',
    '🧠 *DÚVIDAS SOBRE MOBILE LEGENDS*',
    'No Geral, escreva *@NOX* seguido de sua pergunta sobre heróis, counters, builds, itens ou rotas.',
    'Se a pergunta não tiver resposta ou for vaga demais, o NOX pode responder com uma zoeira e indicar *!sugestao* para novas ideias.',
    '💬 *EXEMPLOS:*',
    ...examples.map(question => '• @NOX ' + question),
    '',
    '😂 *ZOERIAS E MENÇÕES*',
    'No Geral, marcar alguém pode render uma provocação do NOX. A zoeira não funciona nos Avisos nem no Conselho.',
    '',
    '🤖 *AVISO*',
    'O NOX utiliza a conta de WhatsApp do administrador; as mensagens automáticas aparecem como enviadas por essa conta.',
    '━━━━━━━━━━━━━━━━',
    '🐺 *Resumindo:* !nox abre o menu · !agenda cuida das presenças · !ajuda explica tudo.'
  ];
}

// Scoped help: the Geral never discloses management commands.
function councilHelpLines() {
  return [
    '👑 *NOX — COMANDOS DO CONSELHO DE ADMs*',
    '📍 Disponíveis somente no grupo Conselho.',
    '',
    '📅 *AGENDA E EVENTOS*',
    '• *!agenda* — lista próximos eventos, horários, IDs e participantes.',
    '• *!agendar* — cria um evento perguntando nome, data e horário.',
    '• *!editarevento* — abre lista clicável para alterar um evento existente.',
    '• *!cancelarevento* — abre lista clicável e pede confirmação antes de cancelar.',
    '• *!presencas* — lista eventos e envia relatório de confirmados e ausentes.',
    '• *!aprovarpresenca* — autoriza um integrante fora do prazo de confirmação.',
    '• *!sair* — cancela a operação em andamento.',
    '',
    '⌨️ *ALTERNATIVAS SEM BOTÃO*',
    '• !agendar Nome | DD/MM/AAAA HH:MM',
    '• !editarevento ID | Novo nome | DD/MM/AAAA HH:MM',
    '• !cancelarevento ID',
    '• !presencas ID',
    '📱 Se um botão não abrir, o NOX também mostra eventos e integrantes numerados. Envie o número ou ID solicitado, use *proxima*/*anterior* para navegar e *sim*/*não* para confirmar.',
    '',
    '🕗 Um lembrete é enviado no Geral 1 hora antes; as inscrições fecham 30 minutos antes e o relatório vai ao Conselho.',
    '📢 Eventos criados, editados e cancelados são publicados nos Avisos Oficiais, com notificação no Geral.',
    '',
    '🔐 *QUEM PODE FAZER O QUÊ?*',
    '• *Conselho de ADMs (este grupo):* organiza eventos, consulta presenças, cancela e autoriza exceções.',
    '• *Revisor autorizado (grupo Integrantes):* !propostas, !avaliarconhecimento ID, !aprovarconhecimento ID, !aprovarcomedicao ID, !rejeitarconhecimento ID, !conhecimentos, !editarconhecimento ID e !excluirconhecimento ID.',
    '• *Dono (conversa privada Você):* !revisor listar, !revisor ROLE_ID ZONE_ID, !revisor desativar, !grupos e !comandosdono.',
    'Cada papel só executa esses comandos no grupo ou privado autorizado. O revisor consulta sua lista detalhada com *!comandosrevisor* no Integrantes.',
    '',
    '📋 Envie *!comandosadm* ou *!ajuda* neste grupo para abrir o menu clicável. Para ver este guia completo por escrito: *!comandosadm detalhes*.'
  ];
}

function reviewerHelpLines() {
  return [
    '⚖️ *NOX — COMANDOS DO REVISOR DE CONHECIMENTO*',
    '📍 Exclusivos do revisor verificado no grupo Integrantes.',
    '',
    '📥 *PENDÊNCIAS*',
    '• *!propostas* — lista sugestões pendentes com menu clicável e IDs.',
    '• *!propostas 2* — página 2 da lista (se houver).',
    '• *!avaliarconhecimento ID* — abre as 3 opções para uma pendência.',
    '• *!aprovarconhecimento ID* — aprova a informação exatamente como chegou.',
    '• *!aprovarcomedicao ID* — solicita novo texto antes de aprovar.',
    '• *!rejeitarconhecimento ID* — reprova sem adicionar à base.',
    '',
    '📚 *CONHECIMENTOS JÁ APROVADOS*',
    '• *!conhecimentos* — lista todas as dicas aprovadas (paginado).',
    '• *!conhecimentos 2* — consulta a página 2.',
    '• *!editarconhecimento ID* — altera descrição já aprovada.',
    '• *!excluirconhecimento ID* — solicita confirmação e retira a informação da base ativa.',
    '',
    '✅ *CONFIRMAÇÕES SEM BOTÃO*',
    '• *!confirmaredicao ID* — confirma o texto corrigido depois de enviá-lo.',
    '• *!confirmarexclusao ID* — confirma exclusão de um conhecimento previamente selecionado.',
    '• *!sair* — abandona uma edição ou exclusão pendente.',
    '',
    '🛡️ O conteúdo só fica ativo após aprovação; rejeições e exclusões não são exibidas nas respostas.',
    '📜 Editar e excluir preserva um histórico de revisão.',
    '📋 Envie *!comandosrevisor* ou *!ajuda* aqui para abrir o menu. Para consultar todas as instruções em texto: *!comandosrevisor detalhes*.'
  ];
}

function ownerHelpLines() {
  return [
    '🔐 *NOX — COMANDOS EXCLUSIVOS DO DONO*',
    '📍 Apenas na conversa privada Você / conta proprietária.',
    '',
    '• *!revisor listar* — relaciona jogadores com nick e cadastro verificados.',
    '• *!revisor* — mostra o revisor ativo.',
    '• *!revisor ROLE_ID ZONE_ID* — autoriza apenas esse jogador a revisar no grupo Integrantes.',
    '• *!revisor desativar* — revoga a autorização de revisão.',
    '• *!grupos* — descobre grupos da comunidade e seus IDs.',
    '• *!comandosdono* — abre o menu clicável do dono; *!comandosdono detalhes* mostra este guia completo em texto.',
    'O dono pode usar *!ajuda* para conhecer os comandos comuns, mas comandos do Conselho e do revisor continuam restritos aos seus grupos.'
  ];
}

async function sendRoleCommandsMenu(sock,jid,role) {
  const entries=ROLE_MENU_ITEMS[role];
  if(!entries)return false;
  const heading=({conselho:'👑 *COMANDOS DO CONSELHO*',
    revisor:'⚖️ *COMANDOS DO REVISOR*',dono:'🔐 *COMANDOS DO DONO*'})[role];
  const guide=({conselho:'!comandosadm detalhes',
    revisor:'!comandosrevisor detalhes',dono:'!comandosdono detalhes'})[role];
  // Deliver accessible commands first: native-flow UI isn't compatible with all clients.
  await sendText(sock,jid,heading+'\n\n'+entries.map(e=>
    '• '+e.title+' — '+(e.command?.includes(' detalhes')?'ver instruções':
      e.command||({autorizar:'!revisor listar e !revisor ROLE_ID ZONE_ID',
        revogar:'!revisor desativar'})[e.key]||'escolher função')).join('\n')+
    '\n\n📱 Use a lista clicável abaixo ou envie o comando escrito.'+
    '\n📖 Lista detalhada: *'+guide+'*.');
  try {
    await sendInteractive(sock,jid,buildRoleCommandsMenu(role),
      role==='conselho'?[adminsGroup]:role==='revisor'?[membersGroup]:[]);
  }catch(error){
    console.warn('Menu de comandos '+role+' indisponível; comandos escritos ativos:',error?.message);
  }
  return true;
}

// Menu actions are accepted only in the owner's own WhatsApp chat.
const ownerReviewerSelection = new Map();
const OWNER_MENU_TTL_MS = 10*60*1000;
function verifiedReviewerCandidates(){
  const unique=new Map();
  for(const [jid,p] of players.entries()){
    if(jid==='self'||!jid.includes('@')||p?.nameVerified!==true||
      !/^\d{6,12}$/.test(String(p.roleId||''))||
      !/^\d{1,8}$/.test(String(p.zoneId||''))||!p.name)continue;
    const id=String(p.roleId)+':'+String(p.zoneId);
    if(!unique.has(id))unique.set(id,{
      roleId:String(p.roleId),zoneId:String(p.zoneId),nick:safeKnowledgeText(p.name,65)
    });
  }
  return [...unique.values()].sort((a,b)=>a.nick.localeCompare(b.nick,'pt-BR')).slice(0,120);
}
async function sendOwnerReviewerPage(sock,jid,draft) {
  const page=draft.page||0,total=Math.ceil(draft.candidates.length/8);
  const shown=draft.candidates.slice(page*8,page*8+8);
  await sendText(sock,jid,'🔐 *DEFINIR REVISOR — '+(page+1)+'/'+total+'*\n\n'+
    shown.map((p,i)=>(i+1)+'. *'+p.nick+'* — Role '+p.roleId+' · Zone '+p.zoneId).join('\n')+
    '\n\n📱 Escolha na lista clicável. Sem botão, use *!revisor ROLE_ID ZONE_ID* com os IDs acima.'+
    (total>1?'\nUse os botões Anterior/Próxima para navegar.':'')+
    '\nPara desistir, envie *!comandosdono*.');
  try{await sendInteractive(sock,jid,buildOwnerReviewerPicker(draft.candidates,page));}
  catch(error){console.warn('Seletor de revisor indisponível; instruções escritas disponíveis:',error?.message);}
}
async function startOwnerReviewerSelection(sock,jid) {
  const candidates=verifiedReviewerCandidates();
  if(!candidates.length){
    await sendText(sock,jid,'⚠️ Nenhum jogador com conta MLBB verificada disponível. Peça ao revisor para concluir *!cadastrar* no privado.');
    return true;
  }
  const draft={step:'pick',candidates,page:0,expires:Date.now()+OWNER_MENU_TTL_MS};
  ownerReviewerSelection.set(jid,draft);
  await sendOwnerReviewerPage(sock,jid,draft);
  return true;
}
async function startOwnerRevocation(sock,jid) {
  const current=await readCommunityKnowledge();
  if(!current.reviewer){
    await sendText(sock,jid,'ℹ️ Nenhum revisor está autorizado no momento.');
    return true;
  }
  ownerReviewerSelection.set(jid,{step:'revoke',expires:Date.now()+OWNER_MENU_TTL_MS});
  await sendText(sock,jid,'🚫 *REVOGAR O REVISOR '+safeKnowledgeText(current.reviewer.nick,65)+'?*\n'+
    'Nenhuma dica já aprovada será apagada.\n' +
    'Confirme pelo botão abaixo ou envie *!revisor desativar*.\n' +
    'Para cancelar, envie *!comandosdono*.');
  try{await sendInteractive(sock,jid,buildOwnerConfirmMenu('revoke'));}
  catch(error){console.warn('Confirmação clicável indisponível; comando escrito disponível:',error?.message);}
  return true;
}
async function handleOwnerMenuChoice(sock,message,selected) {
  const jid=message?.key?.remoteJid;
  const menu=resolveRoleClick(selected,'dono');
  if(menu){
    ownerReviewerSelection.delete(jid);
    if(menu.key==='autorizar')return startOwnerReviewerSelection(sock,jid);
    if(menu.key==='revogar')return startOwnerRevocation(sock,jid);
    if(menu.key==='guia'){
      await sendText(sock,jid,ownerHelpLines().join('\n'));return true;
    }
    // Fixed allowlist; process only commands already authorized in self-chat.
    if(menu.command)return handleRegistration(sock,{...message,
      message:{conversation:menu.command}});
    return true;
  }
  const match=/^nox:owner:(?:pick:(\d+)|page:(\d+)|confirm:(assign|revoke)|cancel)$/.exec(selected);
  if(!match)return false;
  const draft=ownerReviewerSelection.get(jid);
  if(!draft||Date.now()>draft.expires){
    ownerReviewerSelection.delete(jid);
    await sendText(sock,jid,'⌛ Seleção expirada. Abra *!comandosdono* novamente.');
    return true;
  }
  if(selected==='nox:owner:cancel'){
    ownerReviewerSelection.delete(jid);
    await sendText(sock,jid,'↩️ Operação cancelada. Nenhuma permissão alterada.');
    return true;
  }
  if(match[2]!=null){
    const page=Number(match[2]);
    if(draft.step!=='pick'||page<0||page>=Math.ceil(draft.candidates.length/8)){
      await sendText(sock,jid,'⚠️ Página inválida. Abra *!comandosdono* novamente.');return true;
    }
    draft.page=page;draft.expires=Date.now()+OWNER_MENU_TTL_MS;
    await sendOwnerReviewerPage(sock,jid,draft);
    return true;
  }
  if(match[1]!=null){
    const idx=Number(match[1]);
    if(draft.step!=='pick'||idx<draft.page*8||idx>=draft.page*8+8||idx>=draft.candidates.length){
      await sendText(sock,jid,'⚠️ Jogador não consta na página atual.');return true;
    }
    const chosen=draft.candidates[idx];
    const live=verifiedReviewerCandidates().some(p=>p.roleId===chosen.roleId&&p.zoneId===chosen.zoneId);
    if(!live){
      ownerReviewerSelection.delete(jid);
      await sendText(sock,jid,'⚠️ Cadastro não está mais verificado. Nenhuma permissão alterada.');return true;
    }
    draft.step='assign';draft.chosen=chosen;draft.expires=Date.now()+OWNER_MENU_TTL_MS;
    await sendText(sock,jid,'🔐 *CONFIRMAR REVISOR*\n🎮 '+chosen.nick+
      '\nRole ID: '+chosen.roleId+' · Zone ID: '+chosen.zoneId+
      '\n\nConfirme no botão abaixo ou envie *!revisor '+chosen.roleId+' '+chosen.zoneId+'*.');
    try{await sendInteractive(sock,jid,buildOwnerConfirmMenu('assign',chosen.nick));}
    catch(error){console.warn('Confirmação clicável não suportada; instrução escrita disponível:',error?.message);}
    return true;
  }
  if(match[3]==='assign'){
    if(draft.step!=='assign'||!draft.chosen){
      await sendText(sock,jid,'⚠️ Primeiro escolha um jogador verificado.');return true;
    }
    const chosen=draft.chosen;
    if(!verifiedReviewerCandidates().some(p=>p.roleId===chosen.roleId&&p.zoneId===chosen.zoneId)){
      ownerReviewerSelection.delete(jid);
      await sendText(sock,jid,'⚠️ Cadastro não verificado. Nenhuma permissão alterada.');return true;
    }
    ownerReviewerSelection.delete(jid);
    return configureKnowledgeReviewer(sock,jid,'!revisor '+chosen.roleId+' '+chosen.zoneId);
  }
  if(match[3]==='revoke'){
    if(draft.step!=='revoke'){
      await sendText(sock,jid,'⚠️ Não há revogação aguardando confirmação.');return true;
    }
    ownerReviewerSelection.delete(jid);
    return configureKnowledgeReviewer(sock,jid,'!revisor desativar');
  }
  return true;
}

function activeRegistrationJids() {
  const now = Date.now();
  return new Set([...registrations].filter(([, state]) =>
    Number.isFinite(Date.parse(state?.updatedAt || '')) &&
    now - Date.parse(state.updatedAt) < REGISTRATION_TTL_MS
  ).map(([jid]) => jid));
}
function canHandleRegistrationMessage(message) {
  return shouldProcessRegistrationPrivateMessage(message, ownerAccountJids,
    activeRegistrationJids(), messageText);
}
async function handleRegistration(sock, message) {
  const key = message.key || {};
  const jid = key.remoteJid;
  // An explicit !cadastrar starts a narrowly scoped private registration.
  // Unrelated conversations still never reach this handler.
  if (!enabled || !canHandleRegistrationMessage(message)) return false;
  const ownerPrivate = shouldProcessPrivateMessage(message, ownerAccountJids);
  if (!jid || jid.endsWith('@g.us') || botSentMessageIds.has(key.id)) return false;
  const text = messageText(message.message);
  if (!text) return false;
  let command = text.toLowerCase();
  // Native menu IDs are accepted exclusively from a real interactive selection
  // in the account owner's own self-chat.
  if (ownerPrivate && isInteractiveChoice(message.message) &&
    (/^nox:role:dono:[a-z]+$/.test(text) ||
     /^nox:owner:(?:pick:\d+|page:\d+|confirm:(?:assign|revoke)|cancel)$/.test(text))) {
    return handleOwnerMenuChoice(sock,message,text);
  }
  if (/^nox:(?:role|owner):/.test(text)) return true;
  if (ownerPrivate && ['!grupos','/grupos'].includes(command)) {
    // Explicit owner-only group discovery: names and IDs, no group chat content.
    try {
      const groups = await sock.groupFetchAllParticipating();
      const matches = Object.values(groups || {})
        .filter(group => /tenebrozos|nox/i.test(String(group?.subject || '')))
        .slice(0, 16);
      if (!matches.length) {
        await sendText(sock, jid, '🔎 Não encontrei grupos NOX nesta conta. Confira se a comunidade está neste mesmo WhatsApp.');
      } else {
        const lines = ['🔐 *GRUPOS NOX — SOMENTE PARA O DONO*', '', 'Copie o ID do 🎮 NOX Geral e envie no ChatGPT.', ''];
        for (const group of matches) {
          const label = group.isCommunityAnnounce ? ' 📢 *(AVISOS OFICIAIS)*'
            : group.isCommunity ? ' 🏠 *(COMUNIDADE)*'
            : group.id === targetGroup ? ' 🎮 *(GERAL)*' : '';
          lines.push('• *' + String(group.subject).slice(0, 95) + '*' + label, 'ID: ' + group.id, '');
        }
        await sendText(sock, jid, lines.join('\n'));
      }
    } catch (error) {
      console.error('Falha na lista de grupos do dono:', error?.message);
      await sendText(sock, jid, '⚠️ Não consegui listar os grupos agora. Tente !grupos novamente.');
    }
    return true;
  }
  if (ownerPrivate && ['!nox','/nox','nox'].includes(command)) {
    await sendNoxMenu(sock, jid);
    return true;
  }
  if (ownerPrivate && command === '!agenda') { await sendText(sock, jid, await agendaText()); return true; }
  if (ownerPrivate && /^!revisor(?:\s|$)/i.test(command)) {
    return configureKnowledgeReviewer(sock,jid,text);
  }
  if (ownerPrivate && /^(?:[!\/]\s*)?sugest(?:a|ã)o(?:\s+(bot|melhoria|conhecimento))?$/i.test(command)) {
    const choice=command.match(/\s+(bot|melhoria|conhecimento)$/i)?.[1];
    if (choice) await handleSuggestionChoice(sock,jid,choice==='conhecimento'?'knowledge':'bot');
    else await sendSuggestionMenu(sock,jid,message);
    return true;
  }
  if (ownerPrivate && command === '!comandosdono') {
    ownerReviewerSelection.delete(jid);
    await sendRoleCommandsMenu(sock,jid,'dono');
    return true;
  }
  if (ownerPrivate && command === '!comandosdono detalhes') {
    await sendText(sock,jid,ownerHelpLines().join('\n'));
    return true;
  }
  if (ownerPrivate && command === '!ajuda') {
    await sendText(sock, jid, fullHelpLines().join('\n'));
    return true;
  }
  if (ownerPrivate && ['!stats','/stats'].includes(command)) {
    const p = key.fromMe ? (players.get('self') || findPlayer(aliasesFor(key))) : findPlayer(aliasesFor(key));
    await sendPlayerStats(sock,jid,p);
    return true;
  }
  if (ownerPrivate && ['!ranking','/ranking'].includes(command)) {
    await sendSavedRanking(sock,jid);
    return true;
  }
  if (ownerPrivate && ['!highlights', '/highlights'].includes(command)) {
    await sendHighlights(sock, jid);
    return true;
  }

  if (['!cancelar','/cancelar','cancelar'].includes(command)) {
    await deleteRegistration(jid);
    await sendText(sock, jid, '❌ Cadastro cancelado. Quando quiser recomeçar, envie !cadastrar.');
    return true;
  }
  if (ownerPrivate && ['!meunick','/meunick','meunick'].includes(command)) {
    const p = findPlayer(aliasesFor(key));
    await sendText(sock, jid, p ? '🎮 Seu nick verificado é: ' + p.name : 'Você ainda não está cadastrado. Envie !cadastrar.');
    return true;
  }
  if (['!cadastrar','/cadastrar','cadastrar'].includes(command)) {
    await setRegistration(jid, { step: 'role_id' });
    await sendText(sock, jid, '📝 CADASTRO NOX\n\nMe envie somente o Role ID do Mobile Legends.\nExemplo: 123456789');
    return true;
  }

  if (ownerPrivate && /^[!/]battle(?:\s+.*)?$/i.test(command)) {
    await sendText(sock, jid, 'ℹ️ O Battle ID foi desativado. Use !stats para consultar seus dados do jogo.');
    return true;
  }

  const state = registrations.get(jid);
  if (!state) {
    if (!ownerPrivate) return false;
    const parsed = ownerKnowledgeQuestion(text);
    if (!parsed) return false;
    try {
      const plain = await answerNoxKnowledge(parsed.question,{
        actorKey:'owner',groupKey:'owner-self-chat',
      });
      if (!parsed.prefixed && !plain) return false;
      await sendText(sock, jid, plain);
    } catch (error) {
      console.error('Falha ao responder conhecimento no autochat:', error?.message);
      await sendText(sock, jid, '⚠️ Não consegui consultar o conhecimento agora. Tente novamente em alguns segundos.');
    }
    return true;
  }

  if (state.step === 'role_id') {
    if (!/^\d{6,12}$/.test(text)) { await sendText(sock, jid, '⚠️ Role ID inválido. Envie somente os números.'); return true; }
    await setRegistration(jid, { step: 'zone_id', roleId: text });
    await sendText(sock, jid, '🌐 Agora envie somente o Zone ID.\nExemplo: 1234');
    return true;
  }

  if (state.step === 'zone_id') {
    if (!/^\d{1,8}$/.test(text)) { await sendText(sock, jid, '⚠️ Zone ID inválido. Envie somente os números.'); return true; }
    const roleId = state.roleId;
    await sendText(sock, jid, '🔎 Solicitando o código de verificação... Ele chegará no correio interno do Mobile Legends e vale por 5 minutos.');
    try {
      const response = await apiFetch('/user/auth/send-vc', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role_id: Number(roleId), zone_id: Number(text) })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !isApiSuccess(body)) {
        await setRegistration(jid, { step: 'zone_id', roleId });
        const detail = apiErrorMessage(body);
        await sendText(sock, jid, response.status === 429 ? '⏳ Muitas solicitações. Aguarde um pouco e envie o Zone ID novamente.' : '⚠️ Não consegui solicitar o código. Confira ID e zona e tente novamente.' + (detail ? '\nMotivo: ' + String(detail).slice(0,150) : ''));
        return true;
      }
      await setRegistration(jid, { step: 'verification_code', roleId, zoneId: text });
      await sendText(sock, jid, '🔐 Código solicitado. Confira o correio do jogo e envie aqui somente o código recebido.\n\nNunca envie senha ou código de outra plataforma.');
    } catch (e) {
      await setRegistration(jid, { step: 'zone_id', roleId });
      await sendText(sock, jid, '⚠️ O serviço de autenticação não respondeu. Envie o Zone ID novamente em alguns instantes.');
    }
    return true;
  }

  if (state.step === 'verification_code') {
    if (!/^\d{4,8}$/.test(text)) { await sendText(sock, jid, '⚠️ Código inválido. Envie somente os números recebidos no correio do jogo.'); return true; }
    const { roleId, zoneId } = state;
    await sendText(sock, jid, '🔐 Validando o código...');
    try {
      const response = await apiFetch('/user/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role_id: Number(roleId), zone_id: Number(zoneId), vc: Number(text) })
      });
      const body = await response.json().catch(() => ({}));
      const jwt = body?.data?.jwt || body?.data?.token || null;
      if (!response.ok || !isApiSuccess(body) || !jwt) {
        await sendText(sock, jid, '❌ Código não validado. Confira se está correto e dentro dos 5 minutos, ou envie !cancelar.');
        return true;
      }
      const info = await apiFetch('/user/info?lang=pt', { headers: { Authorization: 'Bearer ' + jwt } });
      const infoBody = await info.json().catch(() => ({}));
      const name = info.ok && isApiSuccess(infoBody) ? profileName(infoBody?.data) : null;
      if (!name) { await sendText(sock, jid, '⚠️ Login aceito, mas não consegui confirmar seu perfil agora. Tente o código novamente em instantes.'); return true; }
      const player = { jwt, roleId, zoneId, name, nameVerified: true, savedAt: new Date().toISOString() };
      for (const alias of aliasesFor(key)) players.set(alias, player);
      players.set(jid, player);
      if (key.fromMe) players.set('self', player);
      await savePlayers();
      await deleteRegistration(jid);
      await sendText(sock, jid, '✅ CONTA VERIFICADA!\n\n🎮 Nick confirmado: ' + name + '\n🆔 ID: ' + roleId + '\n🌐 Zone: ' + zoneId + '\n\nSeu WhatsApp agora está vinculado ao NOX Stats.');
    } catch (e) {
      console.error('Falha ao autenticar jogador WhatsApp:', e?.message);
      await sendText(sock, jid, '⚠️ Erro de conexão ao validar o código. Tente novamente em alguns segundos.');
    }
    return true;
  }
  return false;
}

function mentionIds(message) {
  return collectMentionJids(message, messageText(message));
}
function jidAliases(jid) {
  const raw = String(jid || '');
  if (!raw) return [];
  const user = raw.split('@')[0];
  const bare = user.split(':')[0];
  const domains = ['@s.whatsapp.net', '@lid'];
  return [...new Set([raw, ...domains.map(domain => bare + domain)])];
}
function rememberGroupName(jid, name) {
  if (!name || /^\d{8,}$/.test(String(name).replace(/\D/g, ''))) return;
  for (const alias of linkedAliases(jid)) groupNames.set(alias, name);
}
function playerForJid(jid) {
  for (const alias of linkedAliases(jid)) {
    const player = players.get(alias);
    if (player?.name) return player;
  }
  return null;
}
function whatsappName(jid, fallback = 'jogador') {
  for (const alias of linkedAliases(jid)) {
    const name = groupNames.get(alias);
    if (name) return name;
  }
  return fallback;
}
function displayPlayer(jid, fallback = 'jogador') {
  return playerForJid(jid)?.name || (jidAliases(jid).includes(ownJid) ? players.get('self')?.name : null) || whatsappName(jid, fallback);
}
function participantJids(participant) {
  return [...new Set([
    participant?.id,
    participant?.jid,
    participant?.lid,
    participant?.phoneNumber,
    participant?.phoneNumberJid
  ].filter(Boolean).flatMap(jidAliases))];
}
async function warmGroupParticipantNames(sock, groupJid) {
  try {
    const metadata = await sock.groupMetadata(groupJid);
    for (const participant of metadata?.participants || []) {
      const aliases = participantJids(participant);
      linkIdentities(aliases);
      if (aliases.length) {
        console.log('[mention-participant-debug]', JSON.stringify({
          aliasDomains: aliases.map(jid => String(jid).split('@')[1] || 'unknown'),
          fields: Object.keys(participant || {}).sort(),
          hasNotify: Boolean(participant?.notify),
          hasName: Boolean(participant?.name),
          hasVerifiedName: Boolean(participant?.verifiedName),
          usernameType: typeof participant?.username,
          usernameValue: participant?.username == null ? null : String(participant.username).slice(0, 80)
        }));
      }
      const knownPlayer = aliases.map(playerForJid).find(Boolean);
      if (knownPlayer?.name) {
        for (const alias of aliases) rememberGroupName(alias, knownPlayer.name);
        continue;
      }
      const name = participant?.notify || participant?.name || participant?.verifiedName || participant?.username;
      if (name) for (const alias of aliases) rememberGroupName(alias, name);
    }
  } catch (error) {
    console.warn('Não consegui aquecer nomes do grupo:', error?.message);
  }
}
// Knowledge submissions use the same guided three-step conversation as !agendar.
// Each member's draft belongs only to their authenticated group JID aliases.
const knowledgeDrafts = new Map();
const KNOWLEDGE_DRAFT_TTL_MS = 15 * 60 * 1000;
function knowledgeDraftKeys(message) {
  if (message?.key?.remoteJid !== targetGroup) return [];
  if (message.key.fromMe) return [targetGroup+':owner'];
  return rsvpActorIds(message.key).map(id=>targetGroup+':'+id);
}
function currentKnowledgeDraft(message) {
  for (const key of knowledgeDraftKeys(message)) {
    const found=knowledgeDrafts.get(key);
    if (found) return found;
  }
  return null;
}
function setKnowledgeDraft(message,draft) {
  for (const key of knowledgeDraftKeys(message)) knowledgeDrafts.set(key,draft);
}
function clearKnowledgeDraft(message) {
  const draft=currentKnowledgeDraft(message);
  if (!draft) return;
  for (const [key,value] of knowledgeDrafts) {
    if (value===draft) knowledgeDrafts.delete(key);
  }
}
async function verifiedSuggestionPlayer(sock,message) {
  const ids=rsvpActorIds(message?.key);
  if (message?.key?.fromMe) {
    const self=players.get('self');
    if(self?.nameVerified===true && self?.name && self?.roleId && self?.zoneId) return self;
  }
  const find=()=>ids.concat(ids.flatMap(linkedAliases)).map(playerForJid)
    .find(p=>p?.nameVerified===true && p?.name && p?.roleId && p?.zoneId);
  let verified=find();
  if(verified) return verified;
  // Some group messages use a LID whereas the private registration used a PN
  // (or vice versa). Ask Baileys for the genuine mapping before rejecting.
  for(const id of ids) {
    try {
      const mapped=id.endsWith('@lid')
        ? await sock?.signalRepository?.lidMapping?.getPNForLID?.(id)
        : id.endsWith('@s.whatsapp.net')
          ? await sock?.signalRepository?.lidMapping?.getLIDForPN?.(id)
          : null;
      if(mapped) linkIdentities([id,mapped]);
    }catch(error){
      console.warn('Consulta de identidade para sugestão indisponível:',error?.message);
    }
  }
  return find()||null;
}
async function requireVerifiedSuggestionPlayer(sock,message) {
  const registered=await verifiedSuggestionPlayer(sock,message);
  if(registered)return registered;
  const jid=message?.key?.remoteJid;
  const deepLink=registrationLink();
  await sendText(sock,jid,
    '🔒 *SUGESTÕES EXCLUSIVAS PARA JOGADORES CADASTRADOS*\n\n' +
    'Para enviar melhorias ou dicas ao NOX, primeiro verifique sua conta no Mobile Legends.\n' +
    '📝 Envie *!cadastrar* no privado do NOX e siga as instruções (Role ID, Zone ID e código de verificação).' +
    (jid?.endsWith('@g.us') && deepLink ? '\n\n📲 *Abrir cadastro no privado:* '+deepLink : '') +
    '\n\n✅ Depois do cadastro, volte ao Geral e use *!sugestao*.');
  return null;
}

async function startKnowledgeWizard(sock,message) {
  const jid=message?.key?.remoteJid;
  if (jid!==targetGroup || !knowledgeDraftKeys(message).length) {
    await sendText(sock,jid,'⚠️ Para sugerir conhecimento, use *!conhecimento* no grupo Geral.');
    return false;
  }
  if (!await requireVerifiedSuggestionPlayer(sock,message)) return true;
  clearKnowledgeDraft(message);
  setKnowledgeDraft(message,{step:'category',expires:Date.now()+KNOWLEDGE_DRAFT_TTL_MS});
  await sendText(sock,jid,'🧠 *SUGESTÃO DE CONHECIMENTO — 1/3*\n\n' +
    '📚 Qual o *tipo de conhecimento*?\n\n' +
    '• *counter* — heróis que enfrentam um personagem\n' +
    '• *build* — equipamentos e emblemas\n' +
    '• *item* — itens específicos\n' +
    '• *dica* — estratégia e jogabilidade\n\n' +
    'Responda com uma dessas quatro palavras.\n' +
    'Digite *!sair* a qualquer momento para cancelar.');
  return true;
}
async function handleKnowledgeWizard(sock,message,raw) {
  const jid=message?.key?.remoteJid;
  if (jid!==targetGroup) return false;
  if (/^!conhecimento$/i.test(raw)) {
    await startKnowledgeWizard(sock,message);
    return true;
  }
  const draft=currentKnowledgeDraft(message);
  if (!draft) return false;
  if (Date.now()>draft.expires) {
    clearKnowledgeDraft(message);
    await sendText(sock,jid,'⌛ Sua sugestão expirou após 15 minutos. Envie *!conhecimento* para recomeçar.');
    return true;
  }
  if (/^!sair$/i.test(raw)) {
    clearKnowledgeDraft(message);
    await sendText(sock,jid,'❌ Sugestão cancelada. Nenhum conhecimento foi enviado para análise.');
    return true;
  }
  // Normal NOX commands always take precedence over an unfinished suggestion.
  if (raw.startsWith('!') || raw.startsWith('nox:')) return false;
  draft.expires=Date.now()+KNOWLEDGE_DRAFT_TTL_MS;
  if (draft.step==='category') {
    const category=normalizeKnowledgeCategory(raw);
    if (!category) {
      await sendText(sock,jid,'⚠️ Categoria não reconhecida.\n' +
        'Digite somente *counter*, *build*, *item* ou *dica* (ou *!sair*).');
      return true;
    }
    draft.category=category; draft.step='hero';
    await sendText(sock,jid,'🧠 *SUGESTÃO DE CONHECIMENTO — 2/3*\n\n' +
      '📚 Tipo: *'+KNOWLEDGE_CATEGORIES[category]+'*\n\n' +
      '🎮 Qual é o *herói* dessa dica?\n' +
      'Responda somente com o nome (ex.: *Harley*).');
    return true;
  }
  if (draft.step==='hero') {
    const hero=canonicalMlbbHero(raw);
    if (!hero) {
      await sendText(sock,jid,'⚠️ Não encontrei esse herói no Mobile Legends.\n' +
        '🎮 Digite o *nome do herói* novamente (ex.: *Harley*) ou *!sair*.');
      return true;
    }
    draft.hero=hero; draft.step='content';
    const author=await knowledgeAuthorNick(sock,message);
    await sendText(sock,jid,'🧠 *SUGESTÃO DE CONHECIMENTO — 3/3*\n\n' +
      '📚 Tipo: *'+KNOWLEDGE_CATEGORIES[draft.category]+'*\n' +
      '🎮 Herói: *'+hero+'*\n' +
      '👤 Enviada por: *'+author+'*\n\n' +
      '✍️ Agora descreva sua sugestão e explique *por que ela funciona* (20 a 580 caracteres).\n' +
      'Envie apenas o texto. *'+await knowledgeReviewerLabel()+'* vai avaliar antes de integrar à base.');
    return true;
  }
  if (draft.step==='content') {
    if (!await requireVerifiedSuggestionPlayer(sock,message)) {
      clearKnowledgeDraft(message);
      return true;
    }
    const structured='!conhecimento '+draft.hero+' | '+draft.category+' | '+raw;
    const parsed=parseKnowledgeSubmission(structured,canonicalMlbbHero);
    if (!parsed.ok) {
      await sendText(sock,jid,'⚠️ '+parsed.error+
        '\n\n✍️ Corrija *somente a descrição*. O herói e a categoria foram preservados.');
      return true;
    }
    // Reuse the existing save, notify Integrantes and restricted review flow.
    clearKnowledgeDraft(message);
    return submitCommunityKnowledge(sock,message,structured);
  }
  return false;
}

async function knowledgeReviewerLabel() {
  const state=await readCommunityKnowledge();
  return safeKnowledgeText(state.reviewer?.nick,65)||'revisor autorizado';
}
function suggestionMenuInstructions(reviewerLabel='revisor autorizado') {
  return '💡 *O QUE VOCÊ QUER SUGERIR?*\n\n' +
    '🛠️ *Melhoria do bot* — vai diretamente para o responsável pelo NOX.\n' +
    '🧠 *Conhecimento do MLBB* — é enviado para revisão exclusiva de *'+reviewerLabel+'* no grupo Integrantes.\n\n' +
    '📱 Se o menu não abrir, use *!sugestao bot* ou *!sugestao conhecimento*.';
}

async function sendSuggestionMenu(sock,jid,message=null) {
  if (!message || !await requireVerifiedSuggestionPlayer(sock,message)) return;
  const reviewerLabel=await knowledgeReviewerLabel();
  await sendText(sock,jid,suggestionMenuInstructions(reviewerLabel));
  try {
    await sendInteractive(sock,jid,buildSuggestionCategoryMenu(),[targetGroup].filter(Boolean));
  } catch(error) {
    console.warn('Menu de sugestões indisponível, comandos de texto ativos:',error?.message);
  }
}

async function handleSuggestionChoice(sock,jid,kind,message=null) {
  if (!message || !await requireVerifiedSuggestionPlayer(sock,message)) return true;
  if(kind==='bot') {
    await sendText(sock,jid,suggestionLink()
      ? '🛠️ *MELHORIA PARA O NOX*\n\nEnvie sua sugestão diretamente ao responsável no privado:\n'+suggestionLink()
      : '⚠️ Link privado indisponível. Fale com o administrador do NOX.');
    return true;
  }
  if(kind==='knowledge') {
    if (message?.key?.remoteJid===targetGroup) {
      return startKnowledgeWizard(sock,message);
    }
    await sendText(sock,jid,
      '🧠 Para enviar conhecimento para análise de *'+await knowledgeReviewerLabel()+'*, abra o grupo *Geral* e envie *!conhecimento*.\n' +
      'O NOX fará três perguntas: categoria, herói e descrição.');
    return true;
  }
  return false;
}

async function knowledgeAuthorNick(sock,message,knownIds=null) {
  const ids=knownIds||rsvpActorIds(message?.key);
  const isOwner=Boolean(message?.key?.fromMe);
  // A verified MLBB nick takes precedence over any mutable WhatsApp display name.
  let player=ids.map(playerForJid).find(p=>p?.nameVerified && p?.name);
  if (!player && isOwner) {
    const self=players.get('self');
    if (self?.nameVerified && self?.name) player=self;
  }
  if (!player) {
    for (const lid of ids.filter(id=>id.endsWith('@lid'))) {
      try {
        const pn=await sock.signalRepository?.lidMapping?.getPNForLID(lid);
        if (pn) {
          linkIdentities([lid,pn]);
          player=linkedAliases(pn).map(playerForJid).find(p=>p?.nameVerified && p?.name);
          if (player) break;
        }
      } catch(error) {
        console.warn('Não foi possível resolver o nick MLBB da sugestão:',error?.message);
      }
    }
  }
  if (player?.name) return safeKnowledgeText(player.name,65);
  const whatsAppName=ids.map(id=>whatsappName(id,'')).find(Boolean) ||
    (typeof message?.pushName==='string' ? message.pushName : '') ||
    (typeof message?.key?.pushName==='string' ? message.key.pushName : '');
  return whatsAppName ? 'Sem nick cadastrado ('+safeKnowledgeText(whatsAppName,40)+')'
    : 'Sem nick cadastrado no NOX';
}

async function submitCommunityKnowledge(sock,message,raw) {
  const jid=message.key.remoteJid;
  if(jid!==targetGroup || !/^!conhecimento(?:\s|$)/i.test(raw))return false;
  if (!await requireVerifiedSuggestionPlayer(sock,message)) return true;
  const parsed=parseKnowledgeSubmission(raw,canonicalMlbbHero);
  if(!parsed.ok) { await sendText(sock,jid,'⚠️ '+parsed.error);return true; }
  const ids=rsvpActorIds(message.key);
  if(!ids.length) {
    await sendText(sock,jid,'⚠️ Não consegui identificar seu WhatsApp; sugestão não foi enviada.');
    return true;
  }
  const registered=await verifiedSuggestionPlayer(sock,message);
  const name=safeKnowledgeText(registered?.name,65);
  if(!name) { await requireVerifiedSuggestionPlayer(sock,message); return true; }
  const proposed=await updateCommunityKnowledge(state=>appendPendingKnowledge(state,{
    id:crypto.randomBytes(4).toString('hex'),hero:parsed.hero,category:parsed.category,
    content:parsed.content,authorIds:ids,authorName:name,
  }));
  if(!proposed.ok){await sendText(sock,jid,'⚠️ '+proposed.error);return true;}
  const item=proposed.proposal;
  const reviewerLabel=await knowledgeReviewerLabel();
  await sendText(sock,jid,'📨 *SUGESTÃO RECEBIDA*\n🆔 '+item.id+
    '\n🎮 '+item.hero+' · '+KNOWLEDGE_CATEGORIES[item.category]+
    '\n⏳ Aguardando análise de *'+reviewerLabel+'* no grupo Integrantes. Ainda NÃO faz parte da base de conhecimento.');
  const reviewNotice='🧠 *NOVA SUGESTÃO DE CONHECIMENTO*\n\n'+
    '📚 *Tipo:* '+KNOWLEDGE_CATEGORIES[item.category]+
    '\n🎮 *Herói:* '+item.hero+
    '\n👤 *Enviada por:* '+item.authorName+
    '\n🆔 *ID:* '+item.id+
    '\n💬 *Conteúdo:* '+item.content+
    '\n\n⚖️ *Somente '+reviewerLabel+' pode decidir.*\n' +
    '✅ *!aprovarconhecimento '+item.id+'*\n' +
    '✏️ *!aprovarcomedicao '+item.id+'*\n' +
    '❌ *!rejeitarconhecimento '+item.id+'*\n' +
    '📋 *!propostas* — sugestões pendentes\n' +
    '📚 *!conhecimentos* — consultar, editar ou excluir os conhecimentos aprovados.\n' +
    '❓ *!comandosrevisor* — todas as funções do revisor.';
  try {
    await sendText(sock,membersGroup,reviewNotice);
    try {
      await sendInteractive(sock,membersGroup,buildKnowledgeReviewMenu(item),[membersGroup]);
    } catch(error) { console.warn('Menu de revisão não suportado; comandos de texto permanecem disponíveis:',error?.message); }
  } catch(error) {
    console.error('Sugestão salva, mas falhou o aviso no grupo Integrantes:',error?.message);
    await sendText(sock,jid,'⚠️ Sua sugestão foi salva, mas o aviso no grupo Integrantes falhou. O revisor pode recuperá-la com *!propostas*.');
  }
  return true;
}

async function configureKnowledgeReviewer(sock,jid,command) {
  const requested=String(command).trim();
  if(!/^!revisor(?:\s|$)/i.test(requested))return false;
  const match=/^!revisor\s+(\d{6,12})\s+(\d{1,8})$/i.exec(requested);
  if(requested.toLowerCase()==='!revisor'){
    const saved=await readCommunityKnowledge();
    await sendText(sock,jid,saved.reviewer
      ? '🔐 *REVISOR DE CONHECIMENTO*\n🎮 '+saved.reviewer.nick+
        '\n✅ Cadastrado como revisor exclusivo.\nPara substituir: *!revisor ROLE_ID ZONE_ID*.\nPara revogar: *!revisor desativar*.'
      : '🔐 Nenhum revisor autorizado ainda.\nDepois que o André cadastrar a conta dele no NOX, envie aqui no seu privado: *!revisor ROLE_ID ZONE_ID*.');
    return true;
  }
  if(requested.toLowerCase()==='!revisor listar'){
    const unique=new Map();
    for(const [jid,p] of players.entries()){
      if(jid==='self'||!jid.includes('@')||p?.nameVerified!==true||
        !/^\d+$/.test(String(p.roleId||''))||!/^\d+$/.test(String(p.zoneId||'')))continue;
      const key=String(p.roleId)+':'+String(p.zoneId);
      if(!unique.has(key))unique.set(key,p);
    }
    const matches=[...unique.values()].slice(0,30);
    await sendText(sock,jid,'🔎 *JOGADORES VERIFICADOS NO NOX*\n\n'+
      (matches.map((p,i)=>(i+1)+'. *'+safeKnowledgeText(p.name,65)+'* — Role ID: '+
        p.roleId+' · Zone ID: '+p.zoneId).join('\n') || 'Ainda não há cadastros verificados.')+
      '\n\nDepois que o André aparecer na lista, envie *!revisor ROLE_ID ZONE_ID* para autorizá-lo.');
    return true;
  }
  if(requested.toLowerCase()==='!revisor desativar'){
    await updateCommunityKnowledge(state=>({ok:true,data:{...state,reviewer:null}}));
    await sendText(sock,jid,'🔒 Permissão de revisor desativada. Sugestões anteriores permanecem salvas.');
    return true;
  }
  if(!match){
    await sendText(sock,jid,'⚠️ Use *!revisor ROLE_ID ZONE_ID* depois de cadastrar o André, ou *!revisor desativar*.');
    return true;
  }
  const [,roleId,zoneId]=match;
  const verified=[...players.entries()].filter(([id,p])=>id!=='self' &&
    id.includes('@') && p?.nameVerified===true &&
    String(p.roleId)===roleId && String(p.zoneId)===zoneId);
  if(!verified.length) {
    await sendText(sock,jid,'⚠️ Não encontrei uma conta com esse Role ID e Zone ID verificada no NOX. Peça ao André para concluir *!cadastrar* no privado antes.');
    return true;
  }
  const candidate=verified[0][1];
  await updateCommunityKnowledge(state=>({ok:true,data:{...state,reviewer:{
    roleId,zoneId,nick:safeKnowledgeText(candidate.name,65),assignedAt:new Date().toISOString()
  }}}));
  await sendText(sock,jid,'✅ *REVISOR DEFINIDO*\n🎮 '+safeKnowledgeText(candidate.name,65)+
    '\n🔐 O NOX verificará a conta registrada, não o nome de WhatsApp. Só esse cadastro poderá aprovar conhecimento no grupo Integrantes.');
  return true;
}

async function knowledgeReviewerForMessage(sock,message,state) {
  if (!state.reviewer || message?.key?.remoteJid!==membersGroup) return null;
  const key=message.key;
  const base=[key.participant,key.participantAlt].filter(Boolean);
  if(!base.length)return null;
  for(const jid of base.filter(id=>id.endsWith('@lid'))){
    try{
      const pn=await sock.signalRepository?.lidMapping?.getPNForLID(jid);
      if(pn)linkIdentities([jid,pn]);
    }catch(error){ console.warn('Não foi possível confirmar alias do revisor:',error?.message); }
  }
  const actor=base.flatMap(linkedAliases);
  const player=actor.map(id=>players.get(id)).find(p=>isVerifiedReviewer(p,state.reviewer));
  return player||null;
}

const knowledgeReviewDrafts = new Map();
const KNOWLEDGE_REVIEW_TTL_MS = 10 * 60 * 1000;
function reviewerDraftKey(state) {
  const reviewer=state?.reviewer;
  return membersGroup+':'+String(reviewer?.roleId||'')+':'+String(reviewer?.zoneId||'');
}
function knowledgeRow(item) {
  return '*'+item.id+'* — '+safeKnowledgeText(item.hero,35)+' ('+
    (KNOWLEDGE_CATEGORIES[item.category]||item.category)+') — '+safeKnowledgeText(item.authorName,55);
}
async function sendKnowledgeRecords(sock,jid,state,status,page) {
  const all=listKnowledgeByStatus(state,status);
  const perPage=8;
  const pages=Math.max(1,Math.ceil(all.length/perPage));
  if(!Number.isInteger(page)||page<0||page>=pages){
    await sendText(sock,jid,'⚠️ Página inexistente. Use *!'+(status==='pending'?'propostas':'conhecimentos')+'*.');
    return;
  }
  const title=status==='pending'?'🧠 *PROPOSTAS PENDENTES*':'📚 *CONHECIMENTOS APROVADOS*';
  const shown=all.slice(page*perPage,(page+1)*perPage);
  const explanation=status==='pending'
    ? 'Avalie com *!avaliarconhecimento ID* ou use *!aprovarconhecimento ID*, *!aprovarcomedicao ID*, *!rejeitarconhecimento ID*.'
    : 'Gerencie com *!editarconhecimento ID* ou *!excluirconhecimento ID*.';
  await sendText(sock,jid,title+' — '+all.length+' registro(s)\n' +
    'Página '+(page+1)+'/'+pages+'\n\n'+
    (shown.map(knowledgeRow).join('\n')||'Nenhum registro encontrado.')+
    '\n\n'+explanation+
    (pages>1?'\n📄 Próxima página: *!'+(status==='pending'?'propostas':'conhecimentos')+' '+(page+2)+'* (se disponível).':''));
  if(all.length) {
    try{
      await sendInteractive(sock,jid,buildKnowledgeRecordsMenu(all,status,page),[membersGroup]);
    }catch(error){
      console.warn('Lista interativa de conhecimento indisponível; alternativa escrita ativa:',error?.message);
    }
  }
}
async function sendKnowledgeDetail(sock,jid,item) {
  if(!item) {
    await sendText(sock,jid,'⚠️ ID não encontrado nesse grupo. Use !propostas ou !conhecimentos.');
    return;
  }
  await sendText(sock,jid,'🧠 *CONHECIMENTO #'+item.id+'*\n' +
    '📚 '+(KNOWLEDGE_CATEGORIES[item.category]||item.category)+
    ' · 🎮 '+safeKnowledgeText(item.hero,55)+
    '\n👤 Enviada por: '+safeKnowledgeText(item.authorName,65)+
    '\n📋 Situação: '+(item.status==='pending'?'Pendente':'Aprovado')+
    '\n\n💬 *Descrição:*\n'+safeKnowledgeText(item.content,580)+
    (item.status==='pending'
      ? '\n\n✅ *!aprovarconhecimento '+item.id+'*\n✏️ *!aprovarcomedicao '+item.id+'*\n❌ *!rejeitarconhecimento '+item.id+'*'
      : '\n\n✏️ *!editarconhecimento '+item.id+'*\n🗑️ *!excluirconhecimento '+item.id+'*'));
  try {
    await sendInteractive(sock,jid,item.status==='pending'
      ? buildKnowledgeReviewMenu(item)
      : buildKnowledgeApprovedActionsMenu(item),[membersGroup]);
  }catch(error){
    console.warn('Menu de conhecimento indisponível; comandos de texto ativos:',error?.message);
  }
}
async function handleKnowledgeReviewGroup(sock,message) {
  const jid=message?.key?.remoteJid;
  if(jid!==membersGroup || !message?.message || botSentMessageIds.has(message.key.id))return false;
  let raw=messageText(message.message).trim();
  const roleChoice=isInteractiveChoice(message.message)?resolveRoleClick(raw,'revisor'):null;
  if(/^nox:(?:role|owner):/.test(raw) && !roleChoice) return true;
  const clicked=isInteractiveChoice(message.message) && /^nox:knowledge:/.test(raw);
  const knownCommand=/^!(?:ajuda|comandosrevisor(?:\s+detalhes)?|propostas(?:\s+\d+)?|conhecimentos(?:\s+\d+)?|avaliarconhecimento\s+[a-f0-9]{8}|aprovarconhecimento\s+[a-f0-9]{8}|aprovarcomedi[cç][aã]o\s+[a-f0-9]{8}|aprovarcomedicao\s+[a-f0-9]{8}|rejeitarconhecimento\s+[a-f0-9]{8}|editarconhecimento\s+[a-f0-9]{8}|excluirconhecimento\s+[a-f0-9]{8}|confirmaredicao\s+[a-f0-9]{8}|confirmarexclusao\s+[a-f0-9]{8}|sair)$/i.test(raw);
  // Never read or reply to unrelated chat in Integrantes.
  if(!clicked && !knownCommand && !roleChoice && ![...knowledgeReviewDrafts.values()].some(d=>d.chat===jid))return false;
  const state=await readCommunityKnowledge();
  const reviewer=await knowledgeReviewerForMessage(sock,message,state);
  if(!reviewer) return Boolean(clicked||knownCommand);
  const key=reviewerDraftKey(state);
  let draft=knowledgeReviewDrafts.get(key);
  if(roleChoice){
    // All actions originate from a verified reviewer and a role-scoped allowlist.
    knowledgeReviewDrafts.delete(key);
    draft=null;
    if(roleChoice.key==='guia'){
      await sendText(sock,jid,reviewerHelpLines().join('\n'));
      return true;
    }
    raw=roleChoice.command||'';
  }
  if(draft && Date.now()>draft.expires) {
    knowledgeReviewDrafts.delete(key);draft=null;
    if(!knownCommand && !clicked){
      await sendText(sock,jid,'⌛ Edição expirada. Abra novamente !propostas ou !conhecimentos.');
      return true;
    }
  }
  const cancel=clicked && /^nox:knowledge:cancel:([a-f0-9]{8})$/i.exec(raw);
  if(/^!sair$/i.test(raw)||cancel){
    knowledgeReviewDrafts.delete(key);
    await sendText(sock,jid,'↩️ Operação cancelada. Nenhuma informação foi alterada.');
    return true;
  }
  if(/^!(ajuda|comandosrevisor)$/i.test(raw)){
    knowledgeReviewDrafts.delete(key);
    await sendRoleCommandsMenu(sock,jid,'revisor');return true;
  }
  if(/^!comandosrevisor detalhes$/i.test(raw)){
    await sendText(sock,jid,reviewerHelpLines().join('\n'));return true;
  }
  const listCommand=/^!(propostas|conhecimentos)(?:\s+(\d+))?$/i.exec(raw);
  const pageClick=clicked && /^nox:knowledge:page:(pending|approved):(\d+)$/i.exec(raw);
  if(listCommand||pageClick){
    knowledgeReviewDrafts.delete(key);
    const status=pageClick?pageClick[1]:listCommand[1].toLowerCase()==='propostas'?'pending':'approved';
    const page=pageClick?Number(pageClick[2]):Number(listCommand[2]||1)-1;
    await sendKnowledgeRecords(sock,jid,state,status,page);
    return true;
  }
  const openClick=clicked && /^nox:knowledge:open:(pending|approved):([a-f0-9]{8})$/i.exec(raw);
  const openText=/^!avaliarconhecimento\s+([a-f0-9]{8})$/i.exec(raw);
  if(openClick||openText){
    knowledgeReviewDrafts.delete(key);
    const status=openClick?openClick[1]:'pending';
    const id=(openClick?.[2]||openText?.[1]).toLowerCase();
    const item=state.proposals.find(p=>p.id===id && p.status===status);
    await sendKnowledgeDetail(sock,jid,item);
    return true;
  }
  const clickAction=clicked && /^nox:knowledge:(approve|approveedit|reject|edit|delete):([a-f0-9]{8})$/i.exec(raw);
  const textAction=/^!(aprovarconhecimento|aprovarcomedi[cç][aã]o|aprovarcomedicao|rejeitarconhecimento|editarconhecimento|excluirconhecimento)\s+([a-f0-9]{8})$/i.exec(raw);
  if(clickAction||textAction){
    knowledgeReviewDrafts.delete(key);
    const action=clickAction?clickAction[1]:
      ({aprovarconhecimento:'approve',aprovarcomedicao:'approveedit',aprovarcomedição:'approveedit',
        rejeitarconhecimento:'reject',editarconhecimento:'edit',excluirconhecimento:'delete'})[textAction[1].toLowerCase()];
    const id=(clickAction?.[2]||textAction?.[2]).toLowerCase();
    const requiredStatus=['approve','approveedit','reject'].includes(action)?'pending':'approved';
    const item=state.proposals.find(p=>p.id===id && p.status===requiredStatus);
    if(!item){
      await sendText(sock,jid,'⚠️ ID não encontrado ou já alterado. Use !propostas ou !conhecimentos.');
      return true;
    }
    if(action==='approve'||action==='reject'){
      const verdict=action==='approve'?'approved':'rejected';
      const result=await updateCommunityKnowledge(current=>{
        if(!isVerifiedReviewer(reviewer,current.reviewer))
          return {ok:false,error:'Sua autorização foi revogada.'};
        return reviewKnowledge(current,id,verdict,reviewer.name);
      });
      await sendText(sock,jid,result.ok
        ? (verdict==='approved'?'✅ *CONHECIMENTO APROVADO*':'❌ *SUGESTÃO REPROVADA*')+
            '\n🆔 '+id+'\n🎮 '+item.hero+
            '\n'+(verdict==='approved'?'Já está disponível como conhecimento revisado.':'Não será usada nas respostas do NOX.')
        : '⚠️ '+result.error);
      return true;
    }
    if(action==='approveedit'||action==='edit'){
      const kind=action;
      knowledgeReviewDrafts.set(key,{chat:jid,id,kind,step:'text',
        expires:Date.now()+KNOWLEDGE_REVIEW_TTL_MS});
      await sendText(sock,jid,(kind==='approveedit'
        ? '✏️ *APROVAR COM EDIÇÃO*':'✏️ *EDITAR CONHECIMENTO APROVADO*')+
        '\n🆔 '+id+' · 🎮 '+item.hero+
        '\n\n📝 *Texto atual:*\n'+safeKnowledgeText(item.content,580)+
        '\n\n✍️ Envie agora o *novo texto completo* (20 a 580 caracteres).'+
        '\nVocê poderá revisar antes de confirmar. Envie *!sair* para cancelar.');
      return true;
    }
    if(action==='delete'){
      knowledgeReviewDrafts.set(key,{chat:jid,id,kind:'delete',step:'confirm',
        expires:Date.now()+KNOWLEDGE_REVIEW_TTL_MS});
      await sendText(sock,jid,'🗑️ *EXCLUIR CONHECIMENTO APROVADO?*\n' +
        '🆔 '+id+' · 🎮 '+item.hero+
        '\n💬 '+safeKnowledgeText(item.content,400)+
        '\n\n⚠️ A dica deixará de aparecer nas respostas do NOX, mas seu histórico será preservado.'+
        '\n✅ Confirme com *!confirmarexclusao '+id+'* ou escolha no menu.\n↩️ Envie *!sair* para cancelar.');
      try {await sendInteractive(sock,jid,buildKnowledgeConfirmMenu(item,'delete'),[membersGroup]);}
      catch(error){console.warn('Confirmação clicável indisponível; texto ativo:',error?.message);}
      return true;
    }
  }
  const saveClick=clicked && /^nox:knowledge:save:([a-f0-9]{8})$/i.exec(raw);
  const saveEdit=/^!confirmaredicao\s+([a-f0-9]{8})$/i.exec(raw);
  const saveDelete=/^!confirmarexclusao\s+([a-f0-9]{8})$/i.exec(raw);
  if(saveClick||saveEdit||saveDelete){
    const id=(saveClick?.[1]||saveEdit?.[1]||saveDelete?.[1]).toLowerCase();
    if(!draft || draft.id!==id || draft.step!=='confirm' ||
      ((saveDelete && draft.kind!=='delete') || (saveEdit && draft.kind==='delete'))){
      await sendText(sock,jid,'⚠️ Não há uma alteração desse ID aguardando confirmação. Abra a lista novamente.');
      return true;
    }
    const result=await updateCommunityKnowledge(current=>{
      if(!isVerifiedReviewer(reviewer,current.reviewer))
        return {ok:false,error:'Sua autorização foi revogada.'};
      if(draft.kind==='delete')return deleteApprovedKnowledge(current,id,reviewer.name);
      if(draft.kind==='approveedit')
        return approveKnowledgeWithEdit(current,id,draft.corrected,reviewer.name);
      return editApprovedKnowledge(current,id,draft.corrected,reviewer.name);
    });
    knowledgeReviewDrafts.delete(key);
    if(!result.ok){
      await sendText(sock,jid,'⚠️ '+result.error);
      return true;
    }
    await sendText(sock,jid,(draft.kind==='delete'?'🗑️ *CONHECIMENTO EXCLUÍDO*':
      draft.kind==='approveedit'?'✅ *SUGESTÃO APROVADA COM EDIÇÃO*':
      '✅ *CONHECIMENTO ATUALIZADO*')+
      '\n🆔 '+id+' · 🎮 '+result.proposal.hero+
      '\n📚 '+(KNOWLEDGE_CATEGORIES[result.proposal.category]||result.proposal.category)+
      '\n🛡️ Histórico de revisão preservado.'+
      (draft.kind==='delete'?'\nA informação não será mais usada pelo NOX.':
        '\nAs próximas respostas usarão a versão revisada.'));
    return true;
  }
  if(draft && draft.step==='text' && !raw.startsWith('!') && !clicked){
    if(!raw || raw.length>580 || /(?:https?:\/\/|www\.)\S+/i.test(raw)){
      await sendText(sock,jid,'⚠️ Digite um texto de 20 a 580 caracteres, sem links. Envie !sair para cancelar.');
      return true;
    }
    const corrected=safeKnowledgeText(raw,580);
    if(corrected.length<20){
      await sendText(sock,jid,'⚠️ Descrição muito curta. Explique a dica em pelo menos 20 caracteres.');
      return true;
    }
    draft.corrected=corrected;draft.step='confirm';
    draft.expires=Date.now()+KNOWLEDGE_REVIEW_TTL_MS;
    const item=state.proposals.find(p=>p.id===draft.id);
    if(!item){
      knowledgeReviewDrafts.delete(key);
      await sendText(sock,jid,'⚠️ O registro não está mais disponível. Nenhuma alteração realizada.');
      return true;
    }
    await sendText(sock,jid,'✏️ *CONFIRMAR TEXTO REVISADO?*\n🆔 '+draft.id+
      '\n\n💬 '+corrected+
      '\n\n✅ Envie *!confirmaredicao '+draft.id+'* ou escolha no menu.'+
      '\n↩️ Para cancelar, envie *!sair*.');
    try{await sendInteractive(sock,jid,buildKnowledgeConfirmMenu(item,draft.kind),[membersGroup]);}
    catch(error){console.warn('Confirmação da edição sem botão; comando de texto ativo:',error?.message);}
    return true;
  }
  if(draft && !knownCommand && !clicked){
    await sendText(sock,jid,'⚠️ Ainda falta confirmar a operação. Use o botão exibido, o comando com ID ou *!sair*.');
    return true;
  }
  return Boolean(knownCommand||clicked);
}

async function appendApprovedKnowledgeToAnswer(question,answer) {
  const hero=canonicalMlbbHero(question);
  const intent=intentOf(question);
  if(!hero)return answer;
  const approved=matchApprovedKnowledge(await readCommunityKnowledge(),hero,intent);
  if(!approved.length)return answer;
  const lines=['🧠 *CONHECIMENTO DA COMUNIDADE — REVISADO*',
    ...approved.map(item=>'• '+safeKnowledgeText(item.content,580))];
  return (answer ? answer+'\n\n' : '')+lines.join('\n')+
    '\n📌 Dicas aprovadas pelo revisor do clã, não são dados oficiais da API.';
}

// AI is strictly opt-in and isolated from WhatsApp transport. It never observes
// general group chatter, only questions explicitly addressed to @NOX or
// owner-only questions already permitted by the existing routing policy.
const noxConversationalAi = createNoxAiAssistant({
  webSearch: createNoxBraveSearch(),
});
async function answerNoxKnowledge(question,{actorKey,groupKey}) {
  const vague = isVagueWinQuestion(question);
  let local = null;
  if (!vague) {
    try { local = await answerMlbbQuestion(question); }
    catch (error) {
      // Existing public knowledge APIs are best-effort; an outage should not
      // take down commands or prevent a configured model from responding.
      console.warn('Consulta da base MLBB indisponível:',error?.message);
    }
  }
  const enriched = await appendApprovedKnowledgeToAnswer(question,local);
  const fallback = enriched
    ? enriched.replace(/<br\s*\/?>/gi,'\n').replace(/<[^>]+>/g,'')
      .replace(/\\n/g,'\n')
    : makeUnknownQuestionRoast();
  if (vague) return fallback;
  let tips = [];
  const hero = canonicalMlbbHero(question);
  if (hero) {
    try { tips = matchApprovedKnowledge(await readCommunityKnowledge(),hero,intentOf(question)); }
    catch { /* answer still uses existing local fallback */ }
  }
  const response = await noxConversationalAi.reply({
    question,actorKey,groupKey,hero,baseAnswer:local||'',
    approvedTips:tips.map(t=>({content:t.content})),
  });
  if (!response?.text) return fallback;
  // Reviewed clan tips remain visibly distinct from AI generated answers.
  const reviewed=tips.length
    ? '\n\n🧠 *CONHECIMENTO DO CLÃ — REVISADO*\n' +
      tips.map(item=>'• '+safeKnowledgeText(item.content,580)).join('\n') +
      '\n📌 Dicas da comunidade; não são informação oficial.'
    : '';
  return (response.text+reviewed).slice(0,3200);
}

function suggestionLink() {
  const phone = pairPhone || String(ownJid || '').split('@')[0].split(':')[0].replace(/\D/g, '');
  return phone ? 'https://wa.me/' + phone + '?text=' + encodeURIComponent('💡 Sugestão para o NOX: ') : null;
}
function registrationLink() {
  const phone = pairPhone || String(ownJid || '').split('@')[0].split(':')[0].replace(/\D/g, '');
  return phone ? 'https://wa.me/' + phone + '?text=' + encodeURIComponent('!cadastrar') : null;
}
async function handleGroup(sock, message) {
  const key = message.key || {};
  const groupJid = key.remoteJid;
  if (!enabled || !groupJid?.endsWith('@g.us') || groupJid !== targetGroup || !message.message) return;
  // Never interpret a message that this bridge itself sent as a new command.
  if (botSentMessageIds.has(key.id)) return;
  let text = messageText(message.message);
  const mentionedNow = mentionIds(message.message);
  // Natural messages, even after hours offline, must not provoke a bot reply.
  // This gate runs before contact lookups or other response handlers.
  const isClick = isInteractiveChoice(message.message);
  const selectedMenuOption = isClick && NOX_MENU_OPTIONS.some(option => option.id === text);
  const selectedRsvpOption = isClick && /^nox:rsvp:(page|event|confirm|decline|withdraw|keep):/.test(text);
  const selectedSuggestionOption = isClick && /^nox:suggestion:(bot|knowledge)$/i.test(text);
  const knowledgeDraftActive = Boolean(currentKnowledgeDraft(message));
  const startingKnowledge = /^!conhecimento$/i.test(text);
  if (!selectedMenuOption && !selectedRsvpOption && !selectedSuggestionOption &&
      !knowledgeDraftActive && !startingKnowledge &&
      !isExplicitGroupInteraction(text, mentionedNow)) return;
  if (selectedSuggestionOption) {
    await handleSuggestionChoice(sock,groupJid,text.split(':')[2],message);
    return;
  }
  if (await handleKnowledgeWizard(sock,message,text)) return;
  if (await submitCommunityKnowledge(sock,message,text)) return;
  if (await handleDirectRsvp(sock, message, text)) return;
  if (selectedRsvpOption) {
    await handleRsvpChoice(sock,message,text);
    return;
  }
  const aliases = aliasesFor(key);
  linkIdentities([key.participant, key.participantAlt].filter(Boolean));
  if (key.pushName) for (const alias of aliases) rememberGroupName(alias, key.pushName);
  const earlyKnowledge = noxKnowledgeQuery(text);
  if (earlyKnowledge.textual) {
    const question = earlyKnowledge.cleaned.replace(/@\d{5,}/g, '').trim();
    console.log('[nox-knowledge-hit]', JSON.stringify({ fromMe: Boolean(key.fromMe), question: question.slice(0, 120) }));
    if (!question) {
      await sendText(sock, groupJid, '🎮 Tô na escuta. Ex.: @NOX quem countera Harley?\nDigite !ajuda para ver mais exemplos.');
      return;
    }
    try {
      const plain = await answerNoxKnowledge(question,{
        actorKey:key.fromMe?'owner':String(key.participant||key.participantAlt||''),
        groupKey:'nox-general',
      });
      await sendText(sock, groupJid, plain);
    } catch (error) {
      console.error('Falha no conhecimento WhatsApp:', error?.message);
      await sendText(sock, groupJid, '⚠️ Não consegui consultar o conhecimento agora. Tente novamente em alguns segundos.');
    }
    return;
  }
  for (const lid of mentionedNow.filter(jid => String(jid).endsWith('@lid'))) {
    try {
      const pn = await sock.signalRepository?.lidMapping?.getPNForLID(lid);
      if (pn) linkIdentities([lid, pn]);
    } catch (error) { console.warn('LID mapping unavailable:', error?.message); }
  }
  if (mentionedNow.length) {
    const maskJid = (jid) => {
      const raw = String(jid || '');
      const [user = '', domain = ''] = raw.split('@');
      return (user.length > 4 ? '***' + user.slice(-4) : '***') + (domain ? '@' + domain : '');
    };
    console.log('[mention-debug]', JSON.stringify({
      authorHasPushName: Boolean(key.pushName),
      authorDomains: aliases.map(jid => String(jid).split('@')[1] || 'unknown'),
      mentions: mentionedNow.map(jid => ({
        masked: maskJid(jid),
        domain: String(jid).split('@')[1] || 'unknown',
        aliases: jidAliases(jid).map(maskJid),
        playerFound: Boolean(playerForJid(jid)?.name),
        cachedNameFound: Boolean(whatsappName(jid, ''))
      }))
    }));
  }
  if (mentionedNow.some(jid => displayPlayer(jid, '') === '')) {
    await warmGroupParticipantNames(sock, groupJid);
  }
  for (const jid of mentionedNow) {
    if (displayPlayer(jid, '')) continue;
    try {
      const contact = await sock.onWhatsApp(jid).catch(() => null);
      const name = contact?.[0]?.notify || contact?.[0]?.name;
      if (name) rememberGroupName(jid, name);
    } catch {}
  }
  const authorPlayer = key.fromMe
    ? (players.get('self') || aliases.map(playerForJid).find(Boolean) || findPlayer(aliases))
    : (aliases.map(playerForJid).find(Boolean) || findPlayer(aliases));
  if (/^(?:[!\/]\s*)?nox$/i.test(text)) {
    await sendNoxMenu(sock, groupJid);
    return;
  }
  if (/^[!/]cadastrar$/i.test(text)) {
    await sendText(sock, groupJid, registrationLink()
      ? '🎮 Para cadastrar sua conta no NOX, abra o privado do administrador: ' + registrationLink()
      : '🎮 O cadastro é feito no privado. Envie !cadastrar ao responsável.');
    return;
  }
  const suggestionMatch=/^(?:[!\/]\s*)?sugest(?:a|ã)o(?:\s+(bot|melhoria|conhecimento))?$/i.exec(text);
  if (suggestionMatch) {
    const kind=suggestionMatch[1]?.toLowerCase();
    if (kind) await handleSuggestionChoice(sock,groupJid,kind==='conhecimento'?'knowledge':'bot',message);
    else await sendSuggestionMenu(sock,groupJid,message);
    return;
  }
  if (/^!agenda$/i.test(text)) {
    await sendRsvpAgenda(sock,message);
    return;
  }
  if (/^[!/]battle(?:\s+.*)?$/i.test(text)) {
    await sendText(sock, groupJid, 'ℹ️ O Battle ID foi desativado. Use !stats no Geral para consultar seus dados.');
    return;
  }
  if (/^[!/]stats$/i.test(text)) {
    await sendPlayerStats(sock, groupJid, authorPlayer);
    return;
  }
  if (/^!ajuda$/i.test(text)) {
    await sendText(sock, groupJid, fullHelpLines().join('\n'));
    return;
  }
  if (/^[!/]ranking$/i.test(text)) {
    await sendSavedRanking(sock,groupJid);
    return;
  }
  if (/^[!/]highlights$/i.test(text)) {
    await sendHighlights(sock,groupJid);
    return;
  }
  const mentioned = mentionedNow;
  const knowledge = noxKnowledgeQuery(text);
  const botWasMentioned = mentioned.some(isOwnMention);
  // A mention of the owner's WhatsApp is a normal group mention: keep the joke.
  // Only the explicit @NOX text triggers the MLBB knowledge handler.
  const noxMention = knowledge.textual;
  console.log('[nox-knowledge-debug]', JSON.stringify({ textual: knowledge.textual, botWasMentioned, fromMe: Boolean(key.fromMe), text: text.slice(0, 120), mentionCount: mentioned.length }));
  if (enabled && !botSentMessageIds.has(key.id) && mentioned.length && !noxMention) {
    const targetJid = mentioned.find(jid => jid !== ownJid) || mentioned[0];
    const author = authorPlayer?.name || key.pushName || whatsappName(aliases[0], 'alguém');
    let target = displayPlayer(targetJid, '');
    // Some group participants expose no WhatsApp profile name at all. In that case,
    // prefer the visible @mention label from the message text before using a generic fallback.
    if (!target) {
      const visibleMention = text.match(/@([^\s]{2,40})/u)?.[1]?.trim();
      target = visibleMention && !/^\d+$/.test(visibleMention) ? visibleMention : 'jogador';
    }
    await sendText(sock, groupJid, roastFor(author, target));
    return;
  }
  if (noxMention) {
    const question = knowledge.cleaned.replace(/@\d{5,}/g, '').trim();
    if (!question) {
      await sendText(sock, groupJid, '🎮 Tô na escuta. Ex.: @NOX quem countera Harley?\nDigite !ajuda para ver mais exemplos.');
      return;
    }
    try {
      const plain = await answerNoxKnowledge(question,{
        actorKey:key.fromMe?'owner':String(key.participant||key.participantAlt||''),
        groupKey:'nox-general',
      });
      await sendText(sock, groupJid, plain);
    } catch (error) {
      console.error('Falha no conhecimento WhatsApp:', error?.message);
      await sendText(sock, groupJid, '⚠️ Não consegui consultar o conhecimento agora. Tente novamente em alguns segundos.');
    }
    return;
  }
  if (/^[!/]?cadastrar$/i.test(text)) {
    if (!key.fromMe) {
      const link = registrationLink();
      await sendText(sock, groupJid, link
        ? '🔐 O cadastro é privado. Toque no link e envie a mensagem que já vai pronta:\n' + link
        : '🔐 O cadastro é privado. Abra meu PV e envie !cadastrar para vincular sua conta com segurança.');
    }
    return;
  }
  // No AFK, welcome, or other unsolicited replies to ordinary group chat.
  return;
}

async function connect() {
  await restorePlayers();
  await restoreRegistrations();
  if (!announcementHistoryLoaded) {
    const history = await readJson(announcementsFile, []);
    for (const id of Array.isArray(history) ? history.slice(-500) : []) {
      if (typeof id === 'string') announcedIds.add(id);
    }
    announcementHistoryLoaded = true;
  }
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const sock = makeWASocket({ auth: state, logger, browser: Browsers.ubuntu('Chrome'), connectTimeoutMs: 60000, keepAliveIntervalMs: 30000, syncFullHistory: false });
  sock.ev.on('contacts.upsert', contacts => { for (const contact of contacts || []) { linkIdentities([contact.id, contact.lid, contact.phoneNumber].filter(Boolean)); rememberGroupName(contact.id || contact.lid, contact.notify || contact.name || contact.verifiedName); } });
  sock.ev.on('contacts.update', contacts => { for (const contact of contacts || []) { linkIdentities([contact.id, contact.lid, contact.phoneNumber].filter(Boolean)); rememberGroupName(contact.id || contact.lid, contact.notify || contact.name || contact.verifiedName); } });
  let connectionIdentityRejected = false;
  let connectionIdentityVerified = false;
  let agendaAlertTimer = null;
  const pollAgendaNotifications = () => {
    void runAgendaNotificationTick(sock).catch(error =>
      console.error('Falha no lembrete/relatório de evento:', error?.message));
  };
  sock.ev.on('creds.update', saveCreds);
  if (!state.creds.registered && pairPhone) setTimeout(async () => {
    try {
      const code = await sock.requestPairingCode(pairPhone);
      // One-time code appears only in private Railway service logs, never in group chats.
      console.log('Código temporário de pareamento WhatsApp:', code);
    }
    catch (e) { console.error('Falha ao solicitar pareamento:', e?.message); }
  }, 10000);

  sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
    if (connection === 'open') {
      // Verify only authenticated phone-number JIDs. Brazilian accounts may use
      // either the 9-digit mobile form or the legacy 8-digit phone-number JID.
      const identityJids = [sock.user?.id, sock.user?.phoneNumber, state.creds.me?.id, state.creds.me?.phoneNumber];
      if (pairPhone && !ownerIdentityMatchesPhone(identityJids, pairPhone)) {
        connectionIdentityRejected = true;
        const kinds = identityJids.filter(Boolean).map(jid => String(jid).split('@')[1] || 'unknown');
        console.error('Segurança WhatsApp: telefone da sessão não confirmado; conexão bloqueada. Tipos de ID:', kinds.join(','));
        sock.end(new Error('WhatsApp sem confirmação de identidade'));
        return;
      }
      connectionIdentityVerified = true;
      console.log('WhatsApp: número conectado verificado contra o número configurado.');
      ownJid = sock.user?.id || null;
      ownerAccountJids = [sock.user?.id, sock.user?.lid, sock.user?.phoneNumber]
        .filter(value => typeof value === 'string' && value.includes('@'));
      console.log('WhatsApp conectado. Respostas habilitadas:', enabled);
      void discoverAnnouncementsGroup(sock);
      if (agendaAlertTimer) clearInterval(agendaAlertTimer);
      pollAgendaNotifications();
      agendaAlertTimer = setInterval(pollAgendaNotifications, 45_000);
    }
    if (connection === 'close') {
      connectionIdentityVerified = false;
      if (agendaAlertTimer) clearInterval(agendaAlertTimer);
      agendaAlertTimer = null;
      const status = lastDisconnect?.error?.output?.statusCode;
      console.error('WhatsApp socket fechado. Status:', status, 'Motivo:', lastDisconnect?.error?.message);
      if (status !== DisconnectReason.loggedOut && !connectionIdentityRejected) setTimeout(() => void connect().catch(e => console.error(e?.message)), 5000);
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (!connectionIdentityVerified) return;
    // Messages sent by the linked WhatsApp account can arrive as "append"
    // instead of "notify". They are still real commands and must be processed.
    if (!['notify', 'append'].includes(type)) return;
    for (const message of messages || []) {
      try {
        const key = message?.key || {};
        const chatJid = String(key.remoteJid || '');
        const isGroup = chatJid.endsWith('@g.us');
        // Filter before inspecting message text or logging anything about the chat.
        // Private chats with third parties are strictly out of scope.
        if (isGroup) {
          if (chatJid !== targetGroup && chatJid !== announcementsGroup && chatJid !== adminsGroup && chatJid !== membersGroup) continue;
        } else if (!canHandleRegistrationMessage(message)) continue;
        if (botSentMessageIds.has(key.id)) continue;
        const raw = message?.message || {};
        if (outgoingEchoGuard.isEcho(key, messageText(raw))) continue;
        console.log('[incoming-debug]', JSON.stringify({
          type,
          fromMe: Boolean(key.fromMe),
          group: String(key.remoteJid || '').endsWith('@g.us'),
          messageTypes: Object.keys(raw)
        }));
        if (isGroup && chatJid === adminsGroup) { await handleAdminAgenda(sock, message); continue; }
        if (isGroup && chatJid === membersGroup) { await handleKnowledgeReviewGroup(sock,message); continue; }
        if (await notifyAnnouncement(sock, message, type)) continue;
        if (await handleRegistration(sock, message)) continue;
        await handleGroup(sock, message);
      } catch (e) { console.error('Falha ao processar mensagem WhatsApp:', e?.message); }
    }
  });
}

// Never open a socket merely because the Railway service was deployed.
// A previously authenticated volume could otherwise reconnect to the owner's account.
if (process.env.WHATSAPP_CONNECT_ENABLED === 'true') {
  connect().catch(e => { console.error('WhatsApp não iniciou:', e?.message); process.exitCode = 1; });
} else {
  console.log('WhatsApp desconectado: WHATSAPP_CONNECT_ENABLED não está habilitado.');
  // Railway needs a running process while the service is safely parked.
  setInterval(() => {}, 60_000);
}
