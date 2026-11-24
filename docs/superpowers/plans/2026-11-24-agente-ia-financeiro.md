# Agente de IA Financeiro Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrar um Agente de IA Financeiro dentro do **Minhas Finanças (Web/PWA)** como gaveta lateral flutuante, capaz de analisar os dados reais do usuário via *tool calling* (Google Gemini API gratuita) e propor ações financeiras com confirmação obrigatória em 1 clique.

**Architecture:** O backend Node.js/Express ganha dois módulos focados: `agente-tools.js` (ferramentas de leitura, criação de propostas e execução transacional na confirmação, sempre filtradas por `usuario_id` e sem exclusões/transferências) e `agente.js` (cliente HTTP nativo para Google Gemini `gemini-2.5-flash` + loop de *function calling* com histórico persistido em `agente_mensagens` e `agente_acoes_pendentes` 1:N em SQLite e PostgreSQL). O frontend React ganha `AgenteDrawer.jsx` + botão flutuante no `Dashboard.jsx`, atualizando o dashboard automaticamente ao confirmar cada cartão de ação.

**Tech Stack:** Node.js 22+ ESM (`fetch` nativo, `node:sqlite`, `node:test`), Express 4, PostgreSQL (`pg`), React 19, Vite, Google Gemini REST API (`gemini-2.5-flash`).

**Spec:** [docs/superpowers/specs/2026-11-24-agente-ia-financeiro-design.md](../specs/2026-11-24-agente-ia-financeiro-design.md)

## Global Constraints

- Banco de dados duplo obrigatório: toda nova tabela e query deve funcionar em SQLite (`node:sqlite`) e PostgreSQL (`pg`) usando placeholders `?` via adapter `db.js`.
- Custo zero e zero dependências novas obrigatórias no backend: usar `fetch` nativo do Node 22 para a API do Google Gemini (`GEMINI_API_KEY`, `GEMINI_MODEL` com default `'gemini-2.5-flash'`).
- Confirmação obrigatória em 1 clique: nenhuma ferramenta chamada pelo modelo pode gravar diretamente em `lancamentos`, `metas`, `despesas_fixas` ou `contas`; gravações só ocorrem em `POST /api/agente/acoes/:id/confirmar`.
- Ações proibidas: nenhuma ferramenta de `DELETE` de lançamentos nem de transferência entre carteiras pode ser exposta ou executada pelo agente.
- Isolamento total por usuário: todas as leituras, propostas, confirmações e cancelamentos filtram por `req.usuario.id`.
- Idioma e fuso: respostas, labels e mensagens de erro em `pt-BR`, moeda `BRL`, datas no fuso de Brasília (`obterDataBrasilia()`).

## Review Focus

- **Parcelamento ambíguo e arredondamento de centavos (`modo_valor_parcela: 'total'` vs `'parcela'`):** R$ 100,00 em 3x no modo `'total'` deve gerar 33,33 + 33,33 + 33,34 e exibir ambos os valores no resumo; modo `'parcela'` deve gerar 3x de R$ 100,00 (Total R$ 300,00). *(Testado na Task 2)*
- **Duplo clique / replay em confirmação ou confirmação após cancelamento:** confirmar uma ação já `'confirmada'` ou `'cancelada'` deve falhar com erro 409 sem duplicar lançamentos no banco. *(Testado na Task 2)*
- **Isolamento entre usuários (IDOR):** usuário B não pode confirmar/cancelar ação do usuário A, nem propor lançamento usando `conta_id` ou `lancamento_id` pertencente a outro usuário. *(Testado na Task 2)*
- **Falha graciosa sem `GEMINI_API_KEY` ou cota 429 do Gemini:** o servidor nunca derruba nem retorna 500 cru; retorna erro claro em `pt-BR` (503 para não configurado, 429 para cota atingida). *(Testado na Task 3)*
- **Loop infinito de ferramentas ou excesso de ações em um turno (>5):** o loop para em 5 iterações e rejeita propostas acima de 5 no mesmo turno sem criar linhas órfãs em `agente_acoes_pendentes`. *(Testado na Task 3)*

---

### Task 1: Schema do Banco (SQLite + PostgreSQL), Rate Limiter e Env Config

**Files:**
- Modify: `backend/src/db.js:258-275` (bloco PostgreSQL) e `backend/src/db.js:387-405` (bloco SQLite)
- Modify: `backend/src/security.js:128-140`
- Modify: `backend/.env.example:16-21`
- Modify: `render.yaml:15-22`
- Create: `backend/test/agente.test.js`

**Interfaces:**
- Consumes: `db`, `initDb` de `backend/src/db.js`; `rateLimit` de `express-rate-limit` em `backend/src/security.js`.
- Produces:
  - Tabelas `agente_mensagens (id, usuario_id, papel, conteudo, criado_em)` e `agente_acoes_pendentes (id, usuario_id, mensagem_id, tipo_acao, resumo, payload_json, status, resultado_json, criado_em, resolvido_em)` + índice `idx_agente_mensagens_usuario` e `idx_agente_acoes_mensagem`.
  - `export const agenteRateLimiter` em `backend/src/security.js` (30 req / 15 min por IP).

- [ ] **Step 1: Write the failing test**

Criar `backend/test/agente.test.js` com testes verificando:
1. `agenteRateLimiter` é exportado como função middleware de `../src/security.js`.
2. Após `CREATE TABLE` do schema SQLite para `agente_mensagens` e `agente_acoes_pendentes`, inserir 1 mensagem e 2 ações vinculadas via `mensagem_id` funciona, e deletar o usuário remove mensagens e ações em cascata (`ON DELETE CASCADE`).

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { agenteRateLimiter } from '../src/security.js';

test('agenteRateLimiter é exportado como middleware Express', () => {
  assert.equal(typeof agenteRateLimiter, 'function');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test backend/test/agente.test.js`
Expected: FAIL com `SyntaxError: The requested module '../src/security.js' does not provide an export named 'agenteRateLimiter'`

- [ ] **Step 3: Implement schema in `backend/src/db.js`, `agenteRateLimiter` in `backend/src/security.js`, and env vars in `.env.example` + `render.yaml`**

1. Em `backend/src/db.js`, adicionar em ambos os blocos (`pgPool.query` e `sqliteDb.exec`):
   - `CREATE TABLE IF NOT EXISTS agente_mensagens` com `papel CHECK (papel IN ('usuario', 'assistente'))` e FK `usuario_id -> usuarios(id) ON DELETE CASCADE`.
   - `CREATE TABLE IF NOT EXISTS agente_acoes_pendentes` com `mensagem_id -> agente_mensagens(id) ON DELETE SET NULL`, `tipo_acao CHECK (tipo_acao IN ('criar_lancamento', 'marcar_pago', 'criar_meta', 'criar_despesa_fixa'))`, `status CHECK (status IN ('pendente', 'confirmada', 'cancelada'))`, e FK `usuario_id -> usuarios(id) ON DELETE CASCADE`.
   - Índices `idx_agente_mensagens_usuario (usuario_id, id)` e `idx_agente_acoes_mensagem (mensagem_id)`.
2. Em `backend/src/security.js`, exportar `agenteRateLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false, message: { erro: 'Muitas mensagens para o assistente em pouco tempo. Aguarde alguns minutos e tente novamente.' } })`.
3. Em `backend/.env.example` e `render.yaml`, adicionar `GEMINI_API_KEY` (`sync: false` no Render) e `GEMINI_MODEL=gemini-2.5-flash` (comentado/opcional no `.env.example`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --prefix backend test`
Expected: PASS (todos os 14 testes existentes + novo teste em `agente.test.js`).

- [ ] **Step 5: Commit**

```bash
git add backend/src/db.js backend/src/security.js backend/.env.example render.yaml backend/test/agente.test.js
git commit -m "feat(agente): adicionar tabelas do agente, rate limiter e variaveis Gemini"
```

---

### Task 2: Ferramentas de Leitura, Propostas e Confirmação Transacional (`backend/src/agente-tools.js`)

**Files:**
- Create: `backend/src/agente-tools.js`
- Modify: `backend/test/agente.test.js`

**Interfaces:**
- Consumes: `db` (interface `{ get, all, run, insert, transaction }`) injetável; `obterDataBrasilia` de `./notificacoes.js`.
- Produces (todos exportados de `backend/src/agente-tools.js`):
  - `DECLARACOES_FERRAMENTAS`: array de declarações Gemini (`name`, `description`, `parameters`) contendo exatamente 7 ferramentas de leitura (`obter_resumo_financeiro`, `listar_carteiras`, `listar_lancamentos`, `resumo_dividas_e_cartoes`, `listar_despesas_fixas`, `listar_metas`, `projetar_proximos_meses`) e 4 ferramentas de proposta (`propor_criar_lancamento`, `propor_marcar_pago`, `propor_criar_meta`, `propor_criar_despesa_fixa`).
  - `FERRAMENTAS_PROPOSTA`: `Set` com os 4 nomes `propor_*`.
  - `executarFerramentaLeitura(nome, args, usuarioId, { db, hojeIso }) => Promise<object>`
  - `criarPropostaAcao(nome, args, usuarioId, { db, hojeIso }) => Promise<{ acao, resumoParaModelo }>`
  - `confirmarAcaoPendente(acaoId, usuarioId, { db }) => Promise<{ acao, resultado }>` (lança erro com `.status = 404` se não encontrada/de outro usuário e `.status = 409` se não estiver `'pendente'`)
  - `cancelarAcaoPendente(acaoId, usuarioId, { db }) => Promise<{ acao }>` (lança `.status = 404` ou `.status = 409`)

- [ ] **Step 1: Write the failing tests in `backend/test/agente.test.js`**

Criar helper de banco SQLite temporário em `backend/test/agente.test.js` (com o mesmo wrapper `{ get, all, run, insert, transaction }` e todas as tabelas reais) e adicionar 6 testes cobrindo:
1. `DECLARACOES_FERRAMENTAS` contém apenas as 7 ferramentas de leitura + 4 de proposta (nenhuma contendo `excluir`, `deletar`, `delete` ou `transferir`).
2. Ferramentas de leitura (`obter_resumo_financeiro`, `listar_carteiras`, `resumo_dividas_e_cartoes`, `projetar_proximos_meses`) retornam apenas dados do `usuarioId` informado e saldos corretos.
3. `propor_criar_lancamento` com `tipo: 'divida'`, `parcelas: 3`, `valor: 100`, `modo_valor_parcela: 'total'` NÃO insere em `lancamentos` antes da confirmação, gera resumo mostrando `3x de R$ 33,33` e `Total: R$ 100,00`, e ao chamar `confirmarAcaoPendente` cria 3 parcelas (`33.33`, `33.33`, `33.34`) com o mesmo `grupo_parcela` e marca a ação como `'confirmada'`.
4. `propor_criar_lancamento` com `modo_valor_parcela: 'parcela'`, `parcelas: 3`, `valor: 100` gera 3 parcelas de `100` ao confirmar (Total `R$ 300,00`).
5. Replay/duplo clique: chamar `confirmarAcaoPendente` uma segunda vez (ou após `cancelarAcaoPendente`) rejeita com `err.status === 409` e não duplica registros em `lancamentos`.
6. Isolamento (IDOR): usuário B chamando `confirmarAcaoPendente` ou `cancelarAcaoPendente` em ação do usuário A recebe `err.status === 404`; propor lançamento com `conta_id` de outro usuário ignora/rejeita a conta alheia; `propor_marcar_pago` em lançamento de outro usuário falha sem criar proposta.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test backend/test/agente.test.js`
Expected: FAIL com `ERR_MODULE_NOT_FOUND` para `../src/agente-tools.js`

- [ ] **Step 3: Implement `backend/src/agente-tools.js`**

Implementar em `backend/src/agente-tools.js`:
- `somarMesesSeguro(dataIso, meses)` (mesma lógica de preservação do dia de vencimento do `server.js`).
- `DECLARACOES_FERRAMENTAS` no formato Gemini `functionDeclarations` (JSON Schema OpenAPI subset: `type: 'OBJECT'`, `properties`, `required`).
- As 7 ferramentas de leitura consultando via `db` injetado (sempre `WHERE usuario_id = ?`), com `listar_lancamentos` limitado a no máximo 50 linhas e `projetar_proximos_meses` entre 1 e 12 meses (combinando `salario_fixo`, `despesas_fixas` ativas e `lancamentos` pendentes por mês).
- As 4 ferramentas de proposta validando campos (valor > 0, data `YYYY-MM-DD` com default `hojeIso`, `conta_id` pertencente ao `usuario_id`, `lancamento_id` pertencente ao `usuario_id` e `status = 'pendente'`, `modo_valor_parcela` obrigatório quando `parcelas > 1`), montando `resumo` legível em `pt-BR` e inserindo em `agente_acoes_pendentes` com `status = 'pendente'`.
- `confirmarAcaoPendente(acaoId, usuarioId, { db })` usando `db.transaction(async (tx) => ...)`: atualiza condicionalmente `WHERE id = ? AND usuario_id = ? AND status = 'pendente'` (evita race condition de duplo clique), executa a operação real (`criar_lancamento` simples ou parcelado com ajuste de centavos na última parcela, `marcar_pago`, `criar_meta`, `criar_despesa_fixa`) e grava `resultado_json` + `resolvido_em`.
- `cancelarAcaoPendente(acaoId, usuarioId, { db })` verificando propriedade e status `'pendente'`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --prefix backend test`
Expected: PASS (todos os testes de `backend.test.js` e `agente.test.js`).

- [ ] **Step 5: Commit**

```bash
git add backend/src/agente-tools.js backend/test/agente.test.js
git commit -m "feat(agente): implementar ferramentas de leitura, propostas e confirmacao transacional"
```

---

### Task 3: Orquestrador do Agente e Cliente Google Gemini (`backend/src/agente.js`)

**Files:**
- Create: `backend/src/agente.js`
- Modify: `backend/test/agente.test.js`

**Interfaces:**
- Consumes: `DECLARACOES_FERRAMENTAS`, `FERRAMENTAS_PROPOSTA`, `executarFerramentaLeitura`, `criarPropostaAcao` de `./agente-tools.js`; `obterDataBrasilia` de `./notificacoes.js`.
- Produces (todos exportados de `backend/src/agente.js`):
  - `obterStatusAgente(env = process.env) => { configurado: boolean, modelo: string }`
  - `carregarHistoricoAgente(usuarioId, { db, limite = 50 }) => Promise<Array<{ id, papel, conteudo, criado_em, acoes }>>`
  - `limparHistoricoAgente(usuarioId, { db }) => Promise<{ ok: true }>`
  - `processarMensagemAgente({ usuarioId, mensagem, db, chamarGemini?, env?, hojeIso? }) => Promise<{ mensagemUsuario, mensagemAssistente, acoesPendentes }>`

- [ ] **Step 1: Write the failing tests in `backend/test/agente.test.js`**

Adicionar 5 testes usando `chamarGemini` mockado (sem rede):
1. **Fluxo de leitura (tool calling):** mock retorna `functionCall: { name: 'obter_resumo_financeiro', args: {} }` na 1ª chamada e texto final na 2ª; verifica que a mensagem do usuário e a do assistente são persistidas e retornadas em `carregarHistoricoAgente`.
2. **Múltiplas propostas em 1 turno + limite de 5:** mock emite 6 chamadas `propor_criar_lancamento` no mesmo turno; verifica que exatamente 5 ações são criadas e vinculadas via `mensagem_id` à mensagem do assistente, e a 6ª é recusada sem criar linha órfã no banco.
3. **Sem `GEMINI_API_KEY`:** `obterStatusAgente({})` retorna `{ configurado: false, modelo: 'gemini-2.5-flash' }` e `processarMensagemAgente` rejeita com `err.status === 503` e mensagem amigável mencionando `GEMINI_API_KEY`.
4. **Cota 429 do Gemini:** mock lança erro de status 429; `processarMensagemAgente` rejeita com `err.status === 429` e mensagem amigável em `pt-BR` sem gravar mensagem vazia do assistente.
5. **Trava de 5 iterações:** mock sempre retorna `functionCall` de leitura; o loop encerra na 5ª iteração e devolve resposta segura de fallback sem entrar em loop infinito.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test backend/test/agente.test.js`
Expected: FAIL com `ERR_MODULE_NOT_FOUND` para `../src/agente.js`

- [ ] **Step 3: Implement `backend/src/agente.js`**

Implementar em `backend/src/agente.js`:
- `chamarGeminiPadrao({ apiKey, modelo, systemInstruction, contents, tools })`: POST para `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent` com header `x-goog-api-key: apiKey` (evitando vazar a chave na URL/logs), `signal: AbortSignal.timeout(25000)`. Mapeia HTTP 429 -> erro `{ status: 429, message: 'Limite gratuito da IA atingido no momento. Aguarde um minuto e tente novamente.' }` e timeout/rede -> `{ status: 502, message: 'Não consegui falar com a IA agora. Tente novamente em instantes.' }`.
- `montarSystemPrompt(hojeIso)`: instruções claras em `pt-BR` informando a data de hoje em Brasília, determinando consultar ferramentas antes de responder números, sempre usar `propor_*` para escrita, esclarecer `modo_valor_parcela` em parcelamentos, e recusar educadamente pedidos de exclusão de lançamentos ou transferências entre carteiras.
- `processarMensagemAgente`: valida `GEMINI_API_KEY` (503 se ausente), carrega últimas 14 mensagens de `agente_mensagens` como contexto, salva mensagem do usuário, executa loop de até 5 iterações processando `functionCall`s (leitura ou proposta com teto de 5 propostas/turno), salva mensagem do assistente e faz `UPDATE agente_acoes_pendentes SET mensagem_id = ? WHERE id IN (...)` para todas as ações propostas no turno.
- `carregarHistoricoAgente`: busca últimas `limite` mensagens ordenadas cronologicamente e anexa o array `acoes` (com `payload` parseado) correspondente a cada `mensagem_id`.
- `limparHistoricoAgente`: cancela ações `'pendente'` do usuário e remove suas linhas de `agente_mensagens`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --prefix backend test`
Expected: PASS (todos os testes).

- [ ] **Step 5: Commit**

```bash
git add backend/src/agente.js backend/test/agente.test.js
git commit -m "feat(agente): implementar orquestrador Gemini com tool calling e historico"
```

---

### Task 4: Rotas HTTP do Agente no Express (`backend/src/server.js`)

**Files:**
- Modify: `backend/src/server.js:15-32` (imports) e antes de `app.get('*', ...)` (~linha 2080)

**Interfaces:**
- Consumes: `agenteRateLimiter` de `./security.js`; `obterStatusAgente`, `carregarHistoricoAgente`, `limparHistoricoAgente`, `processarMensagemAgente` de `./agente.js`; `confirmarAcaoPendente`, `cancelarAcaoPendente` de `./agente-tools.js`.
- Produces (rotas REST sob `/api/agente`, todas protegidas por `autenticar`):
  - `GET /api/agente/status` -> `{ configurado, modelo }`
  - `GET /api/agente/historico` -> `{ mensagens }`
  - `POST /api/agente/mensagem` (com `agenteRateLimiter`) -> body `{ mensagem }` (1..1500 chars) -> `{ mensagemUsuario, mensagemAssistente, acoesPendentes }`
  - `POST /api/agente/acoes/:id/confirmar` -> `{ ok: true, acao, resultado }`
  - `POST /api/agente/acoes/:id/cancelar` -> `{ ok: true, acao }`
  - `DELETE /api/agente/historico` -> `{ ok: true }`

- [ ] **Step 1: Add routes and validation in `backend/src/server.js`**

Importar `agenteRateLimiter` de `./security.js`, as funções de `./agente.js` e `confirmarAcaoPendente`/`cancelarAcaoPendente` de `./agente-tools.js`. Registrar as 6 rotas com `asyncHandler`, validando `mensagem` (string não vazia, `<= 1500` chars -> 400) e `id` numérico inteiro positivo (`-> 400`), repassando `err.status` (400/404/409/429/502/503) no JSON `{ erro: err.message }`.

- [ ] **Step 2: Verify backend syntax and full test suite**

Run: `node --check backend/src/server.js && npm --prefix backend test`
Expected: `node --check` sem erros e todos os testes PASS.

- [ ] **Step 3: Commit**

```bash
git add backend/src/server.js
git commit -m "feat(agente): expor rotas autenticadas /api/agente no Express"
```

---

### Task 5: Interface da Gaveta de Chat e Cartões de Confirmação no Frontend

**Files:**
- Modify: `frontend/src/api.js:200-231`
- Create: `frontend/src/components/AgenteDrawer.jsx`
- Modify: `frontend/src/components/Dashboard.jsx:15-25` (import), estado `agenteAberto`, e `1085-1105` (botão flutuante FAB + `<AgenteDrawer />`)
- Modify: `frontend/src/styles.css` (estilos do FAB, gaveta de chat, bolhas, chips, cartão de confirmação e tema escuro)

**Interfaces:**
- Consumes: rotas `/api/agente/*` via `api.agenteStatus()`, `api.agenteHistorico()`, `api.agenteEnviarMensagem(mensagem)`, `api.agenteConfirmarAcao(id)`, `api.agenteCancelarAcao(id)`, `api.agenteLimparHistorico()` em `frontend/src/api.js`; prop `onDadosAlterados={() => carregarDados(mes)}` de `Dashboard.jsx`.
- Produces: componente `<AgenteDrawer aberto onFechar onDadosAlterados />` e botão flutuante acessível em todas as abas do `Dashboard`.

- [ ] **Step 1: Add agent API methods in `frontend/src/api.js`**

Adicionar ao objeto `api`:
- `agenteStatus: () => requisicao('/agente/status')`
- `agenteHistorico: () => requisicao('/agente/historico')`
- `agenteEnviarMensagem: (mensagem) => requisicao('/agente/mensagem', { method: 'POST', body: JSON.stringify({ mensagem }) })`
- `agenteConfirmarAcao: (id) => requisicao(`/agente/acoes/${id}/confirmar`, { method: 'POST' })`
- `agenteCancelarAcao: (id) => requisicao(`/agente/acoes/${id}/cancelar`, { method: 'POST' })`
- `agenteLimparHistorico: () => requisicao('/agente/historico', { method: 'DELETE' })`

- [ ] **Step 2: Create `frontend/src/components/AgenteDrawer.jsx`**

Implementar seguindo o padrão do `PerfilDrawer.jsx`:
- Fecha com `Escape` e clique no backdrop.
- Ao abrir (`aberto === true`), carrega `api.agenteStatus()` e `api.agenteHistorico()`.
- Se `status.configurado === false`, mostra banner explicando que basta definir `GEMINI_API_KEY` no servidor (`.env` ou Render) para ativar o assistente, desabilitando o envio.
- Estado vazio: boas-vindas + 4 chips clicáveis (*"Como está meu mês?"*, *"Quanto sobra depois das dívidas?"*, *"Lançar um gasto"*, *"Posso parcelar uma compra?"*).
- Lista de mensagens com auto-scroll para o final, indicador visual de carregamento (*"Analisando suas finanças..."*) e renderização de `msg.acoes` (0..N cartões por mensagem):
  - `status === 'pendente'`: botões **Confirmar** e **Cancelar** (desabilitados enquanto a ação está sendo processada para evitar duplo clique).
  - `status === 'confirmada'`: badge verde **Confirmado**.
  - `status === 'cancelada'`: badge neutra **Cancelado**.
- Ao confirmar com sucesso, atualiza o estado local da ação para `'confirmada'` e chama `onDadosAlterados()`.
- Cabeçalho com título *"Assistente Financeiro"*, botão *"Limpar conversa"* (quando houver mensagens) e botão fechar (`×`).
- Campo de texto com `Enter` para enviar (`Shift+Enter` para quebra de linha) e limite de 1500 caracteres.

- [ ] **Step 3: Wire FAB and `<AgenteDrawer />` in `frontend/src/components/Dashboard.jsx` and add styles in `frontend/src/styles.css`**

1. Em `Dashboard.jsx`: adicionar `const [agenteAberto, setAgenteAberto] = useState(false);`, renderizar botão flutuante (`className="agente-fab"`, `aria-label="Abrir assistente financeiro"`) e `<AgenteDrawer aberto={agenteAberto} onFechar={() => setAgenteAberto(false)} onDadosAlterados={() => carregarDados(mes)} />`.
2. Em `frontend/src/styles.css`: adicionar estilos usando as variáveis CSS existentes (`--surface`, `--bg`, `--text`, `--border`, `--primary`, etc.) para que funcione automaticamente nos modos claro e escuro e em telas mobile (PWA).

- [ ] **Step 4: Build frontend and run full test suite**

Run: `npm --prefix frontend run build && npm --prefix backend test`
Expected: Vite build concluído sem erros e todos os testes do backend PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api.js frontend/src/components/AgenteDrawer.jsx frontend/src/components/Dashboard.jsx frontend/src/styles.css
git commit -m "feat(agente): adicionar gaveta de chat IA e cartoes de confirmacao no Dashboard"
```
