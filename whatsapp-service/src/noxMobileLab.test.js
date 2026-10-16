import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const html=readFileSync(new URL('../lab/index.html',import.meta.url),'utf8');
const app=html.match(/<script>\s*(\(\(\)\s*=>\s*\{[\s\S]*?\}\)\(\);)\s*<\/script>/);
function harness() {
  const nodes = new Map();
  function node(id='') {
    return {
      id,children:[],listeners:{},dataset:{},value:id==='player'?'A':'',className:'',
      textContent:id==='status'?'🧪 Demonstração ativa.':'' ,
      disabled:false,scrollTop:0,scrollHeight:100,
      addEventListener(type,fn) {this.listeners[type]=fn;},
      appendChild(child) {this.children.push(child);},
      replaceChildren(...children) {this.children=children;},
      setAttribute(name,value){this[name]=value;},
      focus(){},
    };
  }
  function get(id){if(!nodes.has(id))nodes.set(id,node(id));return nodes.get(id);}
  const requests=[];
  const puter = {
    auth:{isSignedIn:()=>true,signIn:async()=>true},
    ai:{chat:async(messages,options)=>{
      requests.push({messages,options});
      return {message:{content:'A Miya exige bom posicionamento e pode fazer muito dano no final da partida.'}};
    }},
  };
  const document={
    getElementById:get,createElement:()=>node(),createTextNode:text=>({textContent:String(text)}),
    querySelectorAll:()=>[],
  };
  runInNewContext(app[1],{document,puter,console});
  async function submit(text){
    get('question').value=text;
    await get('chatForm').listeners.submit({preventDefault(){}});
  }
  return {get,requests,submit,puter};
}

test('mobile lab is self-contained, secure by default, and syntax-valid',()=>{
  assert.match(html,/lang="pt-BR"/);
  assert.match(html,/viewport-fit=cover/);
  assert.match(html,/https:\/\/js\.puter\.com\/v2\//);
  assert.match(html,/id="demo"/);
  assert.match(html,/id="real"/);
  assert.match(html,/id="player"/);
  assert.match(html,/aria-live="polite"/);
  assert.match(html,/Puter · franquia gratuita/);
  assert.doesNotMatch(html,/whatsapp-service\/src\/index\.js/);
  assert.doesNotMatch(html,/WHATSAPP_AUTH_DIR|WHATSAPP_PAIR_PHONE|GITHUB_TOKEN|NOX_AI_API_KEY/);
  assert.ok(app?.[1],'Inlined application script must be present');
  assert.doesNotThrow(()=>new Function(app[1]));
});

test('offline demo answers without calling paid models or WhatsApp',async()=>{
  const h=harness();
  await h.submit('Quais informações você tem sobre Miya?');
  assert.equal(h.requests.length,0);
  const texts=h.get('conversation').children.flatMap(b=>b.children.map(c=>c.textContent));
  assert.ok(texts.some(s=>s.includes('SIMULAÇÃO')));
  assert.ok(texts.some(s=>s.includes('Miya')));
  assert.match(h.get('status').textContent,/Demonstração/);
});

test('mobile real AI is only invoked after the user chooses real mode',async()=>{
  const h=harness();
  await h.get('real').listeners.click();
  assert.equal(h.get('real')['aria-pressed'],'true');
  await h.submit('Quais informações você tem sobre Miya?');
  assert.equal(h.requests.length,1);
  assert.equal(h.requests[0].options.model,'gpt-5.4-nano');
  assert.equal(h.requests[0].options.normalize,true);
  assert.ok(h.requests[0].messages.some(x=>x.role==='system'));
  assert.doesNotMatch(JSON.stringify(h.requests),/WhatsApp ID|Role ID|zoneId|@lid/);
});

test('switching the mobile lab player does not mix conversation history',async()=>{
  const h=harness();
  await h.get('real').listeners.click();
  await h.submit('Quais informações você tem sobre Miya?');
  const first=h.requests[0].messages;
  h.get('player').value='B';
  await h.get('player').listeners.change();
  await h.submit('Como funciona Harley?');
  assert.equal(h.requests.length,2);
  const second=h.requests[1].messages;
  assert.equal(second.filter(x=>x.role==='assistant').length,0);
  assert.equal(first.filter(x=>x.role==='assistant').length,0);
  assert.ok(second.every(x=>!String(x.content).includes('Herói da conversa: miya')));
});

test('typing a weather question does not call the external model after Miya',async()=>{
  const h=harness();
  await h.get('real').listeners.click();
  await h.submit('Quais informações você tem sobre Miya?');
  await h.submit('Qual a previsão do tempo hoje?');
  assert.equal(h.requests.length,1);
});
