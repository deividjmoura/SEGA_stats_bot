# 🎮 SEGA Stats Bot

Bot do clã **SEGA** para Telegram + Mobile Legends: Bang Bang.

## O que ele faz

- 🏆 Ranking do clã
- ⚔️ Histórico e desempenho nas partidas
- 🛡️ Herói mais jogado
- 📊 Pontuação e evolução dos membros
- 🔗 Vinculação da conta do Telegram ao jogador do MLBB (via código do correio interno)

## Comandos

| Comando      | Descrição                       |
| ------------ | ------------------------------- |
| `/start`     | Menu principal                  |
| `/cadastrar` | Vincular seu jogador do MLBB    |
| `/stats`     | Suas estatísticas               |
| `/ranking`   | Ranking do clã                  |
| `/clan`      | Painel do clã                   |
| `/lore`      | Crônicas e heróis               |
| `/cancelar`  | Cancelar o cadastro em andamento|
| `/sair`      | Desvincular sua conta           |
| `/ajuda`     | Ajuda                           |

## Stack

- Node.js 20+
- Telegraf 4
- Railway (long polling, sem custo de webhook/domínio)

---

## Deploy na Railway (plano gratuito)

1. **New Project → Deploy from GitHub repo** e selecione este repositório.
2. Em **Variables**, adicione:

   | Variável       | Obrigatória | Observação                                          |
   | -------------- | ----------- | --------------------------------------------------- |
   | `BOT_TOKEN`    | ✅          | Token do BotFather                                   |
   | `MLBB_API_URL` | ❌          | Padrão `https://arena.rone.dev/api`                  |
   | `PORT`         | ❌          | A Railway injeta sozinha                             |

3. **Settings → Deploy → Replicas = 1.**
   ⚠️ Isso é obrigatório: duas réplicas com o mesmo `BOT_TOKEN` derrubam o polling
   com erro `409: Conflict`.
4. O healthcheck usa `GET /` (já configurado em `railway.json`).

### Persistir as sessões entre deploys

O disco da Railway é **efêmero**: sem volume, todo mundo precisa se cadastrar de
novo a cada deploy. Correção gratuita:

1. No serviço → **Settings → Volumes → New Volume**.
2. Mount path: `/data`.
3. Pronto. A Railway define `RAILWAY_VOLUME_MOUNT_PATH` e o bot passa a gravar em
   `/data/sessions.json` automaticamente.

Os JWTs são gravados **criptografados** (AES-256-GCM, chave derivada do `BOT_TOKEN`).
Se você trocar o token, as sessões antigas são descartadas — isso é esperado.

### Modo webhook (opcional)

O padrão é long polling, que funciona sem domínio nenhum. Se quiser webhook:

```
USE_WEBHOOK=true
TELEGRAM_WEBHOOK_SECRET=uma-string-aleatoria
```

O bot usa `https://$RAILWAY_PUBLIC_DOMAIN/telegram/webhook` e valida o header
`x-telegram-bot-api-secret-token`.

---

## Desenvolvimento local

```bash
npm install
cp .env.example .env   # preencha BOT_TOKEN
npm run dev
```

Rodar os testes:

```bash
npm test
```

> Rode apenas **uma** instância por token. Se o bot estiver no ar na Railway,
> pause o serviço antes de rodar localmente, senão o Telegram devolve `409`.

## Estrutura

```
src/
  index.js     handlers do Telegram, healthcheck HTTP e bootstrap
  config.js    leitura e validação das variáveis de ambiente
  api.js       cliente HTTP da API do MLBB (timeout + retry, nunca lança)
  sessions.js  persistência criptografada das sessões
  stats.js     busca e normalização das estatísticas
  ui.js        textos, teclados e renderização
test/
  smoke.test.js
```

## Segurança

- O `BOT_TOKEN` nunca vai para o repositório — só para as variáveis de ambiente.
- O bot **nunca** pede senha, e-mail ou códigos de outras plataformas.
- Nomes vindos da API são escapados antes de irem para o HTML do Telegram.
