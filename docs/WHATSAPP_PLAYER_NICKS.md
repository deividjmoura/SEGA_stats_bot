# WhatsApp — primeira etapa: lista de nicks

## Objetivo

Publicar no grupo do WhatsApp uma lista dos nicks dos jogadores que já estão cadastrados no SEGA Stats Bot. Esta etapa não implementa respostas automáticas nem IA e não altera os handlers do Telegram.

## Função implementada

`src/whatsapp/nickList.js` exporta:

- `buildNickListMessage(players)`: cria uma mensagem organizada, ordena os nomes, ignora valores vazios e remove duplicados.
- `publishNickList({ client, groupJid, players })`: envia a mensagem usando um cliente de WhatsApp injetado, sem acoplar a função à biblioteca de conexão.

O teste automatizado está em `test/whatsappNickList.test.js`.

## Limite importante

Esta é a função de montagem e publicação da lista, não a conexão completa com o WhatsApp. Ainda precisamos configurar separadamente a sessão do WhatsApp, identificar o JID do grupo e ligar a origem dos jogadores cadastrados a esta função. A sessão do WhatsApp não deve ser iniciada dentro de `src/index.js`, para manter o processo do Telegram isolado.

## Próximos passos

1. Escolher e validar a biblioteca/conexão do WhatsApp em um ambiente de teste.
2. Parear uma conta de teste e identificar o grupo de destino.
3. Ler apenas os nicks já salvos no armazenamento persistente, sem expor JWTs ou códigos de verificação.
4. Publicar a lista manualmente no primeiro teste e confirmar o resultado no aplicativo do celular.
5. Só então automatizar atualização da lista.

A integração não deve afirmar que altera o nome exibido de cada participante: ela publica os nicks como uma mensagem/lista no grupo. Alterar os nomes de perfil dos membros não é uma capacidade que o bot deva presumir.
