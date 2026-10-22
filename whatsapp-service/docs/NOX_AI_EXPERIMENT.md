# NOX — experimento de IA conversacional + busca web opcional

**Data:** 2026-10-16  
**Branch experimental:** `feat/nox-ai-collab-20261016`  
**Base produtiva intocada:** `feat/nox-agenda-sugestoes-20261015`  
**Coordenação entre agentes:** https://github.com/deividjmoura/SEGA_stats_bot/issues/22

## Proposta e status

Adicionar conversas contextuais sobre Mobile Legends: Bang Bang ao NOX do grupo Geral quando o jogador invocar **explicitamente** `@NOX`. Consultar a base MLBB existente e o conhecimento revisado antes da IA; respostas curtas no estilo do bot; pesquisar fontes web quando for realmente necessário. O objetivo é preparar o código da branch para **testes isolados no Railway**, nunca mudar o serviço ativo sem aprovação.

**Implementado nesta branch (código sujeito a testes):**

- Módulo `src/noxAiAssistant.js`: adaptador HTTP OpenAI-compatible para OpenRouter, Groq ou OpenAI, desligado por padrão.
- Módulo `src/noxAiSearch.js`: busca Brave opcional só para perguntas temporalmente relevantes, em fontes HTTPS permitidas.
- Integração em `src/index.js` nos caminhos já existentes de perguntas do Geral e auto-chat do proprietário.
- Testes de unidade `src/noxAiAssistant.test.js`; não prometem que o provedor real ou o WhatsApp foi testado.
- Histórico de até 3 turnos (6 mensagens) por **par grupo+jogador** em memória de processo; expira em 15 minutos e não é persistido no volume.
- A chave de identificação interna do jogador **não é enviada** na requisição da IA; o modelo recebe só as perguntas explicitamente dirigidas ao NOX, o histórico resumido **daquele jogador**, contexto MLBB e dicas relevantes.
- Limites: 15 segundos mínimos entre chamadas por jogador; 12/dia por jogador; 150/dia globais (ajustáveis por variáveis); máximo 2 chamadas simultâneas; timeout 12 segundos (máximo 20).
- Erros do modelo ou da busca retornam ao fluxo tradicional; agenda, cadastros, presenças, revisões e demais comandos não dependem da IA.
- A IA não controla ferramentas, WhatsApp nem base de conhecimento. **Jamais aprova conteúdo, edita arquivos ou altera dados a pedido da conversa.**
- Pesquisa externa não entra automaticamente na base aprovada. Links mostrados ao usuário somente quando vierem de resultados HTTPS aceitos.

## Variáveis do serviço (todos os valores são configurações, não credenciais)

| Nome | Padrão | Observação |
|---|---|---|
| `NOX_AI_ENABLED` | `false` | Só `true` habilita o fluxo |
| `NOX_AI_PROVIDER` | `openrouter` | `openrouter`, `groq` ou `openai` |
| `NOX_AI_API_KEY` | ausente | **Segredo** armazenado apenas no Railway, nunca aqui |
| `NOX_AI_MODEL` | ausente | ID exato de modelo permitido no provedor escolhido |
| `NOX_AI_COOLDOWN_MS` | `15000` | Entre chamadas do mesmo jogador; limite de segurança 1000–120000 |
| `NOX_AI_DAILY_PER_PLAYER` | `12` | 1–100 por dia UTC |
| `NOX_AI_DAILY_GLOBAL` | `150` | 1–5000 por dia UTC |
| `NOX_AI_TIMEOUT_MS` | `12000` | 3000–20000 |
| `NOX_AI_WEB_SEARCH_ENABLED` | `false` | Habilita pesquisa só se a chave estiver presente |
| `NOX_AI_SEARCH_API_KEY` | ausente | **Segredo** Brave Search API |
| `NOX_AI_SEARCH_DOMAINS` | lista curada no módulo | Lista separada por vírgula; somente domínios HTTPS aprovados |

Não configurar `NOX_AI_ENABLED=true` no serviço atual durante desenvolvimento. Provedores externos podem cobrar pelo consumo; limites em memória reiniciam no reboot, portanto **não** são controle financeiro absoluto em produção com múltiplas réplicas.

## Exemplos de comportamento

| Entrada | Quando IA habilitada | Quando desabilitada/falha |
|---|---|---|
| `@NOX quais informações você tem sobre Miya?` | Resposta conversacional enriquecida com dados locais | Resposta atual da base/revisor ou zueira `!sugestao` |
| `@NOX e a build dela?` (mesmo jogador após a pergunta acima) | Contexto da Miya recuperado por até 15min | Caminho tradicional |
| `@NOX quem countera Harley?` | Base MLBB atual preservada em prioridade | Base MLBB atual |
| `@NOX Miya levou nerf no patch recente?` | IA; pesquisa Brave apenas se ativada e houver fontes | Conhecimento local/aviso de desconhecimento |
| Conversa normal sem `@NOX` ou `!` | **Sem resposta** | Sem resposta |
| Alguém marca outro jogador | Continua zueira habitual; IA não interfere | Igual |

O auto-chat do proprietário pode ter perguntas explícitas em formatos já aceitos pelo código antigo. Chats privados de terceiros continuam fora de escopo.

## Teste no celular, sem instalar nada (Puter.js)

**Novo em 2026-10-16:** página estática responsiva em `whatsapp-service/lab/index.html`, no mesmo branch experimental. Essa página **não importa Baileys, não acessa chats ou dados do clã e não controla Railway**.

- **Modo Demonstração:** respostas determinísticas simuladas, identificadas como simulação; não exige API nem conta e não consulta a internet.
- **Modo IA de verdade:** Puter.js carrega um modelo através da conta **do usuário que fizer login**, com `puter.ai.chat` no próprio navegador. **Não é uma integração de Puter no backend do NOX**; é uma prova de conceito visual e conversacional independente. O modelo selecionado no protótipo é `gpt-5.4-nano`; não há chave de API embutida.
- **Franquia gratuita:** Puter oferece uma cota mensal inicial, sujeita a limites e mudanças. A gratuidade não é ilimitada; quando a cota acabar, o usuário deve **parar sem aceitar pagamento**. Puter recebe o conteúdo das perguntas enviadas enquanto IA real estiver ativa; **não insira informações privadas**. Consulte https://docs.puter.com/user-pays-model/ e https://docs.puter.com/AI/chat/.
- **Hospedagem provisória:** o repositório de código é público e ainda não tem GitHub Pages habilitado. O HTML pode ser visualizado pelo CDN externo raw.githack.com, que serve o arquivo com MIME de HTML e **pode exibir uma página de confirmação anti-phishing**. Não há garantia de disponibilidade desse CDN nem teste de login Puter com navegador móvel nesta sessão. Se o CDN não funcionar, publicar pelo GitHub Pages exige ativação/configuração pelo titular ou credenciais administrativas específicas.
- **Link para o protótipo (commit fixo, independente do deploy produtivo):** https://raw.githack.com/deividjmoura/SEGA_stats_bot/31bb384e1972fade1c9d08945ae1282eb6ce4429/whatsapp-service/lab/index.html
- **Acompanhamento no GitHub:** [Actions 38903967313](https://github.com/deividjmoura/SEGA_stats_bot/actions/runs/38903967313) concluiu com `success`, incluindo `src/noxMobileLab.test.js`. Tests simularam DOM e respostas do Puter, **não comprovaram login, limite gratuito ou disponibilidade do modelo real**.
- **Próximo passo do titular:** abrir a página no celular, selecionar **Demonstração** e testar Miya/Harley. Se a página abrir e quiser IA de verdade, selecionar o segundo botão e entrar na conta Puter. **Não colocar cartão ou aceitar cobrança**; informar se aparecer erro, login bloqueado ou popup impedido.

## Laboratório sem WhatsApp — primeiro teste seguro

Criado em 2026-10-16: `src/noxAiPlayground.js`. A ferramenta **não carrega Baileys, não lê as conversas e não conecta o número atual**; conversa diretamente com `noxAiAssistant.js`.

### Modo simulado, sem chave e sem custo

No terminal, usando **fish** no CachyOS:

```fish
git fetch origin
git switch feat/nox-ai-collab-20261016
cd whatsapp-service
node src/noxAiPlayground.js --self-test
node src/noxAiPlayground.js --demo
```

No `--demo`, teste `Quais informações você tem sobre Miya?`, depois `E a build dela?`. Digite `/trocar` para alternar entre jogadores A e B, `/ajuda` para ver todos os comandos e `/sair` para encerrar. **Respostas do demo são um simulador offline, não vêm de modelo generativo**, por isso não avaliam qualidade factual nem humor de uma IA real.

### IA de verdade, ainda sem WhatsApp

Depois de escolher provedor e modelo (Groq, OpenRouter ou OpenAI) e obter uma chave própria, use **somente no seu terminal privado**, nunca mande segredos ao GitHub/WhatsApp/ChatGPT:

```fish
set -gx NOX_AI_PROVIDER groq
set -gx NOX_AI_MODEL modelo-exato-disponivel-no-provedor
read --silent --prompt-str 'Chave da API: ' NOX_AI_API_KEY
set -gx NOX_AI_API_KEY $NOX_AI_API_KEY
node src/noxAiPlayground.js --live
set -e NOX_AI_API_KEY
```

`NOX_AI_MODEL` é um exemplo: substituir pelo identificador exato do modelo contratado/disponível, antes de executar. Se não tiver chave ou quiser evitar cobrança, **use somente `--demo`**. Para pesquisa web adicional (custo/serviço separados), precisa `NOX_AI_WEB_SEARCH_ENABLED=true` e `NOX_AI_SEARCH_API_KEY`; deixe desativada nos primeiros testes.

Para inspecionar testes automatizados da ferramenta, execute `node --test src/noxAiPlayground.test.js` ou `npm test` dentro de `whatsapp-service`.

**Limitação:** o laboratório usa apenas fatos demonstrativos no modo offline. No modo live consulta a base MLBB pública, mas **não acessa o volume produtivo de propostas aprovadas do clã**, portanto não valida dados privados da produção.

## Fluxo de testes recomendado, sem tocar produção

1. Executar localmente `cd whatsapp-service && npm test` com Node compatível e dependências do repo. O CI do PR draft também pode validar.
2. Sem chave de IA, conferir `NOX_AI_ENABLED` ausente/false: comportamento da branch deve ser equivalente à produção.
3. Injetar chave **somente em um serviço Railway de teste isolado** com sessão/número e volume próprios. Não conectar dois serviços Baileys ao mesmo estado de autenticação simultaneamente.
4. Usar o grupo de teste apropriado; validar `@NOX Miya`, contexto por jogador, erro de API, zueira de menção, limite, segurança e ausência de respostas no Avisos/Integrantes.
5. Validar custos, limites diários e serviços/versões, sem colocar o token em mensagens/logs.
6. Antes de qualquer produção, comparar branch experimental com branch produtiva, revisar PRs e exigir autorização humana explícita.

## Retorno seguro (rollback)

- O serviço produtivo continua rastreando `feat/nox-agenda-sugestoes-20261015`, não esta branch.
- Em um **serviço isolado de teste**, basta desativar `NOX_AI_ENABLED` para restaurar as respostas tradicionais; se necessário implantar a mesma revisão base do serviço original no ambiente de teste.
- **Não alterar a branch em produção nem dados persistidos** para testar a IA. Não copiar os arquivos de autenticação do volume produtivo para serviço de teste.
- Se implantação experimental for autorizada no futuro, anotar commit exato e plano de rollback antes de trocar qualquer setting.

## Limitações e pontos de segurança

- Busca web é via Brave API e fontes controladas; não é navegação geral da internet, nem garante que todas as fontes estejam corretas/atuais.
- Menus melhores para WhatsApp estão sendo pesquisados **independentemente pelo Agente B**. Não há troca de Baileys ou Cloud API nesta implementação. O Agente B deve entregar POC isolada ou decisão técnica; consultar Issue #22.
- Os testes simulados não confirmam a compatibilidade dos menus com todos os aplicativos WhatsApp.
- Usar conexão HTTPS, segredos no gerenciador de ambiente, não habilitar debug de payload.
