# Integração WhatsApp — Clã Mega Drive

Esta ponte usa Baileys (biblioteca WhatsApp **não oficial**) e é separada do bot principal do Telegram. O uso de automação em conta pessoal envolve risco de instabilidade e restrições da plataforma.

## Estado de preparação

A instância `SEGA_WhatsApp_Bridge` no Railway fica apenas **staged**, sem deploy e sem conexão, até a autorização de implantação. A conexão WhatsApp exige uma segunda ativação explícita de `WHATSAPP_CONNECT_ENABLED=true` e só deve ocorrer após a autorização de pareamento. O volume antigo `sega-whatsapp-auth` deve ser montado em `/app/data` para preservar credenciais que ainda possam existir. Não há garantia de reutilização da sessão antiga.

## Papéis dos grupos

- **Geral** (`WHATSAPP_GROUP_JID`): único grupo que recebe comandos, menus, respostas, brincadeiras e avisos.
- **Avisos Oficiais** (`WHATSAPP_ANNOUNCEMENTS_GROUP_JID`): mensagens novas podem gerar um alerta curto no Geral, **sem copiar o conteúdo**.
- **Integrantes** e **ADMs**: nenhuma resposta automática. Os IDs desses grupos não precisam ser configurados na ponte por enquanto.

O alerta de comunicado é: “📢 Novo comunicado SEGA! Confira o grupo de Avisos Oficiais.” O envio utiliza somente eventos recentes do grupo de Avisos, evita duplicações por ID persistidas no volume e desconsidera reações, edições e mensagens históricas. Não depende de link de convite.

## Conversas privadas e privacidade

O número de WhatsApp conectado pertence ao administrador. **O bot ignora qualquer conversa privada com terceiros**, mesmo números soltos, comandos, respostas a mensagens anteriores e textos que parecem Battle ID. Somente a conversa “mensagens para você mesmo”, identificada pelo JID da própria conta conectada, pode acionar comandos do SEGA para testes. O filtro é aplicado antes de chamar a lógica antiga de cadastro e de consultar APIs.

Essa política evita que o bot entre no meio das conversas pessoais do administrador; pode ser revista posteriormente caso se decida usar um número exclusivo para a automação.

## Variáveis de ambiente

- `WHATSAPP_CONNECT_ENABLED=false` até a autorização explícita para estabelecer a sessão. Mesmo após a implantação do serviço, o processo fica estacionado sem abrir conexão enquanto esta variável estiver desativada.
- `WHATSAPP_AUTH_DIR=/app/data/whatsapp-auth-v2`
- `WHATSAPP_DATA_DIR=/app/data`
- `WHATSAPP_REPLY_ENABLED=false` até terminar a validação e autorizar respostas.
- `WHATSAPP_ANNOUNCEMENTS_ENABLED=false` até confirmar os IDs dos grupos e autorizar notificações.
- `WHATSAPP_GROUP_JID`: JID interno do grupo Geral (não é link de convite).
- `WHATSAPP_ANNOUNCEMENTS_GROUP_JID`: JID interno de Avisos Oficiais.
- `WHATSAPP_SESSION_ENCRYPTION_KEY`: segredo da criptografia local dos dados de jogadores, obrigatório para iniciar. **Não comitar segredos**. A chave original, se existente, seria necessária para abrir dados antigos criptografados.
- `WHATSAPP_PAIR_PHONE`: opcional, apenas se o usuário solicitar pareamento por telefone.

Para habilitar comunicação, configure os IDs **somente depois de criar os grupos**, verifique a conta conectada e só então altere os switches. As mensagens continuam desativadas com os switches em `false`.

## Testes

Dentro de `whatsapp-service/`: `npm test`. Esses testes são locais, sem conectar o WhatsApp; faça validação real apenas depois do consentimento de pareamento.