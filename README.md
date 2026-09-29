# 🎮 CEGA Stats Bot

Bot oficial do clã **CEGA** para Telegram + Mobile Legends: Bang Bang.

## O que ele vai fazer

- 🏆 Ranking do clã
- ⚔️ Histórico e desempenho nas partidas
- 🛡️ Estatísticas por rota
- 📊 Pontuação e evolução dos membros
- 👥 Comparação de desempenho entre jogadores
- 🔗 Vinculação da conta do Telegram ao jogador do MLBB

## Comandos iniciais

- `/start` — apresenta o bot e mostra as opções
- `/cadastrar` — inicia o cadastro do jogador
- `/ajuda` — mostra os comandos disponíveis

## Stack

- Node.js
- Telegraf
- API de dados do Mobile Legends

## Configuração

Crie um arquivo `.env` a partir do `.env.example` e defina:

```env
BOT_TOKEN=seu_token_do_bot
```

Nunca publique o token do BotFather no repositório.

## Executar localmente

```bash
npm install
npm start
```

O bot usa long polling, então não precisa de servidor web nesta primeira versão.
