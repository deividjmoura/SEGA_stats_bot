# API protegida de nicks para o WhatsApp

Esta API é opcional e fica desativada enquanto `WHATSAPP_NICKS_API_TOKEN` não estiver configurado. Ela não substitui nem altera o polling do Telegram.

## Endpoint

- Método: `GET`
- Caminho: `/api/whatsapp/nicks`
- Autenticação: `Authorization: Bearer <token>`
- Token: pelo menos 32 caracteres aleatórios; configure-o como variável de ambiente no Railway somente quando autorizar o deploy.

Exemplo de resposta:

```json
{
  "updatedAt": "2026-10-10T12:00:00.000Z",
  "players": [
    { "name": "Nick verificado" }
  ]
}
```

A resposta contém somente nicks marcados como verificados. JWT, Role ID, Zone ID e IDs do Telegram nunca são incluídos. Respostas usam `Cache-Control: no-store`.

## Configuração e publicação

1. Gere um token aleatório de pelo menos 32 caracteres e guarde-o como segredo.
2. Configure `WHATSAPP_NICKS_API_TOKEN` no serviço do Telegram somente após autorizar a alteração de produção.
3. Confirme que o serviço possui um domínio HTTPS e que a rota protegida responde.
4. Configure o serviço WhatsApp com a URL e o mesmo token por variáveis de ambiente.
5. Não coloque o token em código, commits, logs, mensagens ou URLs.

Sem token, o bot do Telegram continua funcionando e a API não abre uma porta. Nenhuma alteração de Railway ou deploy é executada por este código automaticamente.
