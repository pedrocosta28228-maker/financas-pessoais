# Design — Agente de IA Financeiro (Minhas Finanças)

**Data:** 2026-11-24  
**Projeto:** Minhas Finanças (Web/PWA — React 19 + Node.js/Express + SQLite/PostgreSQL)  
**Tamanho:** Projeto completo  

---

## 1. Intenção e o Porquê

O **Minhas Finanças** já concentra os dados financeiros reais do usuário (carteiras, entradas, saídas, dívidas parceladas, despesas fixas, salário fixo e metas), mas hoje toda consulta ou registro exige navegar por abas e preencher formulários manualmente.

O objetivo é integrar um **Agente de IA Financeiro** diretamente no app para unir duas funções no mesmo fluxo de conversa:
1. **Análise e apoio à decisão:** responder perguntas em linguagem natural com base nos números reais do usuário (ex.: *"quanto ainda posso gastar este mês?"*, *"em qual cartão estou gastando mais?"*, *"se eu parcelar R$ 1.200 em 6x, aperto algum mês?"*).
2. **Ação rápida assistida:** interpretar pedidos em texto livre (ex.: *"paguei 85 no mercado no cartão Nubank"*, *"marca o aluguel como pago"*) e preparar o registro estruturado para o usuário aprovar em 1 clique.

---

## 2. Objetivos, Não-Objetivos e Anti-Objetivos

### Objetivos
- Permitir conversar com o agente a partir de qualquer tela do `Dashboard` sem perder o contexto visual das abas.
- Dar ao agente acesso **somente aos dados do usuário autenticado** (`req.usuario.id`) por meio de ferramentas (*tool calling*) bem definidas.
- Garantir **confirmação explícita em 1 clique** antes de qualquer escrita no banco de dados.
- Rodar **gratuitamente** tanto localmente quanto em produção no Render usando a camada gratuita da **API do Google Gemini** (`gemini-2.5-flash` por padrão, configurável via variável de ambiente).
- Persistir o histórico de conversa e o estado das ações propostas tanto em **SQLite** quanto em **PostgreSQL**.
- Atualizar os dados do `Dashboard` automaticamente após uma ação confirmada.

### Não-Objetivos (fora desta versão)
- Integração com WhatsApp, Telegram ou outros canais externos.
- Entrada por áudio (transcrição de voz) ou leitura de imagens/comprovantes (OCR).
- Integração bancária automática (Open Finance / OFX / CSV).
- Múltiplas conversas/threads paralelas (uma linha contínua de conversa com botão "Limpar conversa" é suficiente nesta v1).

### Anti-Objetivos (o que seria uma falha mesmo funcionando tecnicamente)
- **Gravar dados silenciosamente sem confirmação** do usuário.
- **Permitir exclusão de lançamentos ou manipulação de transferências entre contas** pelo agente — essas ações são explicitamente proibidas.
- **Inventar números ou valores financeiros** que não vieram das consultas reais ao banco.
- **Vazar dados de outros usuários** ou executar SQL arbitrário gerado pela IA.
- **Quebrar o app quando `GEMINI_API_KEY` não estiver configurada** ou quando a cota gratuita do Gemini atingir o limite (deve responder de forma clara e amigável, sem derrubar o servidor).

---

## 3. Restrições

- **Stack existente:** Backend Node.js 22+ ESM (`backend/src/`), Express 4, banco duplo via adapter `db.js` (SQLite `node:sqlite` local e PostgreSQL `pg` em produção), Frontend React 19 + Vite (`frontend/src/`).
- **Custo zero:** Usar API HTTP nativa do Google Gemini (`fetch` nativo do Node 22, sem dependências pesadas desnecessárias) com chave `GEMINI_API_KEY` da camada gratuita do Google AI Studio.
- **Segurança:**
  - Todas as rotas do agente exigem middleware `autenticar` (JWT).
  - Rate limit dedicado para o agente (ex.: 30 mensagens a cada 15 minutos por IP/usuário) além do `apiRateLimiter`, para proteger a cota gratuita do Gemini.
  - Validação estrita no backend dos parâmetros de toda ação antes de criar a proposta e novamente antes de executar no banco.
  - Nenhuma ferramenta de `DELETE` nem de transferência entre carteiras exposta ao modelo.
- **Idioma e moeda:** Português do Brasil (`pt-BR`), moeda `BRL` (`R$`), datas no fuso de Brasília (`America/Sao_Paulo`, reutilizando `obterDataBrasilia()`).

---

## 4. Abordagens Consideradas e Decisão

| Abordagem | Resumo | Trade-offs |
|---|---|---|
| **1. Gaveta lateral flutuante + Tool Calling (Escolhida)** | Botão flutuante no `Dashboard` abre uma gaveta lateral de chat (padrão `PerfilDrawer`). O backend usa *function calling* do Gemini com ferramentas de leitura sob demanda e ferramentas de proposta de ação. | Melhor equilíbrio entre agilidade (lançar/perguntar sem sair da aba atual) e profundidade (consulta qualquer mês, cartão ou projeção). Gaveta é mais estreita que uma página inteira. |
| **2. Aba dedicada "Assistente IA" na Sidebar + Tool Calling** | Nova seção na `Sidebar` ocupando a área principal do app, com mesmo motor de ferramentas no backend. | Mais espaço para tabelas e análises longas, mas obriga o usuário a sair da aba onde está olhando os números. |
| **3. Assistente leve em 1 chamada (sem Tool Calling)** | Backend monta um snapshot fixo do mês atual e envia em uma única chamada ao Gemini. | Mais rápido e usa menos requisições da cota, mas não consegue investigar meses passados, filtrar gastos específicos nem simular cenários fora do recorte fixo. |

**Decisão do usuário:** **Opção 1** — Gaveta lateral flutuante + Agente com *Tool Calling*.

---

## 5. Decisões Definidas com o Usuário

- **Canal:** Dentro do próprio Minhas Finanças (Web/PWA), como gaveta lateral flutuante acessível em qualquer tela do `Dashboard`.
- **Escopo funcional:** Análise financeira / apoio à decisão **e** execução de ações assistidas.
- **Autonomia:** Sempre confirmar em 1 clique antes de gravar no banco (**Confirmar** / **Cancelar**).
- **Ações proibidas:** O agente **nunca** exclui lançamentos e **nunca** faz ou altera transferências entre carteiras.
- **Provedor de IA:** Google Gemini API (`gemini-2.5-flash` por padrão, via `GEMINI_API_KEY`, substituível via `GEMINI_MODEL`).

---

## 6. Arquitetura Proposta

### 6.1. Banco de Dados (`backend/src/db.js`)

Adicionar **2 novas tabelas** (em ambos os blocos: PostgreSQL e SQLite):

1. **`agente_mensagens`** — histórico da conversa por usuário:
   - `id` (PK)
   - `usuario_id` (FK -> `usuarios.id` ON DELETE CASCADE)
   - `papel` (`'usuario' | 'assistente'`)
   - `conteudo` (TEXT)
   - `criado_em` (TIMESTAMP / TEXT)

2. **`agente_acoes_pendentes`** — propostas de ação aguardando confirmação do usuário (relação **1:N** com `agente_mensagens`, permitindo até 5 cartões de confirmação independentes em uma mesma resposta — *decisão técnica proposta*):
   - `id` (PK)
   - `usuario_id` (FK -> `usuarios.id` ON DELETE CASCADE)
   - `mensagem_id` (INTEGER NULLABLE, FK -> `agente_mensagens.id` ON DELETE SET NULL — vincula uma ou mais ações à mensagem do assistente que as propôs)
   - `tipo_acao` (`'criar_lancamento' | 'marcar_pago' | 'criar_meta' | 'criar_despesa_fixa'`)
   - `resumo` (TEXT — descrição legível para o cartão de confirmação)
   - `payload_json` (TEXT — JSON validado e normalizado pelo backend, nunca confiado cegamente na confirmação)
   - `status` (`'pendente' | 'confirmada' | 'cancelada'`)
   - `resultado_json` (TEXT NULLABLE — resumo do registro criado/atualizado após confirmação)
   - `criado_em` (TIMESTAMP / TEXT)
   - `resolvido_em` (TIMESTAMP / TEXT NULLABLE)

### 6.2. Ferramentas do Agente (`backend/src/agente.js`)

O módulo `agente.js` orquestra o loop de *function calling* com o Gemini (máximo de **5 iterações** por mensagem do usuário para evitar loops infinitos e proteger a cota).

#### Ferramentas de Leitura (executadas automaticamente pelo backend, sempre filtradas por `usuario_id`):
1. `obter_resumo_financeiro({ mes? })`: retorna saldo disponível total, previsto para entrar, saídas pagas, a pagar, salário fixo e total de despesas fixas ativas (geral ou para `YYYY-MM`).
2. `listar_carteiras()`: retorna id, nome, etiqueta, rendimento e saldo calculado de cada carteira.
3. `listar_lancamentos({ mes?, tipo?, status?, busca?, limite? })`: lista lançamentos filtrados (máximo 50 itens por chamada para economizar tokens).
4. `resumo_dividas_e_cartoes({ mes? })`: agrupa dívidas pendentes por `origem_divida` (cartão/pessoa) e lista próximos vencimentos.
5. `listar_despesas_fixas()`: lista despesas fixas ativas e inativas com dia de vencimento e valor.
6. `listar_metas()`: lista metas financeiras com progresso atual, valor alvo e prazo.
7. `projetar_proximos_meses({ meses? })`: calcula projeção (padrão 6 ou até 12 meses) combinando salário fixo, despesas fixas ativas e parcelas de dívidas/lançamentos pendentes (reutilizando a mesma lógica de projeção do app).

#### Ferramentas de Proposta de Ação (NÃO gravam no banco — criam registros em `agente_acoes_pendentes` com status `'pendente'`, até o limite de **5 propostas por turno**):
1. `propor_criar_lancamento({ titulo, valor, tipo, categoria?, data?, status?, conta_id?, parcelas?, modo_valor_parcela?, origem_divida?, descontar_saldo?, observacao? })`
   - `tipo` restrito a `'entrada' | 'saida' | 'divida'`.
   - `parcelas` (1 a 60) quando `tipo === 'divida'`.
   - `modo_valor_parcela` (`'total' | 'parcela'`, obrigatório quando `parcelas > 1`, *decisão técnica proposta*): evita ambiguidade entre *"1200 em 6x"* (`'total'`) e *"6x de 200"* (`'parcela'`), espelhando exatamente `modoValorParcela` do `POST /api/lancamentos`. O cartão de confirmação sempre exibe ambos os valores (ex.: `6x de R$ 200,00 · Total R$ 1.200,00`).
   - Se `conta_id` for informado, valida se pertence ao `usuario_id`. Se o usuário mencionou o nome de uma carteira (ex.: "Nubank"), o agente deve consultar `listar_carteiras()` antes para obter o `conta_id` correto.
2. `propor_marcar_pago({ lancamento_id, conta_id? })`
   - Valida se o lançamento pertence ao `usuario_id` e está `'pendente'`.
3. `propor_criar_meta({ titulo, valor_alvo, valor_atual?, prazo?, conta_id?, observacao? })`
4. `propor_criar_despesa_fixa({ titulo, valor, dia_vencimento, categoria?, conta_id? })`

> **Regra de segurança:** Se o usuário pedir para excluir um lançamento ou fazer uma transferência entre contas, o agente informa educadamente que, por segurança, essas ações devem ser feitas manualmente nas abas do app.

### 6.3. Rotas da API (`backend/src/server.js`)

Todas protegidas por `autenticar`:
- `GET /api/agente/status` — informa se `GEMINI_API_KEY` está configurada (`{ configurado: boolean, modelo: string }`) sem expor a chave.
- `GET /api/agente/historico` — retorna as últimas mensagens do usuário (ex.: últimas 50), cada uma com seu array `acoes` (ações pendentes/confirmadas/canceladas vinculadas via `mensagem_id`).
- `POST /api/agente/mensagem` (com `agenteRateLimiter`) — recebe `{ mensagem }`, salva a mensagem do usuário, roda o loop do agente com o Gemini (usando as últimas N mensagens como contexto), salva a resposta do assistente, vincula eventuais ações pendentes criadas no turno via `mensagem_id` e retorna `{ mensagemUsuario, mensagemAssistente, acoesPendentes }`.
- `POST /api/agente/acoes/:id/confirmar` — valida que a ação pertence ao `usuario_id` e está `'pendente'`, executa a operação real dentro de transação SQL (reaproveitando a lógica das rotas de lançamentos/parcelas/metas/despesas fixas), marca a ação como `'confirmada'` e retorna `{ ok: true, acao, resumoResultado }`.
- `POST /api/agente/acoes/:id/cancelar` — marca a ação como `'cancelada'` e retorna `{ ok: true, acao }`.
- `DELETE /api/agente/historico` — limpa o histórico de chat do usuário (e cancela ações pendentes antigas).

### 6.4. Interface no Frontend (`frontend/src/components/AgenteDrawer.jsx` + `Dashboard.jsx`)

- **Botão flutuante (FAB)** no canto inferior direito do `Dashboard`: ícone de assistente/estrelas com tooltip *"Assistente IA"*, visível em todas as abas.
- **Gaveta lateral (`AgenteDrawer.jsx`)**:
  - Segue o visual, cores, tema claro/escuro e comportamento (`Escape` para fechar, backdrop clicável) do `PerfilDrawer.jsx`.
  - **Estado vazio:** mensagem de boas-vindas curta + 3–4 chips clicáveis de sugestão (*"Como está meu mês?"*, *"Quanto sobra depois das dívidas?"*, *"Lançar um gasto"*, *"Posso parcelar uma compra?"*).
  - **Se `GEMINI_API_KEY` não estiver configurada:** exibe aviso claro explicando que basta adicionar `GEMINI_API_KEY` nas configurações do servidor para ativar o assistente.
  - **Cartão de Confirmação dentro do chat:**
    ```text
    ┌─────────────────────────────────────────┐
    │ 📝 Confirmar novo lançamento            │
    │                                         │
    │ Mercado                                 │
    │ R$ 85,00 · Saída · Pago                 │
    │ Carteira: Nubank · Data: 24/11/2026     │
    │                                         │
    │ [ ✓ Confirmar ]   [ Cancelar ]          │
    └─────────────────────────────────────────┘
    ```
    - Ao clicar em **Confirmar**: chama `POST /api/agente/acoes/:id/confirmar`, transforma o cartão em estado **Confirmado** (badge verde) e dispara o recarregamento dos dados no `Dashboard` (`carregarDados()`).
    - Ao clicar em **Cancelar**: chama `POST /api/agente/acoes/:id/cancelar` e marca o cartão como **Cancelado**.
  - **Cabeçalho da gaveta:** título *"Assistente Financeiro"*, botão *"Limpar conversa"* e botão fechar (`×`).

### 6.5. Variáveis de Ambiente e Deploy

Em `backend/.env.example` e `render.yaml`:
- `GEMINI_API_KEY=` (opcional para o app subir; necessária para o chat responder)
- `GEMINI_MODEL=gemini-2.5-flash` (opcional, com default `gemini-2.5-flash`)

### 6.6. Estratégia de Testes

Em `backend/test/` (usando `node --test`, mantendo compatibilidade com os 14 testes existentes):
- Permitir injetar um cliente/função `chamarGemini` fake em `agente.js` para testar sem rede nem chave real:
  1. Leitura via *tool calling* (simula Gemini pedindo `obter_resumo_financeiro` e depois devolvendo texto final).
  2. Proposta de ação + confirmação em 1 clique (verifica que nada é gravado antes de `/confirmar`, e que após `/confirmar` o lançamento aparece no banco e não pode ser confirmado duas vezes).
  3. Cancelamento de ação (verifica que o status muda para `cancelada` e nada foi gravado).
  4. Isolamento entre usuários (usuário B não consegue confirmar/cancelar ação do usuário A).
  5. Comportamento seguro quando `GEMINI_API_KEY` não está definida (retorna status amigável sem erro 500 não tratado).

---

## 7. O Que Fica a Cargo do Implementador

- Refinamento visual exato (CSS, sombras, animações de abertura da gaveta e indicador de "digitando...") seguindo o design system já existente em `frontend/src/styles.css`.
- Redação final do *system prompt* em `pt-BR` (incluindo data atual de Brasília, instruções para sempre usar ferramentas em vez de chutar números, e recusa educada para exclusões/transferências).
- Quantidade exata de mensagens recentes enviadas como contexto ao Gemini (sugestão: últimas 12–16 mensagens para equilibrar memória e cota gratuita) e timeout de requisição HTTP (sugestão: 25s).
- Extração de funções auxiliares compartilhadas de `server.js` (como cálculo de projeção e criação de lançamento/parcelas) caso facilite o reuso limpo por `agente.js`, sem quebrar nenhuma rota ou teste existente.
