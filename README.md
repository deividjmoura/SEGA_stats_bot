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
| `/cadastrar` | Vincular seu jogador (1ª vez)   |
| `/entrar`    | Reconectar sem redigitar IDs    |
| `/stats`     | Suas estatísticas               |
| `/ranking`   | Ranking do clã                  |
| `/clan`      | Painel do clã                   |
| `/lore`      | Crônicas e heróis               |
| `/cancelar`  | Cancelar o cadastro em andamento|
| `/sair`      | Desvincular sua conta           |
| `/ajuda`     | Ajuda                           |
| `/diag`      | Diagnóstico da API (admin)      |

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
   | `MLBB_API_URL` | ❌          | Lista separada por vírgula; há failover embutido     |
   | `ADMIN_TELEGRAM_ID` | ❌     | Restringe o `/diag` a você                           |
   | `PORT`         | ❌          | A Railway injeta sozinha                             |

3. **Settings → Deploy → Replicas = 1.**
   ⚠️ Isso é obrigatório: duas réplicas com o mesmo `BOT_TOKEN` derrubam o polling
   com erro `409: Conflict`.
4. O healthcheck usa `GET /` (já configurado em `railway.json`).

### ⚠️ Persistir os cadastros entre deploys (OBRIGATÓRIO)

O disco da Railway é **efêmero**: sem volume, todo mundo precisa se cadastrar de
novo a cada deploy. Correção gratuita:

1. No serviço → **Settings → Volumes → New Volume**.
2. Mount path: `/data`.
3. Pronto. A Railway define `RAILWAY_VOLUME_MOUNT_PATH` e o bot passa a gravar em
   `/data/sessions.json` automaticamente.

No boot o bot informa no log se o volume foi detectado, e o `/diag` mostra o mesmo.

Os JWTs são gravados **criptografados** (AES-256-GCM, chave derivada do `BOT_TOKEN`).
Se você trocar o token, as sessões antigas são descartadas — isso é esperado.

**O JWT do MLBB expira sozinho depois de um tempo** — isso vem da Moonton e não dá
para evitar. Mas o bot guarda o Role ID e o Zone ID em separado, então quando isso
acontece o jogador usa `/entrar` e só precisa digitar o código novo: nunca mais
precisa redigitar os IDs nem refazer o cadastro.

### Sobre a API (Rone Arena)

O bot fala com a [Rone Arena API](https://arena.rone.dev), gratuita e comunitária.
Dois detalhes que quebram a integração se forem ignorados:

- Ela fica atrás de um WAF que **rejeita clientes sem cara de navegador**. O bot
  envia `User-Agent`, `Accept`, `Origin` e `Referer` reais — sem isso a resposta
  vem em HTML e o JSON.parse falha.
- O parâmetro de idioma aceita só `pt` (não `pt_BR`), senão a API devolve 422.

Há **failover automático** entre `arena.rone.dev` e `arena-hv.fastapicloud.dev`.

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
