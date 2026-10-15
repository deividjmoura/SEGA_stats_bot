import test from 'node:test';
import assert from 'node:assert/strict';
import { collectMentionJids } from './mentionDetection.js';
import { isExplicitGroupInteraction } from './groupTriggerPolicy.js';
import { makeMentionRoast } from './mentionRoasts.js';

test('mentions remain actionable in several WhatsApp formats', () => {
  const lid='123456789012345@lid';
  const extended={extendedTextMessage:{text:'oi',contextInfo:{mentionedJid:[lid]}}};
  const fallback={extendedTextMessage:{text:'@123456789012345 oi'}};
  const ids1=collectMentionJids(extended,'oi');
  const ids2=collectMentionJids(fallback,'@123456789012345 oi');
  assert.deepEqual(ids1,[lid]);
  assert.deepEqual(ids2,[lid]);
  assert.ok(isExplicitGroupInteraction('oi',ids1));
  assert.ok(isExplicitGroupInteraction('@123456789012345 oi',ids2));
});
test('quoted tags and ordinary group text stay ignored',()=>{
  const lid='123456789012345@lid';
  const quote={extendedTextMessage:{text:'bom dia',contextInfo:{quotedMessage:{extendedTextMessage:{contextInfo:{mentionedJid:[lid]}}}}}};
  assert.deepEqual(collectMentionJids(quote,'bom dia'),[]);
  assert.deepEqual(collectMentionJids({conversation:'oi pessoal'},'oi pessoal'),[]);
  assert.equal(isExplicitGroupInteraction('oi pessoal',[]),false);
});
test('mention jokes still name the person who was marked',()=>{
  const joke=makeMentionRoast('Abaddon','Luiz',()=>0);
  assert.ok(joke.includes('Luiz'));
  assert.ok(joke.includes('Abaddon'));
});
