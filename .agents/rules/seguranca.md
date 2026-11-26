# Regras de Segurança do Projeto — Minhas Finanças

Ao adicionar ou modificar qualquer rota, consulta SQL, componente frontend ou ferramenta do Agente de IA neste repositório, garantir obrigatoriamente os 6 pilares abaixo:

1. **Sem rotas administrativas expostas:** nenhuma rota `/admin` ou `/api/admin` sem autenticação + autorização no servidor; rotas de sistema (como `/api/cron/notificacoes`) exigem segredo >= 16 chars com `timingSafeEqual` e rate limit.
2. **Zero IDOR / BOLA:** toda query de recursos do usuário exige `usuario_id = ?` usando `req.usuario.id` vindo do JWT verificado; validar `validarIdPositivo(req.params.id)` em toda rota `:id` antes de consultar o banco.
3. **Zero segredos no cliente/Git:** `GEMINI_API_KEY`, `BREVO_API_KEY`, `JWT_SECRET`, `DATABASE_URL` e `CRON_SECRET` ficam apenas no backend (`process.env`). Nunca vazar stack traces ou erros brutos de APIs externas para o cliente.
4. **Autenticação e Reset blindados:** `scrypt` + `timingSafeEqual`, Prepared Statements, `JWT_SECRET` Fail-Fast em produção, `algorithms: ['HS256']`, invalidação de sessões via `token_version` ao trocar/redefinir senha e limite de 5 tentativas por código em `reset_senhas`.
5. **Frontend e Build seguros:** `build.sourcemap = false` no `vite.config.js`, `helmet` com CSP, CORS restrito em produção e proibido usar `dangerouslySetInnerHTML`/`innerHTML` sem sanitização estrita (inclusive ao renderizar Markdown da IA no futuro).
6. **Agente de IA seguro por arquitetura:** nunca expor ferramentas de exclusão de lançamentos nem transferências entre carteiras; injetar `usuarioId` no servidor; exigir confirmação em 1 clique com limites de tamanho/valor e expiração; tratar dados do banco como não confiáveis no system prompt; manter rate limit por usuário autenticado.
