#!/usr/bin/env node
/**
 * Standalone NOX AI conversation playground.
 *
 * Does not import Baileys, connect WhatsApp, access player database, or write
 * production state. --demo uses fake model responses (clearly labeled).
 * --live calls ONLY a provider explicitly configured in the environment.
 */
import readline from 'node:readline/promises';
import process from 'node:process';
import assert from 'node:assert/strict';
import { createNoxAiAssistant } from './noxAiAssistant.js';
import { createNoxBraveSearch } from './noxAiSearch.js';
import { canonicalMlbbHero, answerMlbbQuestion } from './mlbbKnowledgeV2.js';

const DEMO_ENV = Object.freeze({
  NOX_AI_ENABLED: 'true',
  NOX_AI_PROVIDER: 'groq',
  NOX_AI_API_KEY: 'OFFLINE_FAKE_KEY_NOT_FOR_API',
  NOX_AI_MODEL: 'offline-nox-demo',
  NOX_AI_COOLDOWN_MS: '1000',
  NOX_AI_DAILY_PER_PLAYER: '100',
  NOX_AI_DAILY_GLOBAL: '200',
  NOX_AI_WEB_SEARCH_ENABLED: 'false',
});

const HELP = [
  '🐺 NOX IA — laboratório seguro, sem WhatsApp',
  '',
  'Uso: node src/noxAiPlayground.js --demo',
  '     node src/noxAiPlayground.js --self-test',
  '     node src/noxAiPlayground.js --live',
  '',
  '--demo       Simula um provedor. Não usa internet nem consome créditos de IA.',
  '--self-test  Simula conversa, contexto, separação de jogadores e retorno local.',
  '--live       Usa NOX_AI_PROVIDER, NOX_AI_MODEL e NOX_AI_API_KEY',
  '             do seu ambiente; pode gerar custos reais no provedor escolhido.',
  '',
  'Comandos durante a conversa:',
  '/ajuda      Exibe estas instruções',
  '/trocar     Alterna entre jogadores de teste A e B',
  '/sair       Encerra o simulador',
  '',
  'Este utilitário NÃO conecta ao WhatsApp nem acessa dados reais do clã.',
].join('\n');

const demoExamples = Object.freeze({
  Miya: 'Miya é uma atiradora de dano contínuo, dependente de posicionamento. Em jogo real, avalie o controle de grupo inimigo.',
  Harley: 'Harley é um mago/assassino de explosão. Procure visão de mapa e cuidado com sua aproximação.',
  Tigreal: 'Tigreal é um tanque com controle de grupo; a coordenação com aliados faz diferença.',
});

function makeDemoResponse(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const last = String(messages.at(-1)?.content || '');
  const heroMatch = last.match(/Herói em discussão:\s*([^\n]+)/i);
  const hero = heroMatch?.[1]?.trim() || [...Object.keys(demoExamples)]
    .find(name => last.toLowerCase().includes(name.toLowerCase())) || 'Miya';
  const question = last.split('Pergunta atual do jogador:\n').at(-1) || last;
  const answer = /build|itens|equipamentos/i.test(question)
    ? 'Para ' + hero + ', prefira montar itens de acordo com a composição adversária. Este é só um exemplo simulado, não uma build atualizada.'
    : /counter|contra|enfrentar/i.test(question)
      ? 'Para enfrentar ' + hero + ', avalie controle de grupo, posicionamento e tempo das habilidades. Resposta demonstrativa.'
      : demoExamples[hero] || ('Podemos conversar sobre ' + hero + ', mas esta resposta é apenas uma simulação local.');
  return '🧪 [SIMULAÇÃO — NÃO É IA REAL]\n' + answer;
}

function makeMockFetch(counters) {
  return async (url, init) => {
    counters.calls += 1;
    const body = JSON.parse(String(init?.body || '{}'));
    counters.prompts.push(body);
    const answer = makeDemoResponse(body);
    return { ok: true, json: async () => ({ choices: [{ message: { content: answer } }] }) };
  };
}

function createDemoLab({ now = () => Date.now(), counters = { calls: 0, prompts: [] } } = {}) {
  const assistant = createNoxAiAssistant({
    env: DEMO_ENV, fetchImpl: makeMockFetch(counters), now,
  });
  return { assistant, counters, real: false };
}

function createLiveLab() {
  const env = { ...process.env, NOX_AI_ENABLED: 'true' };
  if (!['openrouter', 'groq', 'openai'].includes(String(env.NOX_AI_PROVIDER || '').toLowerCase())
    || !env.NOX_AI_MODEL || !env.NOX_AI_API_KEY) {
    throw new Error('Configure NOX_AI_PROVIDER (openrouter/groq/openai), NOX_AI_MODEL e NOX_AI_API_KEY em variáveis de ambiente, sem colar a chave no chat.');
  }
  const assistant = createNoxAiAssistant({
    env, webSearch: createNoxBraveSearch({ env }),
  });
  return { assistant, real: true };
}

async function ask(assistant, question, actorKey, { demo = true, actorPrefix = 'laboratorio' } = {}) {
  const hero = canonicalMlbbHero(question);
  // Demo uses only fixed, non-personal fixture information. Live mode queries the
  // same MLBB knowledge module used by the bridge, but never accesses WhatsApp.
  let local = '';
  if (demo) {
    if (hero && /^(quem countera|qual (?:a )?build|quais itens)/i.test(question.trim()))
      local = 'Consulta local (demonstração): os itens e counters devem ser conferidos na base revisada.';
  } else {
    try { local = (await answerMlbbQuestion(question)) || ''; }
    catch { /* Existing MLBB APIs may be unavailable. Do not stop the lab. */ }
  }
  const result = await assistant.reply({
    question, hero, actorKey: actorPrefix + ':' + actorKey,
    groupKey: 'isolated-terminal-playground',
    baseAnswer: local, approvedTips: [],
  });
  return { ...result, local };
}

async function selfTest() {
  let clock = Date.parse('2026-10-16T12:00:00.000Z');
  const { assistant, counters } = createDemoLab({ now: () => clock });
  const first = await ask(assistant, 'Quais informações você tem sobre a Miya?', 'player-A');
  assert.equal(first.status, 'answer');
  assert.match(first.text, /Miya/);
  assert.equal(counters.calls, 1);
  clock += 1200;
  const follow = await ask(assistant, 'E a build dela?', 'player-A');
  assert.equal(follow.status, 'answer');
  assert.match(follow.text, /build|itens/i);
  assert.equal(counters.calls, 2);
  const other = await ask(assistant, 'E a build dela?', 'player-B');
  assert.equal(other.status, 'off_topic');
  assert.equal(counters.calls, 2);
  const local = await ask(assistant, 'Quem countera Miya?', 'player-B');
  assert.equal(local.status, 'local');
  assert.equal(counters.calls, 2);
  const offTopic = await ask(assistant, 'Qual a previsão do tempo?', 'player-A');
  assert.equal(offTopic.status, 'off_topic');
  console.log('✅ Playground: 5 cenários passaram (conversa, contexto, isolamento, prioridade local e assunto proibido).');
  console.log('✅ Nenhuma chamada real de IA, WhatsApp ou Railway. Requisições simuladas: ' + counters.calls);
  console.log('\nExemplo de conversa simulada:\nNOX: ' + first.text + '\nNOX: ' + follow.text);
}

async function interactive(mode) {
  const demo = mode !== '--live';
  const lab = demo ? createDemoLab() : createLiveLab();
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let player = 'A';
  try {
    console.log(HELP);
    console.log('\n' + (demo
      ? '🧪 Modo demonstração: respostas inventadas por um simulador local (NÃO são IA real).'
      : '🌐 Modo IA real: perguntas serão enviadas ao provedor configurado e podem gerar custo.'));
    while (true) {
      let value;
      try { value = await rl.question('\n👤 Jogador ' + player + ' > '); }
      catch { break; }
      const question = value.trim();
      if (!question) continue;
      if (question === '/sair') break;
      if (question === '/ajuda') { console.log('\n' + HELP); continue; }
      if (question === '/trocar') { player = player === 'A' ? 'B' : 'A'; console.log('Agora conversando como jogador ' + player); continue; }
      const result = await ask(lab.assistant, question, player, { demo });
      if (result.text) console.log('\n🤖 NOX: ' + result.text);
      else if (result.status === 'local') console.log('\n📚 NOX (base local): ' + (result.local || 'Resposta já coberta pela base; IA não foi acionada.'));
      else if (result.status === 'off_topic') console.log('\n🤖 NOX: Vamos conversar sobre Mobile Legends! Para ideias diferentes, use !sugestao.');
      else if (result.status === 'cooldown') console.log('\n⏳ NOX: Aguarde alguns segundos antes de perguntar novamente.');
      else if (result.status === 'quota') console.log('\n🔒 NOX: Limite de perguntas de IA alcançado neste dia.');
      else console.log('\n⚠️ NOX: IA indisponível (' + result.status + '). A produção não foi afetada.');
    }
  } finally {
    rl.close();
  }
}

async function main() {
  const arg = process.argv[2] || '--demo';
  if (arg === '--help' || arg === '-h') return console.log(HELP);
  if (arg === '--self-test') return selfTest();
  if (arg !== '--demo' && arg !== '--live') throw new Error('Opção desconhecida: ' + arg + '\n' + HELP);
  return interactive(arg);
}

main().catch(error => {
  console.error('Falha no laboratório:', error.message);
  process.exitCode = 1;
});
