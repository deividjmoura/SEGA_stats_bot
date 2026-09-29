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
- `/ranking` — ranking do clã
- `/stats` — estatísticas do jogador
- `/ajuda` — mostra os comandos disponíveis

## Stack

- Node.js 20+
- Telegraf
- Vercel Functions
- Webhook do Telegram

## Deploy na Vercel

O bot usa **webhook**, não polling. Isso é importante porque a Vercel executa funções sob demanda, enquanto o código local de desenvolvimento pode usar polling.

1. Importe este repositório na Vercel.
2. Configure estas variáveis de ambiente no projeto:
   - `BOT_TOKEN` — token recebido do BotFather.
   - `TELEGRAM_WEBHOOK_SECRET` — uma string aleatória para proteger o webhook.
   - `TELEGRAM_SETUP_SECRET` — outra string aleatória, usada somente uma vez para configurar o webhook.
3. Faça o deploy.
4. Abra no navegador:
   `https://SEU-DOMINIO.vercel.app/api/telegram?setup=SEU_TELEGRAM_SETUP_SECRET`
5. A resposta deve ser `Webhook configurado.`.
6. No Telegram, abra o bot e envie `/start`.

A URL de produção da Vercel é detectada automaticamente por `VERCEL_URL`.

### Segurança

Nunca coloque `BOT_TOKEN` no código ou no GitHub. O token deve ficar somente nas variáveis de ambiente da Vercel.

O `TELEGRAM_WEBHOOK_SECRET` é enviado pelo Telegram no header do webhook e é validado antes de processar a atualização.

## Desenvolvimento local

Para testar a lógica localmente:

```bash
npm install
npm start
```

A função da Vercel fica em `api/telegram.js`. O arquivo `src/index.js` mantém uma versão de polling para desenvolvimento local.
