# Alternativas aos menus do WhatsApp — NOX

**Data da avaliação:** 2026-10-16  
**Escopo:** descobrir se há uma alternativa mais confiável aos menus clicáveis atuais, sem alterar a conexão do WhatsApp, a branch funcional, o serviço Railway ou o fluxo de IA do outro agente.  
**Decisão:** **não migrar o transporte de menus nesta rodada**. Documentar e manter a implementação atual com fallback textual.

## Resumo executivo

O código do NOX constrói e tenta enviar menus de seleção nativos (single_select / native flow) por Baileys. Isso comprova que existe um caminho de envio, mas **não** garante que cada cliente consiga renderizar a lista ou retornar a escolha. Há relato anterior no contexto do projeto de que o WhatsApp Business exibiu avisos de “incompatível/atualize” mesmo atualizado; ainda não há uma matriz reproduzível de dispositivo/versão que identifique a causa. O fallback textual, portanto, é requisito operacional e não apenas um detalhe conveniente.

A API padrão da Meta suporta mensagens interativas em conversas individuais, incluindo botões de resposta e listas, mas isso **não torna esses recursos um substituto para os menus do grupo atual**. A Groups API é um produto distinto: as referências técnicas consultadas descrevem exigências de elegibilidade comercial, grupos API-managed com até 8 participantes e sem migração transparente de um grupo de clã já existente. A documentação técnica do provedor Bird lista mensagens interativas entre os tipos não suportados em grupos. A página oficial da Groups API retornou limite de acesso automatizado (HTTP 429) durante esta revisão, então a lista exata de tipos deve ser confirmada diretamente com a Meta antes de qualquer futura migração. Mesmo sem depender dessa última restrição, os limites de grupo e a ausência de conversão transparente já impedem tratá-la como troca direta do grupo Geral.

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
| Manter Baileys + native flow + texto de fallback | Não troca sessão, número, grupo ou arquitetura. O código desse fluxo já existe. | Protocolo não oficial; já existe relato de aviso de incompatibilidade em cliente WhatsApp Business, ainda sem reprodução técnica isolando a causa. Compatibilidade e retorno do clique precisam de testes reais por cliente. | **Manter provisoriamente e medir.** |
| WhatsApp Cloud API oficial com botões/listas | Contrato de API documentado; mensagens interativas oficiais e rastreamento de status por webhooks. | Exige configuração de negócio/WABA, número, permissões e tokens; não é um substituto transparente para a sessão Baileys. O suporte de mensagens interativas da API padrão não deve ser confundido com suporte em grupos. | Não integrar agora. |
| Cloud API Groups API | Possui operações oficiais próprias para grupos e mensagens. | É uma modalidade com elegibilidade e limites próprios. A referência técnica da Groups API indica até 8 participantes e não suporta mensagens interativas; não serve para substituir os menus atuais do grupo do clã. Grupos/coexistência também possuem limitações específicas. | **Não serve ao requisito atual.** |
| Outra biblioteca que automatiza WhatsApp Web (por exemplo, whatsapp-web.js ou WPPConnect) | API de desenvolvimento diferente, que pode ser mais conveniente em alguns projetos. | Continua baseada em automação/protocolo de cliente, exige migração e pareamento/testes e não transforma a integração em API oficial. Não há evidência nesta avaliação de que resolva a limitação específica sem introduzir outros riscos. | Não trocar de biblioteca sem um defeito reproduzível e um teste comparativo. |
| Menu web externo aberto por link | Interface própria com controles previsíveis em Android, iOS e navegador. Não depende de renderizar native flow no cliente. | Sai do fluxo de menu dentro do WhatsApp; exige hospedagem, validação de identidade/autorização, links seguros e uma decisão de produto. | Alternativa futura caso a experiência rica seja mais importante que permanecer dentro do grupo. |

## Por que a Cloud API não é uma troca direta

A coleção oficial da Meta descreve a Cloud API como a plataforma oficial de mensagens comerciais e exige um portfólio empresarial Meta, uma WhatsApp Business Account (WABA) e número comercial. Para enviar mensagens, a referência oficial lista `whatsapp_business_messaging` e o identificador do número; operações de administração de ativos/assinaturas podem exigir permissões adicionais, como `whatsapp_business_management`, conforme o endpoint utilizado. Mensagens interativas — botões de resposta e listas — têm endpoints e estruturas documentados para conversas individuais.

A Groups API é separada das mensagens interativas padrão e voltada a grupos criados/geridos pela API, não a converter silenciosamente um grupo existente do aplicativo. As referências técnicas consultadas indicam até 8 participantes por grupo e exigência de elegibilidade de Conta Comercial Oficial (OBA). A documentação do provedor Bird lista chamadas, mensagens interativas, templates de autenticação, mensagens de comércio e mensagens temporárias como tipos não entregáveis em grupos. Como a página oficial da Meta não pôde ser aberta por limite automatizado nesta revisão, trate a lista exata de capacidades como **a confirmar diretamente com a Meta** antes de qualquer migração.

A coexistência com o aplicativo WhatsApp Business também não resolve os grupos: a documentação do provedor 8x8 afirma que os grupos continuam no app, mas não são sincronizados nem disponibilizados pela plataforma/API. Assim, manter o mesmo número em coexistência não dá ao NOX acesso programático ao grupo atual. Este trabalho não solicitou nem iniciou onboarding, troca de número, criação de grupos ou pareamento.

## Recomendação técnica

1. **Manter a implementação atual, sem deploy ou alteração de dependência.**
2. Preservar sempre o comando textual equivalente junto dos menus clicáveis. Para agenda, manter !agenda, !confirmar ID e !desistir ID; para outros menus, orientar explicitamente qual comando digitar.
3. Reproduzir primeiro o aviso de incompatibilidade já relatado e registar cliente (WhatsApp comum ou Business), versão completa, sistema operacional, aparelho, hora e fluxo/menu usado. Depois validar em WhatsApp Android, iOS e Web/Desktop, sem presumir compatibilidade universal porque o payload foi aceito pelo Baileys. Para cada caso, registrar separadamente: mensagem entregue, lista renderizada, opção clicada recebida pelo bot e fallback textual funcional.
4. Manter a autorização do destino antes do envio do menu. O clique é apenas uma entrada do usuário, não uma permissão administrativa: as verificações de identidade/permissão continuam necessárias ao executar cada ação.
5. Se falhas de renderização ocorrerem de forma repetida, primeiro coletar casos reproduzíveis e reforçar o fallback. Um menu web por link é a alternativa isolada mais plausível caso a prioridade passe a ser uma UI rica e previsível.
6. Reabrir a decisão de Cloud API somente se o requisito de negócio mudar e houver uma avaliação explícita do número, elegibilidade da conta, custos, limites de grupo, tipos de mensagem e teste em ambiente sem produção.

## Fontes e limites da pesquisa

Revisadas em 2026-10-16. As referências do Postman abaixo são do espaço oficial publicado pela Meta. Ao abrir as páginas da Groups API em developers.facebook.com nesta revisão, a ferramenta recebeu HTTP 429 (Too Many Requests); por isso, os detalhes específicos de Groups API abaixo se apoiam também em referências técnicas de provedores, claramente identificadas, e devem ser reconfirmados no portal oficial antes de uma migração.

- [Coleção oficial WhatsApp Cloud API (Meta/Postman)](https://www.postman.com/meta/whatsapp-business-platform/collection/wlk6lh4/whatsapp-cloud-api) — requisitos da API, WABA/número, permissões e ambiente.
- [Documentação oficial Cloud API (Meta)](https://developers.facebook.com/docs/whatsapp/cloud-api/overview)
- [Mensagens interativas: documentação Cloud API (Meta)](https://developers.facebook.com/docs/whatsapp/cloud-api/messages/interactive-messages)
- [Exemplo oficial: enviar botão de resposta (Meta/Postman)](https://www.postman.com/meta/whatsapp-business-platform/request/x0kd1at/send-reply-button)
- [Exemplo oficial: responder a uma lista (Meta/Postman)](https://www.postman.com/meta/whatsapp-business-platform/request/jze7gxt/send-reply-to-list-message)
- [Groups API — documentação de desenvolvedor da Meta](https://developers.facebook.com/documentation/business-messaging/whatsapp/groups)
- [Groups API: início da configuração (Meta)](https://developers.facebook.com/documentation/business-messaging/whatsapp/groups/get-started)
- [WhatsApp Flows API (Meta/Postman)](https://www.postman.com/meta/whatsapp-business-platform/documentation/wl)
- [Baileys upstream: API para interagir com WhatsApp Web](https://github.com/WhiskeySockets/Baileys)
- [Groups API — guia técnico de um provedor da plataforma (Bird)](https://bird.com/docs/guides/whatsapp/groups) — descreve limites de 8 participantes e lista mensagens interativas entre os tipos não entregáveis a grupos; fonte secundária, não substitui a confirmação na Meta.
- [Groups API — referência técnica da Unipile](https://www.unipile.com/br/api-de-grupo-do-whatsapp/) — lista mensagens de texto, mídia e templates como tipos suportados; útil para a incompatibilidade com o requisito, mas conferir detalhes no portal oficial.
- [WhatsApp Business App Coexistence — 8x8 Developer Portal](https://developer.8x8.com/connect/docs/whatsapp/whatsapp-business-app-coexistence/) — grupos permanecem no app e não são sincronizados/disponíveis pela plataforma na coexistência; documentação de um provedor, confirmar detalhes do onboarding da conta real.

**Certeza e lacunas:** botões/listas na Cloud API individual e seus requisitos básicos constam das coleções oficiais da Meta. Não foi possível confirmar diretamente, nesta revisão, cada restrição da Groups API na página oficial por causa do HTTP 429; as referências secundárias consultadas concordam que a modalidade tem limites incompatíveis com um grupo grande/existente e que mensagens interativas nativas não estão disponíveis para grupos. A documentação não prova que o payload atual sempre funciona ou sempre falha. O relato prévio de incompatibilidade ainda precisa de reprodução em Android/iOS/Web e de uma versão de cliente registrada. Nenhuma mensagem foi enviada ao WhatsApp e nenhum token/segredo foi usado.

## Resultado da tarefa

- Decisão técnica: **documentar e não migrar**.
- Arquivo criado isoladamente nesta branch: whatsapp-service/docs/WHATSAPP_MENU_OPTIONS.md.
- Sem alterações em src/index.js, módulos de IA, package.json, dependências, variáveis/serviços Railway ou conexão WhatsApp.
- Testes de código: **não executados**, pois esta entrega é documental e nenhum código de runtime foi alterado.
