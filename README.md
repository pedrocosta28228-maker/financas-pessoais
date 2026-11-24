# Minhas Finanças — Controle Financeiro Pessoal (Full-Stack & PWA)

Aplicativo web completo para organização financeira pessoal (entradas, carteiras, saídas, despesas fixas, dívidas parceladas, metas e lembretes automáticos por e-mail), pronto para rodar localmente com SQLite ou na nuvem com PostgreSQL + Render.

**Aplicação online:** https://financas-pessoais-48y1.onrender.com

## Principais Funcionalidades
- **Landing Page, Cadastro e Login Seguro:** senhas com hash `scrypt` + *salt* aleatório, sessão via **JWT** e fluxo completo de **Esqueci minha senha** (código de 6 dígitos com validade de 15 min via Brevo).
- **Visão Geral (Geral e Por Mês):** acompanhamento de *Saldo disponível*, *Previsto para entrar*, *Saídas pagas* e *A pagar*, com gráficos interativos e calendário visual do mês.
- **Dívidas e Cartões:** geração automática de parcelas em transação SQL, edição em lote do grupo de parcelas, resumo por cartão/pessoa e calendário de vencimentos com pagamento em 1 clique.
- **Entradas, Carteiras e Salário Fixo:** múltiplas carteiras com transferência atômica entre contas e salário recorrente.
- **Despesas Fixas, Estatísticas e Metas:** controle de contas mensais recorrentes, projeção de 12 meses (dívidas × salário) e acompanhamento visual de metas financeiras.
- **Lembretes Automáticos por E-mail (08h Brasília):**
  - **Aviso no dia do vencimento** (e opção de aviso na véspera) listando dívidas pendentes e despesas fixas ativas com valor e para quem/qual cartão pagar.
  - **Resumo mensal perto do salário** com salário previsto, total das contas do mês, sobra prevista e calendário cronológico.
  - **Preferências e testes em Minha conta:** ligar/desligar avisos, ajustar antecedência e disparar e-mail de teste na hora, com trava anti-duplicidade no banco.
- **Tema Claro/Escuro, Exportação e PWA:** modo claro padrão + modo escuro grafite, fonte *Inter*, exportação `CSV`/`JSON` e instalável na tela inicial do celular.

## Tecnologias
- **Frontend:** React 19 + Vite + PWA (`manifest.json` + Service Worker)
- **Backend:** Node.js + Express (`helmet`, `express-rate-limit`, CORS restrito)
- **Banco de Dados Duplo (Adapter):** SQLite (`node:sqlite`) no ambiente local e **PostgreSQL (Neon.tech)** em produção
- **E-mail & Automação:** API transacional **Brevo** (HTTPS nativo) + **GitHub Actions** (cron diário às 08h BRT)
- **Deploy:** Render.com (`render.yaml`)

## Estrutura do Projeto
```text
financeiro/
├── .github/workflows/  # Cron diário às 08h BRT (GitHub Actions)
├── backend/            # API Node.js/Express, autenticação, e-mails, banco duplo e testes
├── frontend/           # Interface React + Vite + PWA
├── render.yaml         # Blueprint de deploy no Render.com
└── iniciar-app.bat     # Atalho rápido no Windows para abrir localmente
```

## Como rodar localmente
1. Copie o arquivo de variáveis de ambiente do backend:
   ```bash
   cp backend/.env.example backend/.env
   ```
2. Instale as dependências:
   ```bash
   npm --prefix backend install
   npm --prefix frontend install
   ```
3. Rode os testes automatizados (14 testes):
   ```bash
   npm test
   ```
4. Inicie o backend e o frontend (ou dê duplo clique em `iniciar-app.bat`):
   ```bash
   npm --prefix backend start
   npm --prefix frontend run dev
   ```
5. Acesse no navegador: `http://localhost:5173`

## Progresso do Desenvolvimento
- [x] Configuração do ambiente (Node.js, Git e `.gitignore`)
- [x] Backend em Node.js + 9 tabelas SQL (`usuarios`, `contas`, `lancamentos`, `salario_fixo`, `metas`, `despesas_fixas`, `reset_senhas`, `notificacoes_config`, `notificacoes_enviadas`)
- [x] Sistema de Cadastro e Login seguro (`scrypt` + JWT)
- [x] Barra lateral recolhível com abas (*Visão Geral*, *Entradas & Carteiras*, *Dívidas e Cartões*, *Saídas*, *Estatísticas* e *Metas*)
- [x] Carteiras com etiqueta de rendimento opcional + transferência entre contas via Transação SQL
- [x] Dívidas parceladas agrupadas em acordeão, edição em lote de parcelas, resumo por cartão/pessoa e calendário visual interativo
- [x] Salário fixo recorrente + despesas fixas mensais integradas na projeção de 12 meses
- [x] Aba de Estatísticas (projeção de saldo, queda das dívidas × salário) e aba de Metas financeiras
- [x] Tema Claro e Modo Escuro grafite com fonte *Inter*, botão Lua/Sol no topo e tooltips `?`
- [x] Landing Page pública interativa + tela de Login moderna com **Esqueci minha senha** via Brevo
- [x] Menu de Perfil em gaveta lateral (*Minha conta* com avatar, troca de senha, preferências de lembretes, exportação `CSV`/`JSON` e *Central de Ajuda*)
- [x] Lembretes automáticos por e-mail (vencimento às 08h + resumo mensal perto do salário) com **Brevo + GitHub Actions** e anti-duplicidade
- [x] Blindagem de produção (`helmet`, `express-rate-limit`, CORS restrito, Fail-Fast em `JWT_SECRET`, `timingSafeEqual` em segredos e escape XSS em e-mails)
- [x] Adapter de banco duplo: **SQLite local** e **PostgreSQL na nuvem (Neon.tech)** via `DATABASE_URL`
- [x] Deploy online gratuito no **Render.com** (`render.yaml`) + suporte a **PWA**
- [x] Testes automatizados do backend com `node --test` (14/14 passando)

## Próximos Passos (Futuro — v3)
- [ ] **Automação bancária:** importação de extratos/faturas (`CSV` / `OFX`) ou integração com Open Finance (ex.: Pluggy / Belvo)
