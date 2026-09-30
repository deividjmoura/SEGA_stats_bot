# Estratégia de integração de dados

## Problema

A autenticação do jogador e a obtenção das estatísticas são problemas diferentes.

O SEGA Stats Bot já possui um fluxo de autenticação baseado em:

```text
Role ID + Zone ID
        │
        ▼
Código enviado ao correio interno do MLBB
        │
        ▼
Código informado pelo próprio jogador
        │
        ▼
Sessão autenticada
```

O ponto de risco atual é a disponibilidade e estabilidade dos endpoints de dados.

## Requisitos do provider

Um provider ideal deve fornecer, quando permitido:

### Identidade

- Role ID
- Zone ID
- Nome do jogador
- Rank
- informações básicas do perfil

### Estatísticas

- partidas
- vitórias
- derrotas
- win rate
- K/D/A
- MVPs
- pontuação
- desempenho por herói
- desempenho por rota

### Histórico

- partidas recentes
- data/hora
- resultado
- herói
- K/D/A
- pontuação
- detalhes da partida quando disponíveis

### Temporadas

- temporadas disponíveis
- estatísticas por temporada
- histórico suficiente para acompanhar evolução

## Provedores em investigação

### 1. Rone Arena

É a integração comunitária utilizada atualmente.

**Vantagem:** já possui autenticação e endpoints próximos do que o projeto precisa.

**Risco:** endpoints de dados do usuário podem ser alterados ou descontinuados.

### 2. APIs e SDKs independentes

Existem serviços e SDKs comunitários que expõem dados de MLBB.

Antes de adotar qualquer um deles, precisamos verificar:

- origem dos dados;
- estabilidade;
- limites de uso;
- autenticação;
- política de privacidade;
- termos de uso;
- cobertura real do histórico;
- dependência de endpoints não oficiais.

Não basta a API responder nome e rank. O bot precisa dos dados que justificam o projeto.

### 3. Integração oficial MOONTON

É o caminho de longo prazo que está sendo investigado.

A solicitação deve perguntar especificamente sobre:

- API oficial de estatísticas;
- acesso a histórico de partidas;
- programa para desenvolvedores;
- programa de parceiros;
- autorização de aplicações de comunidade;
- mecanismos oficiais de consentimento do jogador;
- requisitos técnicos e comerciais.

Nenhuma integração oficial deve ser presumida até existir confirmação da MOONTON.

## Critério de escolha

| Critério | Pergunta |
|---|---|
| Cobertura | Entrega as estatísticas necessárias? |
| Histórico | Entrega partidas e detalhes? |
| Estabilidade | A interface é mantida? |
| Autorização | O uso é permitido pelo provedor? |
| Privacidade | Existe tratamento adequado dos dados? |
| Escalabilidade | Suporta vários jogadores do clã? |
| Custo | O custo é compatível com o projeto? |
| Dependência | Depende de endpoints frágeis ou engenharia reversa? |

## Objetivo

O projeto deve conseguir trocar de provider sem alterar o funcionamento do Telegram.

Isso permite continuar desenvolvendo o bot enquanto a fonte definitiva de dados é investigada.
