# Finanças Pessoais — App Web Local

Aplicativo web pessoal para organização de finanças (entradas, saídas, dívidas e controle mensal), com autenticação segura e banco de dados local em SQLite.

## Funcionalidades
- **Sistema de Login e Cadastro:** senhas protegidas com hash criptográfico (`scrypt` + `salt`) e sessão via **JWT**.
- **Controle Geral e Mensal:** visão do **Total Geral** por padrão com navegação limpa mês a mês, calculando **Entradas**, **Saídas Pagas**, **Ainda Vai Sair (A Pagar / Dívidas)**, **Saldo Total** e **Saldo Previsto**.
- **Parcelamento Automático de Dívidas:** gere automaticamente N parcelas mensais com a data de vencimento escolhida (usando Transação SQL no SQLite) e acompanhe o total pendente.
- **Gráficos Visuais:** gráfico de rosca (*Raio-X do dinheiro*: livre, pago e a pagar) e gráfico de barras comparativo (resumo geral e gastos por categoria).
- **Gestão de Lançamentos:** modal rápido de **Novo Lançamento**, busca por descrição/categoria, filtros com contador e botão de 1 clique para marcar contas e dívidas como pagas.
- **Privacidade local:** o banco de dados `financas.db` e o arquivo `.env` ficam apenas no seu computador (ignorados pelo `.gitignore`).

## Tecnologias
- **Frontend:** React 19 + Vite
- **Backend:** Node.js + Express
- **Banco de Dados:** SQLite (`node:sqlite`) com SQL e Prepared Statements
- **Autenticação:** `crypto.scryptSync` + JSON Web Token (JWT)

## Estrutura do Projeto
```text
financeiro/
├── backend/         # Servidor Node.js, rotas da API, autenticação e banco SQLite
├── frontend/        # Interface web em React (Login + Dashboard)
└── iniciar-app.bat  # Atalho rápido no Windows para abrir o app
```

## Como rodar localmente
1. Configure a chave secreta do backend:
   ```bash
   cp backend/.env.example backend/.env
   ```
2. Instale as dependências:
   ```bash
   npm --prefix backend install
   npm --prefix frontend install
   ```
3. Inicie o backend e o frontend (em dois terminais) ou dê duplo clique em `iniciar-app.bat`:
   ```bash
   npm --prefix backend start
   npm --prefix frontend run dev
   ```
4. Acesse no navegador: `http://localhost:5173`

## Progresso do Desenvolvimento
- [x] Configuração do ambiente (Node.js, Git e `.gitignore`)
- [x] Backend em Node.js + tabelas SQL no SQLite (`usuarios`, `contas`, `lancamentos`, `salario_fixo`)
- [x] Sistema de Cadastro e Login seguro (Hash `scrypt` + JWT)
- [x] Barra lateral recolhível com abas (*Visão Geral*, *Entradas & Carteiras*, *Dívidas e Cartões*, *Saídas*, *Estatísticas* e *Metas*)
- [x] Carteiras com etiqueta de rendimento opcional + transferência entre contas via Transação SQL
- [x] Dívidas parceladas agrupadas em acordeão, resumo por cartão/pessoa e pop-up de pagamento/adiantamento (do saldo ou por fora + desfazer)
- [x] Salário fixo recorrente com previsão automática do próximo mês
- [x] Aba de Estatísticas com projeção de saldo (12 meses), queda das dívidas × salário e mês previsto de quitação
- [x] Testes automatizados do backend com `node --test`

## Próximos Passos (Futuro)
- [ ] **Aba de Metas financeiras:** objetivos de economia com barra de progresso
- [ ] **Despesas fixas mensais** na aba Saídas
- [ ] **Tema Claro / Escuro** e repaginada visual
- [ ] **Deploy na internet** (HTTPS, rate limit, CORS restrito) e importação automática de faturas (`CSV` / `OFX`)
