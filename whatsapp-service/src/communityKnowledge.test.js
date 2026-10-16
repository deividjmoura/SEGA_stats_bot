import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeKnowledgeCategory,parseKnowledgeSubmission,emptyKnowledgeState,
  isVerifiedReviewer,appendPendingKnowledge,reviewKnowledge,matchApprovedKnowledge,
  safeKnowledgeText,
} from './communityKnowledge.js';
import { isExplicitGroupInteraction } from './groupTriggerPolicy.js';

const hero = name => name.trim().toLowerCase()==='harley'?'Harley':null;
const authorIds=['123456789012345@lid'];
const payload={
  id:'ab12cd34',hero:'Harley',category:'counter',
  content:'Saber funciona melhor em certas composições por causa do alcance da ultimate.',
  authorIds,authorName:'Abaddon'
};

test('members submit but never auto-approve knowledge',()=>{
  const submitted=parseKnowledgeSubmission(
    '!conhecimento Harley | counter | Saber funciona melhor em certas composições por causa do alcance da ultimate.',hero);
  assert.equal(submitted.ok,true);
  const result=appendPendingKnowledge(emptyKnowledgeState(),payload,100000);
  assert.equal(result.ok,true);
  assert.equal(result.proposal.status,'pending');
  assert.deepEqual(matchApprovedKnowledge(result.data,'Harley','counter'),[]);
  assert.deepEqual(matchApprovedKnowledge(result.data,'Harley','build'),[]);
});

test('reviewer authorization checks verified game role+zone; no nick-only bypass',()=>{
  const cfg={roleId:'123456789',zoneId:'1234',nick:'André'};
  assert.equal(isVerifiedReviewer({name:'André',roleId:'123456789',zoneId:'1234',nameVerified:true},cfg),true);
  assert.equal(isVerifiedReviewer({name:'André',roleId:'999999999',zoneId:'1234',nameVerified:true},cfg),false);
  assert.equal(isVerifiedReviewer({name:'André',roleId:'123456789',zoneId:'1234',nameVerified:false},cfg),false);
  assert.equal(isVerifiedReviewer(null,cfg),false);
  assert.equal(isVerifiedReviewer({name:'André',roleId:'123456789',zoneId:'1234',nameVerified:true},null),false);
});

test('approval adds exactly category-matched community tip, rejection stays unavailable',()=>{
  const pending=appendPendingKnowledge(emptyKnowledgeState(),payload,100000).data;
  const approved=reviewKnowledge(pending,'ab12cd34','approved','André',110000);
  assert.equal(approved.ok,true);
  assert.equal(approved.proposal.status,'approved');
  assert.equal(matchApprovedKnowledge(approved.data,'Harley','counter').length,1);
  assert.equal(matchApprovedKnowledge(approved.data,'Harley','items').length,0);
  assert.equal(matchApprovedKnowledge(approved.data,'Miya','counter').length,0);
  assert.equal(reviewKnowledge(approved.data,'ab12cd34','approved','André').ok,false);
  const rejected=reviewKnowledge(pending,'ab12cd34','rejected','André',110000);
  assert.equal(rejected.ok,true);
  assert.deepEqual(matchApprovedKnowledge(rejected.data,'Harley','counter'),[]);
});

test('spam and dangerous formatting are controlled',()=>{
  const first=appendPendingKnowledge(emptyKnowledgeState(),payload,100000);
  const duplicate=appendPendingKnowledge(first.data,{...payload,id:'aa22cc44'},200000);
  assert.equal(duplicate.ok,false);
  assert.ok(safeKnowledgeText('oi\n@todos *nao* https://example.org') .includes('[link removido]'));
  assert.equal(parseKnowledgeSubmission('!conhecimento Harley | counter | https://site.fake',hero).ok,false);
  assert.equal(parseKnowledgeSubmission('!conhecimento Inventado | counter | Informacao longa e sem vinculo.',hero).ok,false);
  assert.equal(normalizeKnowledgeCategory('DÍCAS'),'dica');
});

test('only explicit suggestion messages open the workflow in Geral',()=>{
  for(const entry of ['!sugestao','!sugestão','!sugestao conhecimento','!sugestao bot',
    '!conhecimento Harley | counter | Nota sobre heroi']) {
    assert.equal(isExplicitGroupInteraction(entry),true,entry);
  }
  for(const entry of ['eu tenho uma sugestão','a sugestão do Andre','conhecimento do Harley','agenda']) {
    assert.equal(isExplicitGroupInteraction(entry),false,entry);
  }
});
