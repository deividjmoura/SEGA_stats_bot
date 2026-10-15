# Integração WhatsApp — Clã Tenebrozos

Esta ponte usa Baileys (biblioteca WhatsApp **não oficial**) e é separada do bot principal do Telegram. O uso de automação em conta pessoal envolve risco de instabilidade e restrições da plataforma.

## Migração para o Clã Tenebrozos

- **Bot público:** NOX; chamada principal `!nox` e perguntas em `@NOX`.
- **Grupo ativo:** Geral do Clã Tenebrozos, indicado pela variável `WHATSAPP_GROUP_JID`. Os comandos e brincadeiras continuam restritos a **um** grupo ativo por vez.
- **Avisos da comunidade:** detectados a partir do grupo ativo quando ele está vinculado à comunidade; enviados ao grupo Geral com menção coletiva, se os recursos já estiverem ativados.
- **Integrantes e ADMs:** sem respostas automáticas. O grupo Integrantes não deve ser definido como `WHATSAPP_GROUP_JID`.
- `WHATSAPP_GROUP_JID` só deve ser alterada **depois** de identificar e confirmar o JID do grupo correto. Um link de convite não é o JID.
- **Preservar** `WHATSAPP_AUTH_DIR`, `WHATSAPP_DATA_DIR`, `WHATSAPP_SESSION_ENCRYPTION_KEY` e o volume persistente. Não refazer pareamento por causa de uma troca de clã.
- O nome técnico do serviço `SEGA_WhatsApp_Bridge` e o nome existente do volume não devem ser alterados na migração; não aparecem como nome do bot.
- Em caso de escolha de outro nome, mudar os textos/comandos e testar **antes** de publicar; não alterar as variáveis do grupo antigo às cegas.

## Conversas privadas e privacidade

O número de WhatsApp conectado pertence ao administrador. **O bot ignora qualquer conversa privada com terceiros**, mesmo números soltos, comandos, respostas a mensagens anteriores e textos que parecem Battle ID. Somente a conversa “mensagens para você mesmo”, identificada pelo JID da própria conta conectada, pode acionar comandos do NOX para testes. O filtro é aplicado antes de chamar a lógica antiga de cadastro e de consultar APIs.

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