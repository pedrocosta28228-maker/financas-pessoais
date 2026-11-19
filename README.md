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

## Progresso do Desenvolvimento (v1 — Concluída)
- [x] Configuração do ambiente (Node.js, Git e `.gitignore`)
- [x] Backend em Node.js + tabelas SQL no SQLite
- [x] Sistema de Cadastro e Login seguro (Hash + JWT)
- [x] Interface em React (Login + Dashboard clean com gráfico de balanço)
- [x] Parcelamento automático de dívidas agrupadas em acordeão + edição
- [x] Pop-up ao pagar/adiantar parcelas (com opção de abater do saldo ou marcar pago por fora + desfazer)

## Próximos Passos — Lista de Afazeres (v2)
- [ ] **Barra lateral de navegação:** separar em abas (*Visão Geral*, *Entradas/Contas*, *Saídas*, *Dívidas*, *Despesas Fixas*, *Estatísticas* e *Metas*)
- [ ] **Onde está meu dinheiro (Contas e Rendimentos):** detalhar em qual banco/cofrinho cada valor está (ex.: R$ 1.000 rendendo % do CDI, R$ 400 no cofrinho, R$ 100 para uso diário)
- [ ] **Salário fixo recorrente ("Vai Entrar"):** prever o salário dos próximos meses com edição rápida para horas extras
- [ ] **Despesas fixas mensais:** controle e resumo das contas recorrentes de todo mês
- [ ] **Aba de Estatísticas e Projeção:** histórico de tudo que já entrou, gráfico de evolução do saldo futuro com base no salário e comparativo mensal Salário × Dívidas
- [ ] **Metas financeiras:** definir quanto deseja juntar e acompanhar a barra de progresso
