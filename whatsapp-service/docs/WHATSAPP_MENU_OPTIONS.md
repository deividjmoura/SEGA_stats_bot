# Alternativas aos menus do WhatsApp — NOX

**Data da avaliação:** 2026-10-16  
**Escopo:** descobrir se há uma alternativa mais confiável aos menus clicáveis atuais, sem alterar a conexão do WhatsApp, a branch funcional, o serviço Railway ou o fluxo de IA do outro agente.  
**Decisão:** **não migrar o transporte de menus nesta rodada**. Documentar e manter a implementação atual com fallback textual.

## Resumo executivo

O NOX já envia menus de seleção nativos (single_select / native flow) por Baileys. O código atual também limita os destinos do envio e o projeto conserva comandos de texto como alternativa quando o cliente não mostra o menu.

A API oficial da Meta suporta mensagens interativas, incluindo botões de resposta e listas, mas isso **não torna esses recursos um substituto para os menus do grupo atual**. A Cloud API de conversas individuais e a Groups API são capacidades distintas, com requisitos e disponibilidade diferentes. A referência técnica da Groups API consultada descreve elegibilidade comercial, limite de até 8 participantes e lista **mensagens interativas entre os tipos não suportados**. A página oficial da Groups API foi listada entre as fontes, mas retornou bloqueio por limite de acesso automatizado durante esta verificação; por isso, este detalhe está identificado abaixo como dependente de confirmação direta na matriz oficial antes de uma migração.

Assim, criar agora um módulo de transporte Cloud API seria antecipar uma integração que não atende ao requisito mais importante: menus clicáveis no grupo existente. Nenhum módulo alternativo foi criado nesta rodada.

## O que existe hoje

Verificado na branch base feat/nox-agenda-sugestoes-20261015, commit 6d06ce8ada4c21420427e1011d8608bb074cfeb8:

- whatsapp-service/package.json fixa @whiskeysockets/baileys@7.0.0-rc14.
- whatsapp-service/src/clickableMenuPrototype.js constrói mensagens interactiveMessage com botão single_select, pagina opções e limita a lista enviada a no máximo 10 linhas.
- sendNoxInteractiveMenu() aceita conversa privada compatível ou um grupo presente na allowlist recebida pelo chamador; rejeita destino não autorizado e falha se o transporte Baileys não estiver disponível.
- O envio usa relayMessage() com metadados native-flow adicionados explicitamente. Esse detalhe depende do protocolo usado pelo cliente WhatsApp Web e não é uma interface pública/estável da Cloud API.
- whatsapp-service/README.md descreve Baileys como uma biblioteca **não oficial**, registra risco de instabilidade e orienta a manter os comandos textuais de fallback. O fluxo da agenda também instrui os membros a usar !confirmar ID ou !desistir ID se o menu não abrir.
- O projeto atual não possui a configuração de uma Cloud API visível na dependência local do serviço. Isso não prova que nenhuma configuração exista fora do repositório; significa apenas que ela não faz parte da implementação examinada.

Referências de código:
- [Menu clicável atual](https://github.com/deividjmoura/SEGA_stats_bot/blob/6d06ce8ada4c21420427e1011d8608bb074cfeb8/whatsapp-service/src/clickableMenuPrototype.js)
- [Testes dos menus atuais](https://github.com/deividjmoura/SEGA_stats_bot/blob/6d06ce8ada4c21420427e1011d8608bb074cfeb8/whatsapp-service/src/clickableMenuPrototype.test.js)
- [README do serviço WhatsApp](https://github.com/deividjmoura/SEGA_stats_bot/blob/6d06ce8ada4c21420427e1011d8608bb074cfeb8/whatsapp-service/README.md)
- [Repositório Baileys](https://github.com/WhiskeySockets/Baileys)

## Alternativas avaliadas

| Alternativa | Vantagem | Limitação para o NOX | Decisão |
|---|---|---|---|
| Manter Baileys + native flow + texto de fallback | Não troca sessão, número, grupo ou arquitetura. Já funciona no fluxo atual. | Protocolo não oficial; mudanças no WhatsApp/cliente podem afetar os menus. Compatibilidade por cliente precisa de teste real. | **Manter nesta rodada.** |
| WhatsApp Cloud API oficial com botões/listas | Contrato de API documentado; mensagens interativas oficiais e rastreamento de status por webhooks. | Exige configuração de negócio/WABA, número, permissões e tokens; não é um substituto transparente para a sessão Baileys. O suporte de mensagens interativas da API padrão não deve ser confundido com suporte em grupos. | Não integrar agora. |
| Cloud API Groups API | Possui operações oficiais próprias para grupos e mensagens. | É uma modalidade com elegibilidade e limites próprios. A referência técnica da Groups API indica até 8 participantes e não suporta mensagens interativas; não serve para substituir os menus atuais do grupo do clã. Grupos/coexistência também possuem limitações específicas. | **Não serve ao requisito atual.** |
| Outra biblioteca que automatiza WhatsApp Web (por exemplo, whatsapp-web.js ou WPPConnect) | API de desenvolvimento diferente, que pode ser mais conveniente em alguns projetos. | Continua baseada em automação/protocolo de cliente, exige migração e pareamento/testes e não transforma a integração em API oficial. Não há evidência nesta avaliação de que resolva a limitação específica sem introduzir outros riscos. | Não trocar de biblioteca sem um defeito reproduzível e um teste comparativo. |
| Menu web externo aberto por link | Interface própria com controles previsíveis em Android, iOS e navegador. Não depende de renderizar native flow no cliente. | Sai do fluxo de menu dentro do WhatsApp; exige hospedagem, validação de identidade/autorização, links seguros e uma decisão de produto. | Alternativa futura caso a experiência rica seja mais importante que permanecer dentro do grupo. |

## Por que a Cloud API não é uma troca direta

A coleção oficial da Meta descreve a Cloud API como a plataforma oficial de mensagens comerciais e exige um portfólio empresarial Meta, uma WhatsApp Business Account (WABA) e número comercial. A autorização envolve permissões como whatsapp_business_messaging e whatsapp_business_management. Mensagens interativas — botões de resposta e listas — têm endpoints e estruturas documentados.

A Groups API é separada das mensagens interativas padrão. A referência técnica de desenvolvedor consultada apresenta requisitos próprios, incluindo elegibilidade comercial, gestão de grupos por API e limite de 8 participantes; ela lista chamadas, mensagens temporárias/view-once, comércio/auth e **mensagens interativas** entre os tipos não suportados. A documentação oficial em developers.facebook.com consta nas fontes, mas foi bloqueada por limite de acesso automatizado ao abrir diretamente nesta sessão; trate a lista exata de capacidades como uma premissa de pesquisa a reconfirmar no portal oficial e com a conta elegível antes de qualquer migração.

Há uma segunda restrição relevante: a documentação técnica de coexistência do WhatsApp Business App publicada por um provedor da plataforma informa que grupos não são sincronizados nem disponibilizados na API durante a coexistência. Isso torna a coexistência um caminho inadequado para preservar o comportamento atual dos grupos do NOX, independentemente dos menus. Fonte: [WhatsApp Business App Coexistence — 8x8 Developer Portal](https://developer.8x8.com/connect/docs/whatsapp/whatsapp-business-app-coexistence/). Como se trata de documentação técnica do provedor, não substitui confirmação do fluxo de onboarding aplicável à conta do titular.

Ainda que os requisitos comerciais fossem atendidos, a migração para Cloud API não converteria automaticamente o grupo do clã nem os fluxos de agenda/RSVP atuais. A coexistência com o aplicativo Business tem elegibilidade e limitações próprias e não deve ser confundida com manter a sessão pessoal conectada via Baileys. Este trabalho não solicitou nem iniciou onboarding, troca de número, criação de grupos ou pareamento.

## Recomendação técnica

1. **Manter a implementação atual, sem deploy ou alteração de dependência.**
2. Preservar sempre o comando textual equivalente junto dos menus clicáveis. Para agenda, manter !agenda, !confirmar ID e !desistir ID; para outros menus, orientar explicitamente qual comando digitar.
3. Validar manualmente um conjunto representativo de clientes: WhatsApp Android, iOS e WhatsApp Web/Desktop. Registar versão aproximada do cliente, se a lista abriu, se a resposta clicada chegou e se o fallback textual concluiu a mesma ação. Não presumir compatibilidade universal apenas porque o payload foi enviado.
4. Manter a autorização do destino antes do envio do menu. O clique é apenas uma entrada do usuário, não uma permissão administrativa: as verificações de identidade/permissão continuam necessárias ao executar cada ação.
5. Se falhas de renderização ocorrerem de forma repetida, primeiro coletar casos reproduzíveis e reforçar o fallback. Um menu web por link é a alternativa isolada mais plausível caso a prioridade passe a ser uma UI rica e previsível.
6. Reabrir a decisão de Cloud API somente se o requisito de negócio mudar e houver uma avaliação explícita do número, elegibilidade da conta, custos, limites de grupo, tipos de mensagem e teste em ambiente sem produção.

## Fontes e limites da pesquisa

Consultadas em 2026-10-16. As referências do Postman abaixo são do espaço oficial publicado pela Meta. A referência da Groups API fica no portal de desenvolvedor da Meta; ela pode exigir sessão ou limitar acesso automatizado.

- [Coleção oficial WhatsApp Cloud API (Meta/Postman)](https://www.postman.com/meta/whatsapp-business-platform/collection/wlk6lh4/whatsapp-cloud-api) — requisitos da API, WABA/número, permissões e ambiente.
- [Documentação oficial Cloud API (Meta)](https://developers.facebook.com/docs/whatsapp/cloud-api/overview)
- [Mensagens interativas: documentação Cloud API (Meta)](https://developers.facebook.com/docs/whatsapp/cloud-api/messages/interactive-messages)
- [Exemplo oficial: enviar botão de resposta (Meta/Postman)](https://www.postman.com/meta/whatsapp-business-platform/request/x0kd1at/send-reply-button)
- [Exemplo oficial: responder a uma lista (Meta/Postman)](https://www.postman.com/meta/whatsapp-business-platform/request/jze7gxt/send-reply-to-list-message)
- [Groups API — documentação de desenvolvedor da Meta](https://developers.facebook.com/documentation/business-messaging/whatsapp/groups)
- [Groups API: início da configuração (Meta)](https://developers.facebook.com/documentation/business-messaging/whatsapp/groups/get-started)
- [WhatsApp Flows API (Meta/Postman)](https://www.postman.com/meta/whatsapp-business-platform/documentation/wl)
- [Baileys upstream: API para interagir com WhatsApp Web](https://github.com/WhiskeySockets/Baileys)
- [Referência técnica de Groups API que reproduz a documentação de desenvolvedor da Meta](https://support2.chatarchitect.com/books/meta-whatsapp/page/groups-api-developer-documentation) — fonte secundária usada para conferir a lista de tipos não suportados; confirmar essa lista na documentação oficial antes de uma decisão de migração.
- [WhatsApp Business App Coexistence — 8x8 Developer Portal](https://developer.8x8.com/connect/docs/whatsapp/whatsapp-business-app-coexistence/) — documentação de um provedor da plataforma que afirma que chats de grupo não são sincronizados nem disponibilizados durante coexistência; confirmar na configuração de onboarding aplicável à conta real.

**Certeza e lacunas:** a existência de botões/listas na Cloud API e a necessidade de portfólio empresarial Meta, WABA e número comercial são documentadas na coleção oficial Meta/Postman. A inadequação da troca para preservar grupos é sustentada pelas limitações publicadas para coexistência e pela referência técnica secundária da Groups API; a matriz exata de tipos suportados da Groups API deve ser reconfirmada diretamente com a Meta antes de qualquer proposta de migração. O documento não afirma que o cliente atual falha; a compatibilidade real de native flow ainda precisa de ensaio controlado em Android, iOS e Web. Nenhuma mensagem foi enviada ao WhatsApp e nenhum token/segredo foi usado.

## Resultado da tarefa

- Decisão técnica: **documentar e não migrar**.
- Arquivo criado isoladamente nesta branch: whatsapp-service/docs/WHATSAPP_MENU_OPTIONS.md.
- Sem alterações em src/index.js, módulos de IA, package.json, dependências, variáveis/serviços Railway ou conexão WhatsApp.
- Testes de código: **não executados**, pois esta entrega é documental e nenhum código de runtime foi alterado.
