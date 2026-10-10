# Identificação discreta no grupo do WhatsApp

## Regra aprovada
Quando um participante identificado envia uma mensagem nova no grupo, o bot responde **à mensagem** com `Abaddon disse:`. Enquanto a pessoa continuar falando, não repete. Só anuncia novamente quando houver **15 minutos completos sem mensagens dessa pessoa naquele grupo**. A contagem reinicia em toda mensagem recebida, não somente na anunciada.

O módulo `src/whatsapp/nickAnnouncer.js` implementa e testa essa regra independentemente do transporte. Não modifica mensagens existentes e ignora mensagens históricas, mensagens do próprio bot e conversas privadas.

## O que falta para funcionar no grupo
1. Um serviço **separado** para a conexão com WhatsApp; não executar no mesmo processo do Telegram.
2. Uma forma segura de associar o identificador do remetente no WhatsApp ao nick verificado do jogo, com consentimento. A API atual `GET /api/whatsapp/nicks` retorna apenas nomes, **não** o vínculo com a conta do WhatsApp. Não inferir vínculo por nomes iguais.
3. Parear uma conta de teste, identificar o JID do grupo e configurar persistência **privada** das credenciais da sessão. Nunca registrar tokens, QR codes, números ou credenciais em commits/logs públicos.
4. No evento de mensagens novas, chamar `announcer.handle(...)`; `lookupNick` consulta o vínculo confirmado, e `sendReply` envia `{ text, quoted: message }` ao grupo.
5. Testar com dois participantes, intervalos de 14/15 minutos, reinícios do serviço e desconexões antes de ativar em produção.

**Importante:** a API oficial do WhatsApp Business pode não atender ao cenário de grupos comuns. Bibliotecas não oficiais baseadas em WhatsApp Web têm risco de incompatibilidade e restrição de conta; confirmar a opção de conexão antes de instalar ou ativar.

## Segurança
O serviço WhatsApp deve consumir o token existente no Railway por variável de ambiente, sem copiá-lo para o repositório. Use uma conta dedicada de teste. Não iniciar conexão nem enviar mensagens sem pareamento e seleção explícita do grupo.
