# 🎮 SEGA Stats Bot

Bot do clã **SEGA** para Telegram + Mobile Legends: Bang Bang.

O projeto nasceu para centralizar estatísticas dos jogadores do clã, permitindo que cada membro vincule voluntariamente sua conta do MLBB e consulte seus dados pelo Telegram.

> **Status:** 🟡 Em desenvolvimento  
> **Objetivo atual:** encontrar uma fonte de dados de MLBB estável e autorizada para substituir ou complementar a integração comunitária atual.

## ✨ O que o bot pretende oferecer

- 🔗 Vinculação do jogador do MLBB ao Telegram
- 🔐 Verificação de propriedade da conta usando Role ID + Zone ID + código enviado ao correio interno do jogo
- 📊 Estatísticas individuais
- ⚔️ Histórico e desempenho em partidas
- 🏆 Ranking interno do clã
- 🛡️ Estatísticas por rota e herói
- 👥 Comparação entre jogadores
- 📈 Evolução e indicadores do clã

A autenticação já está implementada. O principal ponto em investigação é a disponibilidade e estabilidade dos dados de estatísticas e histórico de partidas.

## 🧭 Como funciona hoje

Fluxo atual de vinculação:

```text
Telegram
   │
   ├── Role ID
   ├── Zone ID
   │
   ▼
SEGA Stats Bot
   │
   ├── solicita código de verificação
   │
   ▼
Correio interno do Mobile Legends
   │
   ├── jogador informa o código no Telegram
   │
   ▼
API comunitária / Rone Arena
   │
   ├── autenticação
   ├── perfil
   └── estatísticas / temporadas / partidas
   │
   ▼
SEGA Stats Bot
```

O jogador não fornece senha da conta ao bot.

## 🔎 Integração de dados

A implementação atual utiliza a API comunitária da **Rone Arena** como fonte de dados.

Endpoints utilizados pelo projeto:

- `POST /user/auth/send-vc`
- `POST /user/auth/login`
- `GET /user/info`
- `GET /user/stats`
- `GET /user/season`
- `GET /user/matches`

Alguns endpoints de dados do usuário são considerados legados/deprecated pela própria evolução do serviço. Por isso, o projeto não deve ficar permanentemente acoplado a um único provedor.

### Estratégia planejada

A camada de dados será isolada para permitir diferentes provedores:

```text
                    SEGA Stats Bot
                           │
                    Data Provider
                           │
             ┌─────────────┼─────────────┐
             ▼             ▼             ▼
          Rone/API     API externa    MOONTON
          atual        compatível     oficial
             │             │             │
             └─────────────┼─────────────┘
                           ▼
                    Dados normalizados
                           │
                           ▼
                    Telegram / Ranking
```

O objetivo é poder trocar a fonte de dados sem reescrever a lógica do bot.

## 🔐 Privacidade e segurança

- O bot não solicita senha do Mobile Legends.
- O vínculo é iniciado pelo próprio jogador.
- O jogador fornece Role ID e Zone ID.
- O código de verificação é enviado pelo sistema do jogo.
- Tokens de sessão são armazenados criptografados com uma `SESSION_ENCRYPTION_KEY` própria, separada do `BOT_TOKEN`.
- Segredos como `BOT_TOKEN` e `SESSION_ENCRYPTION_KEY` devem permanecer somente em variáveis de ambiente.
- Dados de autenticação não devem ser commitados no Git.
- Role ID, Zone ID e código de verificação são aceitos somente no chat privado.
- No grupo, imagens só são processadas quando têm a legenda `#print` ou respondem a uma mensagem do bot.
- Prints classificados como desconhecidos são descartados; prints processados podem conter nicks de outros jogadores visíveis na imagem.
- O OCR é usado para localizar/validar a tela e o Battle ID; depois da confirmação, K/D/A, resultado, MVP, herói e pontuação vêm da API de partidas como fonte de verdade.
- Dados de OCR e screenshots têm retenção padrão de 90 dias e são limpos na inicialização; ajuste com `SCREENSHOT_RETENTION_DAYS` se necessário.
- O texto OCR armazenado é limitado a 2500 caracteres por print.
- Planejamos migrar esse armazenamento para banco de dados.

**Importante:** qualquer integração oficial futura deverá respeitar os termos, requisitos técnicos, privacidade e regras de acesso da MOONTON.

## 🤖 Comandos

| Comando | Função |
|---|---|
| `/start` | Abre o menu principal |
| `/cadastrar` | Inicia o vínculo do jogador |
| `/stats` | Consulta as estatísticas do jogador autenticado |
| `/ranking` | Exibe o ranking dos jogadores vinculados |
| `/clan` | Painel do clã |
| `/ajuda` | Lista os comandos |
| `/cancelar` | Cancela o cadastro atual |
| `/lore` | Conteúdo temático do clã |
| `/menu` | Abre novamente o menu |

## 🧱 Estrutura

```text
SEGA_stats_bot/
├── src/
│   ├── index.js          # Orquestração do bot e handlers
│   ├── ocr.js            # Parser OCR e funções puras de reconhecimento
│   ├── screenshotStats.js # Download, OCR e armazenamento de screenshots
│   ├── storage/
│   │   └── jsonStore.js  # Escrita JSON atômica e serializada
│   └── ...

│
├── docs/
│   ├── ARCHITECTURE.md   # Arquitetura e responsabilidades
│   └── INTEGRATION.md    # Estratégia de provedores e integração
│
├── .env.example
├── .gitignore
├── package.json
└── README.md
```

## 🛠️ Stack

- **Node.js 20.9+**
- **Telegraf 4**
- **Telegram Bot API**
- **Fetch nativo do Node.js**
- **AES-256-GCM** para armazenamento local dos tokens de sessão
- **Rone Arena API** como integração comunitária atual

## 🚀 Desenvolvimento local

### 1. Clonar

```bash
git clone https://github.com/deividjmoura/SEGA_stats_bot.git
cd SEGA_stats_bot
```

### 2. Instalar dependências

```bash
npm install
```

### 3. Configurar ambiente

```bash
cp .env.example .env
```

Preencha:

```env
BOT_TOKEN=seu_token_do_botfather
SESSION_ENCRYPTION_KEY=uma_chave_secreta_propria_e_estavel
```

> **Importante:** `SESSION_ENCRYPTION_KEY` é obrigatória. Gere uma chave aleatória forte e mantenha-a estável no Railway. Ela não deve ser derivada do `BOT_TOKEN`.
>
> Para migrar sessões antigas que foram criptografadas com o `BOT_TOKEN`, defina temporariamente `SESSION_LEGACY_KEY` com o valor antigo. Após a primeira inicialização bem-sucedida, as sessões são regravadas com `SESSION_ENCRYPTION_KEY` e a variável legada pode ser removida.

### 4. Executar

```bash
npm start
```

Para desenvolvimento com reinício automático:

```bash
npm run dev
```

## ☁️ Deploy

A implementação de produção em `src/index.js` utiliza **polling** e é adequada para um processo Node.js persistente, como Railway ou outro serviço equivalente.

O antigo stub experimental de webhook/Vercel foi removido para evitar duas implementações divergentes do bot. O serviço de produção atual é o processo de polling no Railway.

### Persistência obrigatória no Railway

O bot grava cadastros, sessões, prints, perguntas e estatísticas derivadas em arquivos dentro de `DATA_DIR`.
As escritas dos JSONs runtime são serializadas e feitas de forma atômica (arquivo temporário + rename), evitando corrupção por escrita concorrente ou interrupção no meio da gravação.
Em Railway, esses arquivos só sobrevivem a redeploys se o serviço tiver um **Volume** anexado.

Configuração recomendada:
- anexe um Railway Volume ao serviço do bot;
- use mount path `/app/data` (compatível com o fallback local `./data`) ou `/data`;
- o Railway fornece automaticamente `RAILWAY_VOLUME_MOUNT_PATH`, e o bot passa a gravar tudo nesse volume;
- opcionalmente, defina `DATA_DIR=/data` se quiser controlar explicitamente o caminho.

Sem Volume, um redeploy pode apagar `sessions.json`, `registrations.json`, `matches.json`, `questions.json` e as imagens salvas.

Se o deploy utilizar armazenamento persistente para as sessões, configure:

```env
SESSION_FILE=/caminho/para/data/sessions.json
```

Em ambientes efêmeros, o armazenamento local pode desaparecer quando a instância for recriada. Para uma versão de produção mais robusta, a sessão deverá migrar para um banco de dados ou outro armazenamento persistente.

## 🧪 Estado atual

### Funcionando

- [x] Bot Telegram
- [x] Menu e comandos
- [x] Cadastro por Role ID
- [x] Cadastro por Zone ID
- [x] Solicitação do código de verificação
- [x] Login com código
- [x] Validação do perfil
- [x] Persistência local das sessões
- [x] Consulta de estatísticas quando a API fornece os dados
- [x] Fallback por temporada e partidas
- [x] Ranking básico dos jogadores autenticados

### Em desenvolvimento

- [ ] Abstração formal da camada de dados
- [ ] Teste de provedores alternativos
- [ ] Histórico completo de partidas
- [ ] Detalhes individuais das partidas
- [ ] Estatísticas por rota
- [ ] Estatísticas por herói
- [ ] Evolução histórica do jogador
- [ ] Banco de dados para jogadores e resultados
- [ ] Integração oficial ou autorizada com a MOONTON, caso disponível
- [ ] Testes automatizados da camada de dados

## 🤝 Busca por integração oficial

Estamos investigando a possibilidade de utilizar uma API ou programa oficial da MOONTON para acesso autorizado a estatísticas de jogadores e histórico de partidas.

O objetivo não é contornar mecanismos de segurança ou acessar dados de terceiros sem autorização.

A proposta é construir uma integração em que:

1. o próprio jogador solicita o vínculo;
2. a identidade do jogador é confirmada;
3. somente os dados permitidos pela plataforma são consultados;
4. a aplicação respeita os termos e requisitos técnicos da MOONTON.

Para contexto técnico, arquitetura e estado do projeto, consulte a documentação em `docs/`.

## 📄 Documentação

- [Arquitetura](docs/ARCHITECTURE.md)
- [Estratégia de integração](docs/INTEGRATION.md)

## 👤 Projeto

**SEGA Stats Bot**  
Telegram + Mobile Legends: Bang Bang  
Desenvolvido como projeto independente para uma comunidade de jogadores no Brasil.

---

### Repositório

https://github.com/deividjmoura/SEGA_stats_bot
