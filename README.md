# 💀 NOX — Clã Tenebrozos

**Nosso companheiro de Mobile Legends, direto na comunidade do WhatsApp.**

> 🩸 **Respeito • União • Foco • Evolução**  
> ⚔️ **Juntos somos imbatíveis!**

O **NOX** é um projeto independente criado para facilitar a organização do **Clã Tenebrozos**, acompanhar o desempenho dos jogadores e trazer informação e resenha para o grupo. Ele não é um produto oficial da MOONTON nem do WhatsApp.

**Em funcionamento:** integração com WhatsApp, comandos, menu interativo com alternativa por texto, consultas de estatísticas disponíveis, agenda e presenças, sugestões e interações. Algumas consultas dependem da disponibilidade de uma API comunitária.

## 🎮 Comece por aqui

No grupo **💀 Clã Tenebrozos | Geral 🔥**, envie `!nox`. Se o menu de botões não abrir no seu WhatsApp, o bot apresenta os comandos em texto.

| Comando | O que faz |
| --- | --- |
| `!nox` | Abre o menu principal |
| `!ajuda` | Explica os comandos com exemplos |
| `!stats` | Consulta os dados disponíveis do jogador cadastrado |
| `!cadastrar` | Orienta o cadastro, concluído **no privado** |
| `!agenda` | Mostra eventos e permite confirmar ou retirar presença |
| `!sugestao` | Abre sugestões de melhorias ou conhecimento de MLBB |
| `!conhecimento` | Inicia o envio guiado de uma informação sobre o jogo |
| `!ranking` | Ranking do clã — **em desenvolvimento** |
| `!highlights` | Destaques — **em desenvolvimento** |

Também é possível perguntar sobre o jogo com `@NOX`, por exemplo: **`@NOX quem countera Fanny?`**. Mencionar um integrante no Geral pode render uma zoeira, sempre no clima de resenha.

### 📊 Cadastro e estatísticas

1. Envie `!cadastrar` e siga o link para a conversa privada.
2. Informe **Role ID** e **Zone ID** do Mobile Legends.
3. Utilize o código de verificação enviado ao correio interno do jogo.
4. Após a confirmação, use `!stats` para consultar as informações disponíveis.

**Nunca publique códigos de verificação no grupo.** A consulta depende dos dados realmente fornecidos pela integração; o NOX não inventa partidas, rankings ou estatísticas ausentes.

### 📅 Agenda e eventos

No Geral, `!agenda` lista eventos e permite confirmar presença. Como alternativa aos botões, há comandos por ID indicados na ajuda. Em regra, as confirmações se encerram **30 minutos antes** do evento; o NOX pode lembrar o grupo **1 hora antes**. O Conselho administra eventos e autoriza exceções pelas opções restritas aos ADMs.

### 💡 Sugestões e conhecimento

Jogadores cadastrados podem sugerir melhorias e enviar informações sobre heróis, itens, builds e counters. O conteúdo passa por revisão autorizada antes de entrar na base de conhecimento. A proposta não é aprovada automaticamente.

## 🏠 Como a comunidade está organizada

| Espaço | Comportamento do NOX |
| --- | --- |
| **💀 Geral** | Menu, comandos, estatísticas, perguntas, agenda e zoeiras |
| **⚔️ Integrantes** | Não recebe comandos gerais nem zoeiras; pode receber fluxos restritos de revisão |
| **👑 Conselho (ADMs)** | Ferramentas específicas de organização, agenda e autorizações |
| **📢 Avisos oficiais** | Publicações podem gerar um lembrete automático no Geral |

O processamento é limitado aos grupos configurados e às permissões específicas de cada fluxo. Uma conversa normal no Geral **não deve provocar respostas automáticas** sem comando ou interação dirigida ao bot.

## 🔐 Privacidade e confiabilidade

- O NOX usa a conta do WhatsApp do responsável; mensagens automáticas aparecem enviadas por essa conta e são identificadas como **NOX bot**.
- O cadastro de jogador é voluntário e ocorre por fluxo privado. O NOX não pede a senha do Mobile Legends.
- Sessões e dados de jogadores são preservados em um volume persistente e os tokens são criptografados.
- Conversas privadas pessoais não relacionadas ao bot são ignoradas.
- A integração com WhatsApp utiliza **Baileys**, uma biblioteca não oficial: pode haver instabilidade ou restrições da plataforma.
- Informações de jogo usam uma integração comunitária e podem ficar indisponíveis. Rankings e destaques continuam em desenvolvimento.

## ☁️ Como o projeto fica online

O serviço WhatsApp roda em **Node.js** e é hospedado na **Railway**, que mantém o processo disponível mesmo quando o computador do responsável está desligado. O preço depende do plano e do consumo.

O plano **Hobby** da Railway custa **US$ 5/mês** e inclui US$ 5 de consumo; uso adicional pode aumentar o total. Confira sempre os [preços oficiais](https://railway.com/pricing).

A contribuição coletiva para manter o NOX online é uma proposta de organização do clã, não uma cobrança feita pelo próprio bot.

### Para desenvolvedores

```text
whatsapp-service/
├── src/             # Integração WhatsApp e funcionalidades NOX
├── test/            # Testes de integração e segurança de fluxos
├── package.json
└── README.md        # Operação e configuração da ponte

src/                  # Implementação histórica do bot Telegram
docs/                 # Arquitetura e documentação complementar
.github/workflows/    # Testes automatizados
```

O código da aplicação WhatsApp está em [`whatsapp-service/`](whatsapp-service/); o [guia de operação](whatsapp-service/README.md) reúne configuração, permissões, persistência e testes. Para executar os testes desse serviço:

```bash
cd whatsapp-service
npm install
npm test
```

Não publique arquivos de autenticação, IDs privados de usuários nem valores de variáveis secretas. Alterações de implantação devem preservar o volume persistente e a chave criptográfica.

## 🛠️ Desenvolvimento e próximos passos

**Já implementado:** comandos NOX, menu com alternativa por texto, cadastro verificado, consultas disponíveis, ajuda de Mobile Legends, zoeiras de menções, agenda e confirmação de presenças, sugestões com revisão e alertas de comunicados.

**Em evolução:** ranking confiável, highlights, cobertura de estatísticas e fontes de dados mais estáveis, além de refinamentos de usabilidade e segurança.

O projeto nasceu com outro nome. **O endereço técnico do repositório foi mantido para preservar links, referências e integrações existentes**; a identidade atual do bot e do clã é **NOX | Tenebrozos**.

---

**💀 Clã Tenebrozos • Respeito, União, Foco e Evolução.**  
Desenvolvimento independente, feito para a comunidade de jogadores.
