# Serviço WhatsApp isolado (experimental)

Executar separado do Telegram, com Node >=20.9 e diretório persistente para autenticação.

**Antes de ativar:** biblioteca Baileys é não oficial, pode quebrar ou causar restrições à conta. Usar somente número de teste autorizado.

Variáveis:
- `WHATSAPP_AUTH_DIR`: diretório persistente de credenciais, ex.: `/app/data/whatsapp-auth`.
- `WHATSAPP_GROUP_JID`: identificador interno do grupo obtido após conexão (não é o link de convite).
- `WHATSAPP_NICK_MAP_JSON`: objeto privado `{"JID_DO_PARTICIPANTE":"Abaddon"}`; apenas associações confirmadas pelo próprio participante.
- `WHATSAPP_REPLY_ENABLED`: `true` somente após validar grupo e mapeamentos.
- `WHATSAPP_PAIR_PHONE`: número da conta do bot (somente dígitos); usado na solicitação de pareamento.

O pareamento não imprime códigos em logs de produção. Preparar fluxo privado de pareamento local ou painel autenticado antes de iniciar serviço em produção. Não subir credenciais ao GitHub.

O bot ignora histórico e mensagens próprias, e responde ao primeiro envio depois de 15 minutos de inatividade com `Nick disse:`. Enquanto o usuário fala, o contador é renovado.
