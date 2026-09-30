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

Isso funciona para o protótipo, mas cria acoplamento entre o bot e a API externa.

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

## Sessões

Atualmente as sessões são armazenadas localmente em `sessions.json`.

O JWT é criptografado com AES-256-GCM antes de ser gravado.

Para produção, a evolução recomendada é mover as sessões para armazenamento persistente apropriado, mantendo os tokens protegidos.

## Segurança

Nunca versionar:

- `.env`
- `sessions.json`
- BOT_TOKEN
- JWTs
- códigos de verificação
- credenciais de APIs externas

O jogador deve fornecer somente as informações necessárias ao fluxo autorizado.

## Deploy

`src/index.js` utiliza polling e pressupõe um processo Node.js persistente.

`api/telegram.js` é uma implementação separada de webhook para ambientes serverless e deve ser tratada como experimental até compartilhar a mesma lógica e persistência da implementação principal.
