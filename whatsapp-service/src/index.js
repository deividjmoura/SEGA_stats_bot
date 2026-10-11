import makeWASocket, { DisconnectReason, useMultiFileAuthState, Browsers } from '@whiskeysockets/baileys';
import pino from 'pino';
import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import { apiFetch, isApiSuccess, apiErrorMessage, profileName } from './roneApi.js';
import { answerMlbbQuestion, listKnowledgeExamples } from './mlbbKnowledgeV2.js';

const INACTIVITY_MS = 15 * 60 * 1000;
const REGISTRATION_TTL_MS = 15 * 60 * 1000;
const logger = pino({ level: 'silent' });
const authDir = process.env.WHATSAPP_AUTH_DIR || '/app/data/whatsapp-auth-v2';
const dataDir = process.env.WHATSAPP_DATA_DIR || '/app/data';
const sessionsFile = dataDir + '/whatsapp-players.json';
const registrationsFile = dataDir + '/whatsapp-registrations.json';
const targetGroup = process.env.WHATSAPP_GROUP_JID || null;
const pairPhone = process.env.WHATSAPP_PAIR_PHONE?.replace(/\D/g, '');
const enabled = process.env.WHATSAPP_REPLY_ENABLED === 'true';
const secret = process.env.WHATSAPP_SESSION_ENCRYPTION_KEY;
if (!secret) throw new Error('WHATSAPP_SESSION_ENCRYPTION_KEY não configurada');
const SESSION_KEY = crypto.createHash('sha256').update(secret).digest();

const players = new Map();
const registrations = new Map();
const lastMessageBySender = new Map();
const botSentMessageIds = new Set();
const groupNames = new Map();
let ownJid = null;

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
function messageText(message) {
  return String(message?.conversation || message?.extendedTextMessage?.text || '').trim();
}
function aliasesFor(key) {
  return [...new Set([key?.participant, key?.participantAlt, key?.remoteJid].filter(Boolean))];
}
function findPlayer(aliases) {
  for (const jid of aliases) if (players.has(jid)) return players.get(jid);
  if (aliases.some(jid => jid === ownJid) && players.has('self')) return players.get('self');
  return null;
}
async function sendText(sock, jid, text) {
  const sent = await sock.sendMessage(jid, { text });
  if (sent?.key?.id) botSentMessageIds.add(sent.key.id);
  return sent;
}

async function handleRegistration(sock, message) {
  const key = message.key || {};
  const jid = key.remoteJid;
  if (!jid || jid.endsWith('@g.us') || botSentMessageIds.has(key.id)) return false;
  const text = messageText(message.message);
  if (!text) return false;
  const command = text.toLowerCase();

  if (['!cancelar','/cancelar','cancelar'].includes(command)) {
    await deleteRegistration(jid);
    await sendText(sock, jid, '❌ Cadastro cancelado. Quando quiser recomeçar, envie !cadastrar.');
    return true;
  }
  if (['!meunick','/meunick','meunick'].includes(command)) {
    const p = findPlayer(aliasesFor(key));
    await sendText(sock, jid, p ? '🎮 Seu nick verificado é: ' + p.name : 'Você ainda não está cadastrado. Envie !cadastrar.');
    return true;
  }
  if (['!cadastrar','/cadastrar','cadastrar'].includes(command)) {
    await setRegistration(jid, { step: 'role_id' });
    await sendText(sock, jid, '📝 CADASTRO SEGA\n\nMe envie somente o Role ID do Mobile Legends.\nExemplo: 123456789');
    return true;
  }

  const state = registrations.get(jid);
  if (!state) return false;

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
      await sendText(sock, jid, '✅ CONTA VERIFICADA!\n\n🎮 Nick confirmado: ' + name + '\n🆔 ID: ' + roleId + '\n🌐 Zone: ' + zoneId + '\n\nSeu WhatsApp agora está vinculado ao SEGA Stats.');
    } catch (e) {
      console.error('Falha ao autenticar jogador WhatsApp:', e?.message);
      await sendText(sock, jid, '⚠️ Erro de conexão ao validar o código. Tente novamente em alguns segundos.');
    }
    return true;
  }
  return false;
}

const geekTemplates = [
  '{nick} saiu do modo AFK e resolveu digitar:',
  '⚠️ Evento raro: {nick} teve uma ideia e decidiu compartilhar:',
  '{nick} reiniciou o cérebro em modo seguro e mandou:',
  '🤖 {nick} passou no CAPTCHA. Provavelmente não é bot. Disse:',
  '{nick} encontrou o teclado depois de 15 minutos e escreveu:',
  '📡 Sinal detectado de {nick}. A transmissão diz:',
  '{nick} compilou o pensamento sem erros. Resultado:',
  '🎮 {nick} apertou o botão de falar em vez do recall:',
  '{nick} desbloqueou a habilidade passiva “mandar mensagem”:',
  '🧠 CPU de {nick} chegou a 12% de uso. Saiu isso:',
  '{nick} voltou do respawn social e declarou:',
  '👾 {nick} escapou da matrix por alguns segundos para dizer:',
  '{nick} atualizou o firmware e agora aparentemente fala:',
  '🕹️ NPC {nick} recebeu uma nova linha de diálogo:',
  '🚨 Alerta no servidor: {nick} resolveu se manifestar:',
  '{nick} gastou 3 de mana para escrever:',
  '💾 {nick} carregou um pensamento do HD. Lá vem:',
  '{nick} ativou o modo multiplayer e digitou:',
  '🔧 Depois de uma manutenção não programada, {nick} disse:',
  '{nick} venceu o boss “preguiça de digitar” e mandou:',
  '🤖 Diagnóstico: {nick} é 51% humano. Mensagem encontrada:',
  '{nick} descongelou depois de 15 minutos. Primeiras palavras:',
  '📟 O servidor recebeu um pacote suspeito de {nick}:',
  '{nick} saiu do modo economia de energia para escrever:',
  '🎲 {nick} rolou um D20 para comunicação. Resultado:',
  '{nick} abriu uma side quest chamada “conversar no grupo”:',
  '🧙 {nick} conjurou Mensagem Nv. 1:',
  '{nick} aparentemente tem internet. Evidência:',
  '👽 Interceptamos uma transmissão de {nick}:',
  '{nick} terminou de renderizar a frase. Finalmente:',
  '⚙️ Processando {nick}... 100%. Saída:',
  '{nick} não é bot, segundo fontes extremamente duvidosas. Disse:',
  '🏆 Achievement desbloqueado por {nick}: falar no grupo. Mensagem:',
  '{nick} acordou o servidor com:',
  '📢 Patch notes: {nick} agora suporta comunicação por texto:',
  '{nick} usou Comunicação. Foi super efetivo:',
  '🐛 Encontramos um bug: {nick} está falando:',
  '{nick} saiu da moita e digitou:',
  '🔋 Bateria social de {nick}: 1%. Mesmo assim mandou:',
  '{nick} terminou o tutorial de WhatsApp e escreveu:',
  '🛰️ Telemetria confirma atividade de {nick}:',
  '{nick} spawnou no chat e soltou:',
  '💻 localhost/{nick}/pensamento retornou 200 OK:',
  '{nick} passou pela tela de loading e disse:',
  '🧪 Experimento concluído: {nick} consegue escrever. Prova:',
  '{nick} desativou o modo avião mental por alguns segundos:',
  '🎯 {nick} errou tudo no jogo, mas acertou o botão de enviar:',
  '{nick} pediu buff de comunicação e recebeu:',
  '🤖 beep boop... {nick} insiste que é humano. Mensagem:',
  '{nick} fez login no próprio cérebro e escreveu:',
  '🧬 Cientistas confirmam: {nick} possui pelo menos um neurônio online. Ele disse:',
  '{nick} interrompeu a farm para um pronunciamento histórico:',
  '📦 Novo pacote recebido de {nick}:',
  '{nick} ativou o chat global. Que Deus nos ajude:',
  '🎮 {nick} parou de culpar o ping por 3 segundos para dizer:',
  '{nick} saiu do lobby da existência e entrou no chat:',
  '🛠️ Sistema de fala de {nick} restaurado com sucesso:',
  '{nick} encontrou Wi-Fi na caverna e mandou:',
  '👨‍💻 git commit -m “{nick} resolveu falar”:',
  '{nick} executou sudo falar-no-grupo:',
  '🧠 RAM liberada em {nick}. Uma frase conseguiu sair:',
  '{nick} atualizou de NPC para NPC Premium e ganhou uma fala:',
  '🚀 Houston, temos uma mensagem de {nick}:',
  '{nick} zerou a missão “ficar quieto” e iniciou outra:',
  '🤓 Segundo meus cálculos, {nick} está tentando se comunicar:',
  '{nick} venceu o cooldown social. Próxima habilidade:',
  '📱 Até o WhatsApp ficou surpreso: {nick} escreveu:',
  '{nick} voltou do multiverso com esta informação:',
  '🦾 Protocolo {nick}.exe iniciado. Output:',
  '{nick} desbloqueou diálogo secreto:',
  '⚡ Pico de atividade detectado em {nick}:',
  '{nick} apertou Enter sem querer e aconteceu isso:',
  '🎰 Giramos a roleta do chat e caiu em {nick}:',
  '{nick} finalmente saiu do tutorial. Fala desbloqueada:',
  '🧟 {nick} voltou dos mortos digitais para dizer:',
  '{nick} mandou um pacote UDP: pode chegar sem sentido:',
  '🔮 A bola de cristal previu que {nick} falaria. Acertou:',
  '{nick} trocou XP por uma frase:',
  '🛸 O radar do SEGA detectou {nick} se aproximando do chat:',
  '{nick} saiu do modo espectador e participou:',
  '🏴‍☠️ {nick} pirateou alguns neurônios e produziu:',
  '{nick} tem algo a dizer. O servidor pediu desculpas antecipadamente:',
  '🎮 Quest atualizada: ouvir o que {nick} inventou agora:',
  '{nick} ativou o microfone textual:',
  '🤖 CAPTCHA aprovado. {nick} pode continuar fingindo que é humano:',
  '{nick} abriu uma exceção no silêncio:',
  '🧩 Encontramos a peça que faltava: era {nick} falando:',
  '{nick} enviou isso antes que o cérebro pudesse cancelar:',
  '💿 Inserindo disco “Opiniões de {nick}”... leitura iniciada:',
  '{nick} deu alt-tab na vida real e veio para o grupo:',
  '🧠 Neurônio 1 chamou neurônio 2. {nick} conseguiu escrever:',
  '{nick} aparentemente sobreviveu ao último match. Relatório:',
  '🎤 Senhoras e senhores, infelizmente {nick} está com a palavra:',
  '{nick} ativou a ultimate: Opinião Não Solicitada:',
  '📶 {nick} pegou duas barrinhas de sinal e aproveitou:',
  '{nick} saiu do cooldown. Lá vem:',
  '🗿 Após eras em silêncio, {nick} pronunciou:',
  '{nick} clicou em “aceito os termos” sem ler e agora pode falar:',
  '👾 Boss secreto {nick} iniciou diálogo:',
  '{nick} descobriu que o grupo não é modo somente leitura:',
  '🔌 Conectamos {nick} na tomada. Funcionou:',
  '{nick} instalou o DLC “Comunicação” e mandou:',
  '🎮 O matchmaking colocou {nick} contra o português. Resultado:',
  '{nick} foi promovido de bot para beta tester humano. Disse:'
];

function geekLine(nick, senderKey, now = Date.now()) {
  // Há 653 combinações estáveis: 101 frases-base × variações de abertura.
  const seed = [...String(senderKey) + ':' + Math.floor(now / INACTIVITY_MS)]
    .reduce((sum, ch) => (sum * 31 + ch.codePointAt(0)) >>> 0, 2166136261);
  const base = geekTemplates[seed % geekTemplates.length];
  const prefixes = ['', '🎮 ', '⚡ ', '👾 ', '🤖 ', '🕹️ ', '💾 '];
  const prefix = prefixes[Math.floor(seed / geekTemplates.length) % prefixes.length];
  return prefix + base.replaceAll('{nick}', nick);
}

const mentionRoasts = [
  '{target}, cê tá de ladaia pro lado do {author}? 😂',
  '{target}, o {author} te marcou. Eu no seu lugar fingia queda de internet. 👀',
  '🚨 {target}, atenção: {author} invocou você. Geralmente boss aparece depois disso.',
  '{target}, {author} te chamou. Não sei o motivo, mas já separa um advogado. 😂',
  '📡 {target}, detectei uma tentativa de contato de {author}. Deseja bloquear ou sofrer?',
  '{target}, olha quem lembrou de você: {author}. Meus pêsames. 🤖',
  '⚠️ {target}, {author} te marcou. A treta recebeu atualização de firmware.',
  '{target}, corre que {author} tá te procurando. Eu não vi nada. 🏃',
  '🎮 {target}, missão secundária desbloqueada: responder {author} sem perder a amizade.',
  '{target}, {author} solicitou sua presença. O RH do clã já foi avisado. 😂',
  '👾 {target}, você foi summonado por {author}. Cooldown para fugir: zero.',
  '{target}, {author} te marcou e o clima ficou igual lobby depois de derrota. 👀',
  '🤖 {target}, protocolo de emergência: {author} quer falar com você.',
  '{target}, se eu fosse você não respondia {author} sem salvar o jogo antes. 😂',
  '🧠 {target}, {author} gastou o último neurônio disponível pra te marcar. Valorize.',
  '{target}, parabéns: {author} selecionou você como próximo problema do dia. 🏆',
  '📢 {target}, compareça ao chat. {author} abriu um chamado e não informou a gravidade.',
  '{target}, {author} está te chamando. Minha análise técnica recomenda cautela e capacete.',
  '🕹️ {target}, NPC {author} iniciou diálogo com você. Pular cutscene?',
  '{target}, o radar detectou {author} na sua cola. Boa sorte, soldado. 🫡',
  '💀 {target}, {author} te marcou. Foi bom conhecer você.',
  '{target}, {author} quer sua atenção. Isso nunca termina em coisa produtiva. 😂',
  '🚨 {target}, ameaça detectada: uma notificação de {author}. Nível de perigo: fofoca.',
  '{target}, {author} te convocou. O tribunal do SEGA está oficialmente em sessão. ⚖️',
  '👀 {target}, eu vi {author} te marcando. Não vou me meter... ainda.',
  '{target}, {author} usou “Marcar Jogador”. Foi super efetivo. 🎮',
  '🧙 {target}, {author} lançou Invocação Nv. 5. Você apareceu contra a sua vontade.',
  '{target}, cuidado: {author} digitou seu nome com intenção. Isso é preocupante. 😂',
  '📞 {target}, ligação a cobrar de {author}. Para aceitar, responda e arque com as consequências.',
  '{target}, {author} te chamou. Backup feito? Testamento atualizado? Então pode responder. 💀',
  '🤡 {target}, {author} pediu sua presença no circo. Seu camarim já está pronto.',
  '{target}, aparentemente {author} precisa de você. Ou de terapia. Ainda estou calculando. 🤖',
  '⚔️ {target}, duelo solicitado por {author}. Recusar custa 10 pontos de honra imaginários.',
  '{target}, {author} te marcou. O algoritmo classificou como “potencialmente suspeito”.',
  '🛸 {target}, transmissão alienígena interceptada: {author} está tentando contato.',
  '{target}, {author} acabou de puxar sua ficha no chat. Recomendo silêncio estratégico. 😂',
  '📦 {target}, chegou uma encomenda de {author}: contém cobrança e possível resenha.',
  '{target}, {author} ativou sua passiva “encher o saco dos outros”. Você foi o escolhido. 😂',
  '🔮 {target}, consultei a bola de cristal: responder {author} pode gerar 37 mensagens adicionais.',
  '{target}, {author} abriu uma side quest envolvendo você. Recompensa: absolutamente nada.',
  '🧯 {target}, {author} te marcou. Extintor localizado à esquerda caso a conversa esquente.',
  '{target}, aviso do sistema: {author} está solicitando atenção humana. Isso é raro.',
  '🎲 {target}, {author} rolou um D20 e caiu em “perturbar {target}”.',
  '{target}, {author} chamou. Você tem 5 segundos antes que ele mande “??”. 😂',
  '🧟 {target}, levanta daí: {author} invocou você dos mortos digitais.',
  '{target}, {author} quer falar contigo. O SEGA Stats não se responsabiliza por danos emocionais.',
  '🔋 {target}, economize bateria: talvez responder {author} não valha os elétrons.',
  '{target}, {author} te encontrou no mapa. Bush não funciona mais. 🌿',
  '🏴‍☠️ {target}, {author} embarcou no navio da resenha e te colocou na tripulação.',
  '{target}, {author} iniciou uma reunião que poderia ter sido absolutamente nada. 😂',
  '{target}, {author} te marcou. Até o bot sentiu cheiro de merda vindo dessa conversa. 💩',
  '{target}, responde o {author} logo antes que ele comece a pensar sozinho e piore tudo. 😂',
  '🚑 {target}, {author} chamou você. A ambulância foi avisada por precaução.',
  '{target}, {author} quer falar contigo. Se vier ideia boa, confirma se a conta dele foi hackeada.',
  '💀 {target}, {author} te marcou. Mais uma decisão ruim pra coleção de vocês.',
  '{target}, cuidado: {author} está tentando formar uma frase completa. Você pode ser testemunha desse milagre.',
  '🤡 {target}, o palhaço {author} pediu reforço. O circo agora tem elenco completo.',
  '{target}, {author} te chamou pra reunião dos dois neurônios restantes do clã. Compareça.',
  '⚠️ {target}, não faça movimentos bruscos. {author} aparentemente está tentando raciocinar.',
  '{target}, {author} quer sua opinião. Considerando o histórico de vocês, estamos oficialmente fodidos. 😂',
  '🪦 {target}, {author} te marcou. Já reservei duas vagas no cemitério da dignidade.',
  '{target}, {author} chamou. Talvez seja importante. KKKKK desculpa, nem eu consegui escrever isso sério.',
  '🧠 {target}, empresta um neurônio pro {author}. O dele está claramente em manutenção.',
  '{target}, {author} quer conversar. Minha recomendação profissional: não alimente o animal.',
  '🚨 {target}, {author} está solto no grupo novamente. Contenção falhou.',
  '{target}, o {author} te chamou. Se a conversa ficar inteligente eu reinicio o bot porque claramente deu bug.',
  '🎪 {target}, {author} abriu o circo e você acaba de ser anunciado como atração principal.',
  '{target}, {author} marcou você. O nível intelectual médio da conversa caiu antes mesmo da resposta.',
  '☠️ {target}, {author} quer papo. Não aceite bebida nem conselho financeiro dele.',
  '{target}, atende o {author}. Ele está carente e o CAPS do Land of Dawn fechou cedo. 😂',
  '🧯 {target}, {author} está cozinhando alguma merda. Trouxe o extintor?',
  '{target}, {author} te convocou. O prêmio por responder é ganhar outra mensagem dele.',
  '🤖 {target}, análise concluída: ignorar {author} aumenta sua expectativa de vida em 14%.',
  '{target}, {author} te marcou porque aparentemente tomar decisão ruim sozinho perdeu a graça.',
  '🗑️ {target}, chegou uma notificação de {author}. O WhatsApp ainda não implementou coleta seletiva.',
  '{target}, {author} precisa de ajuda. De novo. Finja surpresa.',
  '🎮 {target}, missão lendária: descobrir que porra {author} quer sem perder sanidade.',
  '{target}, {author} chamou. Coloque o cérebro no modo avião pra vocês conversarem de igual pra igual. 😂',
  '👻 {target}, finge que não viu. Talvez {author} ache que você morreu e desista.',
  '{target}, {author} te marcou. Eu poderia explicar o motivo, mas nem inteligência artificial faz milagre.',
  '🧪 {target}, você foi selecionado para um experimento: medir quanto tempo alguém aguenta conversar com {author}.',
  '{target}, {author} pediu sua atenção. Meus servidores calcularam 98% de chance de ser bobagem.',
  '💣 {target}, {author} lançou a granada e marcou você. Agora segura essa merda. 😂',
  '{target}, o {author} está te procurando. Eu entregaria ele pros creeps e seguiria a partida.',
  '🦧 {target}, {author} chamou. Tradutor de primata ativado, pode responder.',
  '{target}, {author} digitou seu nome sem errar. Já é a maior conquista dele hoje. 🏆',
  '🚽 {target}, {author} trouxe uma ideia. Pela qualidade prevista, provavelmente veio sentado no vaso.',
  '{target}, {author} quer discutir. Dois idosos brigando por WhatsApp: o futuro chegou. 😂',
  '📉 {target}, desde que {author} te marcou o QI do servidor caiu 12 pontos.',
  '{target}, {author} te convocou. Não esquece de falar devagar e usar desenhos.',
  '🧟 {target}, responde o {author}; ele está vagando pelo chat atrás de atividade cerebral.',
  '{target}, {author} te marcou. É assim que começam documentários sobre decisões catastróficas.',
  '🤦 {target}, o {author} teve uma ideia e, em vez de guardar pra si, resolveu te envolver.',
  '{target}, {author} está pedindo atenção. Alguém esqueceu o portão do hospício do Land of Dawn aberto.',
  '⚰️ {target}, {author} chamou. Se for duo rankeada, meus sentimentos antecipados.',
  '{target}, {author} quer você no chat. A dignidade é opcional; aparentemente vocês já decidiram isso.',
  '🔥 {target}, {author} te marcou. O incêndio ainda não começou, mas trouxe gasolina por garantia.',
  '{target}, {author} solicitou suporte técnico. Erro identificado entre a cadeira e o celular.',
  '🧠 {target}, cuidado ao responder {author}: burrice em grupo pode ser contagiosa.',
  '{target}, {author} chamou. Não sei quem está mais ferrado: quem perguntou ou quem vai responder.'
];

function mentionIds(message) {
  const m = message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
  return [...new Set(m.filter(Boolean))];
}
function displayPlayer(jid, fallback = 'jogador') {
  return players.get(jid)?.name || (jid === ownJid ? players.get('self')?.name : null) || groupNames.get(jid) || fallback;
}
function roastFor(author, target, key) {
  const seed = [...String(key || '')].reduce((n, ch) => (n * 33 + ch.codePointAt(0)) >>> 0, 5381);
  return mentionRoasts[seed % mentionRoasts.length].replaceAll('{author}', author).replaceAll('{target}', target);
}

async function handleGroup(sock, message) {
  const key = message.key || {};
  const groupJid = key.remoteJid;
  if (!groupJid?.endsWith('@g.us') || groupJid !== targetGroup || !message.message) return;
  const text = messageText(message.message);
  const aliases = aliasesFor(key);
  if (key.pushName) for (const alias of aliases) groupNames.set(alias, key.pushName);
  const authorPlayer = key.fromMe ? (players.get('self') || findPlayer(aliases)) : findPlayer(aliases);
  const mentioned = mentionIds(message.message);
  if (enabled && !botSentMessageIds.has(key.id) && mentioned.length) {
    const targetJid = mentioned.find(jid => jid !== ownJid) || mentioned[0];
    const author = authorPlayer?.name || 'alguém';
    const target = displayPlayer(targetJid, 'você aí');
    await sendText(sock, groupJid, roastFor(author, target, key.id));
    return;
  }
  const segaMention = /@sega(?:[ _]?stats)?(?:[ _]?bot)?\b/i.test(text);
  if (segaMention) {
    const question = text.replace(/@sega(?:[ _]?stats)?(?:[ _]?bot)?\b/ig, '').trim();
    if (!question) {
      await sendText(sock, groupJid, '🎮 Tô na escuta. Pergunte, por exemplo: @SEGA quem countera Harley?');
      return;
    }
    try {
      const answer = await answerMlbbQuestion(question);
      const plain = answer
        ? answer.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')
        : '🧠 Ainda não entendi essa pergunta. Tente algo como:\n' + listKnowledgeExamples().slice(0, 5).map(x => '• @SEGA ' + x).join('\n');
      await sendText(sock, groupJid, plain);
    } catch (error) {
      console.error('Falha no conhecimento WhatsApp:', error?.message);
      await sendText(sock, groupJid, '⚠️ Meu cérebro geek tropeçou num cabo. Tente a pergunta novamente em alguns segundos.');
    }
    return;
  }
  if (/^[!/]?cadastrar$/i.test(text)) {
    if (!key.fromMe) await sendText(sock, groupJid, '🔐 O cadastro é privado. Chame este bot no WhatsApp e envie !cadastrar para vincular sua conta com segurança.');
    return;
  }
  if (!enabled || botSentMessageIds.has(key.id)) return;
  const player = authorPlayer;
  if (!player?.name) return;
  const senderKey = aliases[0];
  const now = Date.now();
  const timerKey = groupJid + ':' + senderKey;
  const previous = lastMessageBySender.get(timerKey);
  lastMessageBySender.set(timerKey, now);
  if (previous !== undefined && now - previous < INACTIVITY_MS) return;
  await sendText(sock, groupJid, geekLine(player.name, senderKey, now));
}

async function connect() {
  await restorePlayers();
  await restoreRegistrations();
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const sock = makeWASocket({ auth: state, logger, browser: Browsers.ubuntu('Chrome'), connectTimeoutMs: 60000, keepAliveIntervalMs: 30000, syncFullHistory: false });
  sock.ev.on('creds.update', saveCreds);
  if (!state.creds.registered && pairPhone) setTimeout(async () => {
    try { await sock.requestPairingCode(pairPhone); console.log('Código de pareamento solicitado com sucesso.'); }
    catch (e) { console.error('Falha ao solicitar pareamento:', e?.message); }
  }, 10000);

  sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
    if (connection === 'open') {
      ownJid = sock.user?.id || null;
      console.log('WhatsApp conectado. Respostas habilitadas:', enabled);
    }
    if (connection === 'close') {
      const status = lastDisconnect?.error?.output?.statusCode;
      console.error('WhatsApp socket fechado. Status:', status, 'Motivo:', lastDisconnect?.error?.message);
      if (status !== DisconnectReason.loggedOut) setTimeout(() => void connect().catch(e => console.error(e?.message)), 5000);
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const message of messages || []) {
      try {
        if (await handleRegistration(sock, message)) continue;
        await handleGroup(sock, message);
      } catch (e) { console.error('Falha ao processar mensagem WhatsApp:', e?.message); }
    }
  });
}

connect().catch(e => { console.error('WhatsApp não iniciou:', e?.message); process.exitCode = 1; });
