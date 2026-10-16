import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ROLE_MENU_ITEMS,buildRoleCommandsMenu,resolveRoleClick,
  buildOwnerReviewerPicker,buildOwnerConfirmMenu
} from './roleCommandMenus.js';

function rows(menu){
  return JSON.parse(menu.interactiveMessage.nativeFlowMessage.buttons[0].buttonParamsJson)
    .sections[0].rows;
}

test('each role sees only its own actionable, clickable commands',()=>{
  for(const role of ['conselho','revisor','dono']){
    const menu=buildRoleCommandsMenu(role);
    const items=rows(menu);
    assert.ok(items.length>0&&items.length<=10);
    assert.equal(menu.interactiveMessage.header.title,'🤖 NOX bot');
    assert.equal(new Set(items.map(item=>item.id)).size,items.length);
    for(const item of items){
      const allowed=resolveRoleClick(item.id,role);
      assert.ok(allowed,'Every row must map to a concrete allowed action');
      assert.equal(item.id,'nox:role:'+role+':'+allowed.key);
      for(const other of ['conselho','revisor','dono'].filter(x=>x!==role)){
        assert.equal(resolveRoleClick(item.id,other),null,
          'Other chat roles must never resolve this action');
      }
    }
  }
});
test('button ids are fixed allowlisted choices, never arbitrary commands',()=>{
  assert.equal(resolveRoleClick('nox:role:conselho:agendar','conselho').command,'!agendar');
  assert.equal(resolveRoleClick('nox:role:revisor:propostas','revisor').command,'!propostas');
  assert.equal(resolveRoleClick('nox:role:dono:grupos','dono').command,'!grupos');
  assert.equal(resolveRoleClick('nox:role:dono:revisor','revisor'),null);
  assert.equal(resolveRoleClick('nox:role:dono:exec','dono'),null);
  assert.equal(resolveRoleClick('!revisor desativar','dono'),null);
  assert.equal(resolveRoleClick('nox:role:dono:revogar:yes','dono'),null);
  assert.equal(resolveRoleClick('nox:role:dono:revogar','dono').command,undefined);
});
test('reviewer pickers paginate and destructive actions have confirmation rows',()=>{
  const profiles=Array.from({length:18},(_,i)=>({
    nick:'Player '+i,roleId:String(123456789+i),zoneId:'1319'
  }));
  assert.equal(rows(buildOwnerReviewerPicker(profiles,0)).length,9);
  assert.equal(rows(buildOwnerReviewerPicker(profiles,1)).length,10);
  assert.equal(rows(buildOwnerReviewerPicker(profiles,2)).length,3);
  assert.deepEqual(rows(buildOwnerConfirmMenu('assign','Dark.Angel')).map(x=>x.id),
    ['nox:owner:confirm:assign','nox:owner:cancel']);
  assert.deepEqual(rows(buildOwnerConfirmMenu('revoke')).map(x=>x.id),
    ['nox:owner:confirm:revoke','nox:owner:cancel']);
  assert.throws(()=>buildOwnerConfirmMenu('dangerous'));
  assert.throws(()=>buildOwnerReviewerPicker(profiles,3));
  assert.equal(ROLE_MENU_ITEMS.conselho.length,7);
  assert.equal(ROLE_MENU_ITEMS.revisor.length,3);
  assert.equal(ROLE_MENU_ITEMS.dono.length,6);
});
