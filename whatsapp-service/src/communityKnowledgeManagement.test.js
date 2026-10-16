import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyKnowledgeState,appendPendingKnowledge,reviewKnowledge,
  approveKnowledgeWithEdit,editApprovedKnowledge,deleteApprovedKnowledge,
  matchApprovedKnowledge,listKnowledgeByStatus,
} from './communityKnowledge.js';
import {
  buildKnowledgeReviewMenu,buildKnowledgeRecordsMenu,
  buildKnowledgeApprovedActionsMenu,buildKnowledgeConfirmMenu
} from './clickableMenuPrototype.js';

const original={
  id:'abcdef12',hero:'Harley',category:'counter',
  content:'Saber consegue finalizar o Harley em algumas situações quando há visão de jogo.',
  authorIds:['1234567890@lid'],authorName:'Abaddon'
};
const options=menu=>JSON.parse(menu.interactiveMessage.nativeFlowMessage.buttons[0].buttonParamsJson).sections[0].rows;

test('review presents approve, approve with edit and reject as three real clickable choices',()=>{
  assert.deepEqual(options(buildKnowledgeReviewMenu(original)).map(row=>row.id),[
    'nox:knowledge:approve:abcdef12',
    'nox:knowledge:approveedit:abcdef12',
    'nox:knowledge:reject:abcdef12'
  ]);
});

test('editing before approval preserves original proposal and audits revision',()=>{
  const state=appendPendingKnowledge(emptyKnowledgeState(),original,1000000).data;
  assert.equal(matchApprovedKnowledge(state,'Harley','counter').length,0);
  const approved=approveKnowledgeWithEdit(state,original.id,
    'Saber countera Harley apenas em situações específicas, com visão e tempo certo para atacar.',
    'Dark.Angel',1000010);
  assert.equal(approved.ok,true);
  assert.equal(approved.proposal.status,'approved');
  assert.equal(approved.proposal.originalContent,original.content);
  assert.equal(approved.proposal.revisions[0].kind,'approval_edit');
  assert.equal(matchApprovedKnowledge(approved.data,'Harley','counter').length,1);
  assert.equal(reviewKnowledge(approved.data,original.id,'rejected','Dark.Angel').ok,false);
});

test('revising and deleting approved knowledge preserves audit and removes from answers',()=>{
  const state=appendPendingKnowledge(emptyKnowledgeState(),original,1000000).data;
  const approved=reviewKnowledge(state,original.id,'approved','Dark.Angel',1000010);
  const edited=editApprovedKnowledge(approved.data,original.id,
    'Harley só perde a vantagem quando o Saber aproveita a janela certa de ataque.',
    'Dark.Angel',1000020);
  assert.equal(edited.ok,true);
  assert.equal(edited.proposal.revisions[0].kind,'edit');
  const deleted=deleteApprovedKnowledge(edited.data,original.id,'Dark.Angel',1000030);
  assert.equal(deleted.ok,true);
  assert.equal(deleted.proposal.status,'deleted');
  assert.equal(deleted.proposal.revisions.at(-1).kind,'delete');
  assert.deepEqual(matchApprovedKnowledge(deleted.data,'Harley','counter'),[]);
  assert.deepEqual(listKnowledgeByStatus(deleted.data,'approved'),[]);
  assert.equal(deleteApprovedKnowledge(deleted.data,original.id,'Dark.Angel').ok,false);
  assert.equal(editApprovedKnowledge(deleted.data,original.id,original.content,'Dark.Angel').ok,false);
});

test('new clickable catalog remains bounded to 10 options and has text alternatives',()=>{
  const rows=Array.from({length:19},(_,i)=>({...original,id:i.toString(16).padStart(8,'0')}));
  assert.equal(options(buildKnowledgeRecordsMenu(rows,'pending',0)).length,9);
  assert.equal(options(buildKnowledgeRecordsMenu(rows,'approved',1)).length,10);
  assert.equal(options(buildKnowledgeRecordsMenu(rows,'approved',2)).length,4);
  assert.deepEqual(options(buildKnowledgeApprovedActionsMenu(original)).map(row=>row.id),[
    'nox:knowledge:edit:abcdef12','nox:knowledge:delete:abcdef12'
  ]);
  assert.deepEqual(options(buildKnowledgeConfirmMenu(original,'delete')).map(row=>row.id),[
    'nox:knowledge:save:abcdef12','nox:knowledge:cancel:abcdef12'
  ]);
});

test('invalid edits never alter the approved record',()=>{
  const state=appendPendingKnowledge(emptyKnowledgeState(),original,1000000).data;
  const approved=reviewKnowledge(state,original.id,'approved','Dark.Angel',1000010);
  assert.equal(editApprovedKnowledge(approved.data,original.id,'oi','Dark.Angel').ok,false);
  assert.equal(approveKnowledgeWithEdit(state,original.id,'https://malicioso.test','Dark.Angel').ok,false);
  assert.equal(approved.data.proposals[0].content,original.content);
});
