# 🤖 NOX — Integração com WhatsApp

Este diretório contém a ponte do **NOX | Clã Tenebrozos** com o WhatsApp. O projeto utiliza **Node.js**, **Baileys** e um volume persistente na Railway. A biblioteca Baileys não é uma integração oficial do WhatsApp e seu uso pode sofrer instabilidades ou restrições.

> Documentação pública e visão geral: [README principal](../README.md).

## 🏠 Grupos e limites de atuação

| Canal | Identificação | Ações permitidas |
| --- | --- | --- |
| **Geral** | `WHATSAPP_GROUP_JID` | Menu, ajuda, stats, agenda, perguntas e menções |
| **Conselho (ADMs)** | `WHATSAPP_ADMINS_GROUP_JID` | Fluxos restritos de eventos, presenças e autorizações |
| **Integrantes** | `WHATSAPP_MEMBERS_GROUP_JID` | Não recebe comandos gerais; somente ações específicas de revisão/organização previstas no código |
| **Avisos oficiais** | `WHATSAPP_ANNOUNCEMENTS_GROUP_JID` | O bot pode anunciar um novo comunicado no Geral, após confirmar o vínculo da comunidade |

Os nomes dos grupos são informativos; o serviço utiliza **identificadores internos (JIDs)** para evitar enviar mensagens ao destino errado. **Link de convite não substitui JID.** Não publique IDs reais da comunidade em arquivos públicos.

## 🎮 Comandos principais no Geral

| Comando | Uso |
| --- | --- |
| `!nox` | Menu interativo, com comandos de texto como alternativa |
| `!ajuda` | Guia completo, atualizado com funções de agenda e sugestões |
| `!stats` | Estatísticas disponíveis de jogador com cadastro verificado |
| `!cadastrar` | Encaminha para cadastro privado (Role ID, Zone ID e código de verificação) |
| `!agenda` | Próximos eventos e confirmação de presença |
| `!confirmar ID` / `!desistir ID` | Alternativa de texto para responder a eventos |
| `!sugestao` / `!conhecimento` | Envio de propostas e conhecimento, sujeito a revisão |
| `!ranking` / `!highlights` | Funcionalidades ainda em desenvolvimento |

Perguntas podem ser feitas usando `@NOX`, sem necessidade de marcar uma conta real. Marcações reais de integrantes podem iniciar uma zoeira, mas **mensagens comuns não devem disparar respostas por inatividade**.

### Recursos reservados

O Conselho tem ferramentas próprias para criar, editar e cancelar eventos, ver listas de participantes e autorizar exceções ao prazo. Os fluxos de sugestões de conhecimento possuem uma etapa de aprovação por revisor autorizado. Essas operações são verificadas por grupo e permissão, não apenas pelo texto do comando.

## 🔐 Privacidade e persistência

- O WhatsApp conectado é a conta do responsável: as respostas automáticas são assinadas como **NOX bot**.
- Conversas privadas pessoais não relacionadas à automação não devem ser processadas.
- Mensagens de cadastro são tratadas como fluxo privado iniciado explicitamente pelo jogador.
- Dados e sessões exigem um **Railway Volume** em `/app/data` (ou caminho configurado).
- A chave `WHATSAPP_SESSION_ENCRYPTION_KEY` protege os tokens de cadastro; **não a substitua durante atualizações**.
- **Não apague/recrie o volume nem force novo pareamento** ao editar textos ou reimplantar.
- Nunca comite arquivos de autenticação, tokens, números pessoais ou o conteúdo de variáveis secretas.

O nome técnico antigo de alguns recursos (serviço, volume e repositório) é mantido para preservar compatibilidade operacional. Ele **não representa o nome público do bot**, que é NOX.

## ⚙️ Configuração de ambiente

| Variável | Responsabilidade |
| --- | --- |
| `WHATSAPP_CONNECT_ENABLED` | Autoriza conexão ao WhatsApp |
| `WHATSAPP_REPLY_ENABLED` | Habilita envio de respostas |
| `WHATSAPP_GROUP_JID` | **Somente o grupo Geral** para comandos públicos |
| `WHATSAPP_ADMINS_GROUP_JID` | Grupo de gestão e comandos do Conselho |
| `WHATSAPP_MEMBERS_GROUP_JID` | Grupo de integrantes para fluxos autorizados |
| `WHATSAPP_ANNOUNCEMENTS_GROUP_JID` | Canal oficial de comunicados |
| `WHATSAPP_ANNOUNCEMENTS_ENABLED` | Habilita notificações de novos avisos |
| `WHATSAPP_ANNOUNCEMENT_MENTIONS_ENABLED` | Habilita a notificação coletiva quando validada |
| `WHATSAPP_AUTH_DIR` | Diretório persistente de autenticação |
| `WHATSAPP_DATA_DIR` | Diretório persistente de cadastros e dados |
| `WHATSAPP_SESSION_ENCRYPTION_KEY` | Segredo de criptografia, obrigatório |
| `WHATSAPP_SEASON_STATS_ENABLED` | Complemento opcional de estatísticas por temporada |

Os valores reais ficam **apenas no ambiente Railway**, nunca nesta documentação. Na migração de grupos, valide previamente IDs, permissões e vínculo com a mesma comunidade. Os switches de resposta/aviso só devem ser ativados após a checagem.

## 🧪 Testes e desenvolvimento

Requer **Node.js 20.9+**:

```bash
cd whatsapp-service
npm install
npm test
```

Os testes não enviam mensagens reais. Depois de um deploy, valide no próprio WhatsApp as mensagens do Geral, a ausência de comandos públicos nos outros grupos e o recebimento de avisos oficiais.

**Política de mudança:** priorizar alterações pequenas, executar testes e verificar a conexão após o deploy. Não alterar lógica de grupos, segredos ou cadastros ao trocar apenas nome/textos.
