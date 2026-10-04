# Arquitetura

## Visão geral

O SEGA Stats Bot possui três responsabilidades principais:

1. conversar com o usuário pelo Telegram;
2. autenticar e identificar o jogador do MLBB;
3. transformar dados externos em informações úteis para o jogador e para o clã.

A regra de evolução é manter a lógica do bot separada da fonte de dados.

## Fluxo atual

```text
Telegram
   │
   ▼
Bot / handlers
   │
   ▼
Player session
   │
   ▼
Rone Arena API
   │
   ├── Perfil
   ├── Stats
   ├── Temporadas
   └── Partidas
   │
   ▼
Ranking / Telegram
```

## Estado atual

`src/index.js` concentra atualmente:

- handlers do Telegram;
- fluxo de cadastro;
- autenticação;
- persistência de sessão;
- chamadas à API;
- transformação das partidas;
- ranking.

O núcleo do bot agora delega a comunicação com a Rone para `src/roneApi.js`, mantendo handlers, OCR, persistência e renderização separados. O próximo passo arquitetural é transformar esse módulo em uma interface formal de provider.

## Próxima arquitetura

A próxima etapa deve separar a fonte de dados em um provider:

```js
class MlbbProvider {
  async authenticate(roleId, zoneId, code) {}
  async getPlayerInfo(session) {}
  async getStats(session) {}
  async getSeasons(session) {}
  async getMatches(session, seasonId) {}
  async getMatchDetails(session, matchId) {}
}
```

O bot passa a depender dessa interface, não de URLs específicas.

Isso permite implementar provedores como:

```text
RoneProvider
ExternalApiProvider
MoontonProvider
```

sem alterar os comandos do Telegram.

## Persistência

Os arquivos runtime são armazenados em `DATA_DIR`:

- `sessions.json`: sessões autenticadas, com JWT criptografado com AES-256-GCM;
- `registrations.json`: cadastros pendentes, com expiração de 15 minutos;
- `matches.json`: screenshots classificados e partidas verificadas;
- `questions.json`: perguntas para evolução do conhecimento.

As escritas usam fila por arquivo, atualização read-modify-write serializada e arquivo temporário seguido de `rename`, evitando corrupção e perda por concorrência. JSON corrompido é colocado em quarentena antes da recuperação.

A evolução recomendada continua sendo migrar esse estado para SQLite em volume persistente ou Postgres.

## Segurança

Nunca versionar:

- `.env`
- `sessions.json`
- `registrations.json`
- `matches.json`
- `questions.json`
- screenshots
- BOT_TOKEN
- SESSION_ENCRYPTION_KEY
- JWTs
- códigos de verificação
- credenciais de APIs externas

O cadastro aceita Role ID, Zone ID e código somente no privado. No grupo, screenshots só são processados com `#print` ou em resposta a uma mensagem do bot.

Após o OCR, o Battle ID é usado para confirmar a partida na API. Quando confirmada, os dados da API substituem K/D/A, resultado, MVP, herói e pontuação lidos pelo OCR.

## Módulos

- `src/index.js`: orquestração e handlers do Telegram;
- `src/roneApi.js`: cliente Rone, autenticação e verificação de Battle ID;
- `src/ocr.js`: parser OCR puro e matching de nick;
- `src/screenshotStats.js`: download, preprocessamento, OCR e persistência de screenshots;
- `src/render.js`: renderização de ranking e estatísticas;
- `src/storage/jsonStore.js`: persistência JSON atômica/serializada.

## Deploy

`src/index.js` utiliza polling e pressupõe um processo Node.js persistente, como Railway.

O antigo stub experimental de webhook/Vercel foi removido para evitar duas implementações divergentes.
