# Finanças Pessoais — App Web Local

Aplicativo web pessoal para organização de finanças (entradas, saídas, dívidas e controle mensal), com autenticação segura e banco de dados local.

## Tecnologias
- **Frontend:** React + Vite
- **Backend:** Node.js + Express
- **Banco de Dados:** SQLite (SQL)
- **Autenticação:** Hash de senha + JWT (JSON Web Token)

## Estrutura do Projeto
```text
financeiro/
├── backend/   # Servidor Node.js, rotas da API, autenticação e banco SQLite
└── frontend/  # Interface web em React
```

## Progresso do Desenvolvimento
- [x] Configuração do ambiente (Node.js, Git e `.gitignore`)
- [x] Backend em Node.js + tabelas SQL no SQLite
- [x] Sistema de Cadastro e Login seguro (Hash + JWT)
- [ ] Interface em React (Login + Dashboard de Entradas, Saídas e Dívidas)
