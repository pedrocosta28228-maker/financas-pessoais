import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';
import { hashSenha, verificarSenha, gerarToken, autenticar } from './auth.js';

/**
 * Soma N meses a uma data YYYY-MM-DD preservando o dia de vencimento
 * (ex.: 2026-01-31 + 1 mês = 2026-02-28, e + 2 meses = 2026-03-31).
 */
function somarMesesSeguro(dataIso, mesesParaSomar) {
  const [anoOrig, mesOrig, diaOrig] = dataIso.split('-').map(Number);
  const totalMeses = anoOrig * 12 + (mesOrig - 1) + mesesParaSomar;
  const novoAno = Math.floor(totalMeses / 12);
  const novoMes = (totalMeses % 12) + 1;
  const ultimoDiaDoMes = new Date(novoAno, novoMes, 0).getDate();
  const diaFinal = Math.min(diaOrig, ultimoDiaDoMes);

  return `${novoAno}-${String(novoMes).padStart(2, '0')}-${String(diaFinal).padStart(2, '0')}`;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// Middlewares globais: libera acesso do React (CORS) e permite ler JSON no corpo das requisições
app.use(cors());
app.use(express.json());

// Rota simples para testar se o servidor está no ar
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, mensagem: 'API Financeiro rodando!' });
});

// ============================================================================
// ROTAS DE AUTENTICAÇÃO (Cadastro, Login e Usuário Logado)
// ============================================================================

// 1. Criar nova conta
app.post('/api/auth/register', (req, res) => {
  const { nome, email, senha } = req.body;

  if (!nome?.trim() || !email?.trim() || !senha) {
    return res.status(400).json({ erro: 'Preencha nome, e-mail e senha.' });
  }

  if (senha.length < 6) {
    return res.status(400).json({ erro: 'A senha precisa ter pelo menos 6 caracteres.' });
  }

  const emailLimpo = email.trim().toLowerCase();

  // Verifica no SQL se já existe uma conta com esse e-mail
  const existente = db
    .prepare('SELECT id FROM usuarios WHERE email = ?')
    .get(emailLimpo);

  if (existente) {
    return res.status(409).json({ erro: 'Já existe uma conta cadastrada com este e-mail.' });
  }

  const senhaCriptografada = hashSenha(senha);

  // INSERT com "?" (Prepared Statement) evita ataques de SQL Injection
  const resultado = db
    .prepare('INSERT INTO usuarios (nome, email, senha_hash) VALUES (?, ?, ?)')
    .run(nome.trim(), emailLimpo, senhaCriptografada);

  const novoUsuario = {
    id: Number(resultado.lastInsertRowid),
    nome: nome.trim(),
    email: emailLimpo,
  };

  const token = gerarToken(novoUsuario);

  return res.status(201).json({ usuario: novoUsuario, token });
});

// 2. Fazer login
app.post('/api/auth/login', (req, res) => {
  const { email, senha } = req.body;

  if (!email?.trim() || !senha) {
    return res.status(400).json({ erro: 'Informe seu e-mail e sua senha.' });
  }

  const emailLimpo = email.trim().toLowerCase();

  const usuarioDb = db
    .prepare('SELECT id, nome, email, senha_hash FROM usuarios WHERE email = ?')
    .get(emailLimpo);

  if (!usuarioDb || !verificarSenha(senha, usuarioDb.senha_hash)) {
    return res.status(401).json({ erro: 'E-mail ou senha incorretos.' });
  }

  const usuario = {
    id: usuarioDb.id,
    nome: usuarioDb.nome,
    email: usuarioDb.email,
  };

  const token = gerarToken(usuario);

  return res.json({ usuario, token });
});

// 3. Consultar quem está logado (rota protegida pelo middleware "autenticar")
app.get('/api/auth/me', autenticar, (req, res) => {
  res.json({ usuario: req.usuario });
});

// ============================================================================
// ROTAS DE FINANÇAS (Todas protegidas — só funcionam com Login!)
// ============================================================================

// 4. Listar lançamentos de um mês (ex.: /api/lancamentos?mes=2026-11) e calcular resumo
app.get('/api/lancamentos', autenticar, (req, res) => {
  const { mes } = req.query; // Formato esperado: YYYY-MM

  let lancamentos;

  if (mes && /^\d{4}-\d{2}$/.test(mes)) {
    lancamentos = db
      .prepare(`
        SELECT id, titulo, valor, tipo, categoria, data, status, observacao, criado_em
        FROM lancamentos
        WHERE usuario_id = ? AND substr(data, 1, 7) = ?
        ORDER BY data DESC, id DESC
      `)
      .all(req.usuario.id, mes);
  } else {
    lancamentos = db
      .prepare(`
        SELECT id, titulo, valor, tipo, categoria, data, status, observacao, criado_em
        FROM lancamentos
        WHERE usuario_id = ?
        ORDER BY data DESC, id DESC
      `)
      .all(req.usuario.id);
  }

  // Calcula os totais do mês: o que entrou, o que saiu e o que ainda vai sair
  const resumo = lancamentos.reduce(
    (acc, item) => {
      if (item.tipo === 'entrada') {
        if (item.status === 'pago') {
          acc.entradasRecebidas += item.valor;
        } else {
          acc.entradasPrevistas += item.valor;
        }
      } else {
        // Tanto "saida" quanto "divida" contam como negativo
        if (item.status === 'pago') {
          acc.saidasPagas += item.valor;
        } else {
          acc.saidasAPagar += item.valor;
        }

        if (item.tipo === 'divida' && item.status === 'pendente') {
          acc.dividasPendentes += item.valor;
        }
      }
      return acc;
    },
    {
      entradasRecebidas: 0,
      entradasPrevistas: 0,
      saidasPagas: 0,
      saidasAPagar: 0,
      dividasPendentes: 0,
    }
  );

  // Saldo Real = o que já entrou menos o que já saiu
  const saldoReal = resumo.entradasRecebidas - resumo.saidasPagas;
  // Saldo Previsto = considerando tudo que ainda vai entrar e tudo que ainda vai sair
  const saldoPrevisto =
    resumo.entradasRecebidas +
    resumo.entradasPrevistas -
    (resumo.saidasPagas + resumo.saidasAPagar);

  return res.json({
    lancamentos,
    resumo: {
      ...resumo,
      saldoReal,
      saldoPrevisto,
    },
  });
});

// 5. Criar novo lançamento (entrada, saída ou dívida — com suporte a parcelamento!)
app.post('/api/lancamentos', autenticar, (req, res) => {
  const {
    titulo,
    valor,
    tipo,
    categoria,
    data,
    status,
    observacao,
    parcelas,
    modoValorParcela,
  } = req.body;

  const valorNumero = Number(valor);
  const tiposValidos = ['entrada', 'saida', 'divida'];
  const statusValidos = ['pago', 'pendente'];

  if (!titulo?.trim()) {
    return res.status(400).json({ erro: 'Informe uma descrição (título) para o lançamento.' });
  }
  if (!Number.isFinite(valorNumero) || valorNumero <= 0) {
    return res.status(400).json({ erro: 'Informe um valor maior que zero.' });
  }
  if (!tiposValidos.includes(tipo)) {
    return res.status(400).json({ erro: 'Tipo inválido. Use: entrada, saida ou divida.' });
  }
  if (!data || !/^\d{4}-\d{2}-\d{2}$/.test(data)) {
    return res.status(400).json({ erro: 'Informe uma data válida (AAAA-MM-DD).' });
  }

  const totalParcelas =
    tipo === 'divida' ? Math.max(1, Math.min(60, Math.floor(Number(parcelas) || 1))) : 1;

  const statusFinal = statusValidos.includes(status) ? status : 'pago';
  const categoriaFinal = categoria?.trim() || 'Geral';
  const observacaoFinal = observacao?.trim() || '';

  const insertStmt = db.prepare(`
    INSERT INTO lancamentos (usuario_id, titulo, valor, tipo, categoria, data, status, observacao, grupo_parcela)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const selectById = db.prepare(`
    SELECT id, titulo, valor, tipo, categoria, data, status, observacao, grupo_parcela, criado_em
    FROM lancamentos WHERE id = ?
  `);

  // Se for dívida parcelada (2x ou mais), grava todas as parcelas juntas numa Transação SQL
  if (totalParcelas > 1) {
    const grupoId = crypto.randomUUID();
    const dividirTotal = modoValorParcela === 'total';
    const valorBase = dividirTotal
      ? Math.floor((valorNumero / totalParcelas) * 100) / 100
      : Math.round(valorNumero * 100) / 100;
    const diferencaCentavos = dividirTotal
      ? Math.round((valorNumero - valorBase * totalParcelas) * 100) / 100
      : 0;

    const criados = [];

    db.exec('BEGIN');
    try {
      for (let i = 0; i < totalParcelas; i++) {
        const dataParcela = somarMesesSeguro(data, i);
        const tituloParcela = `${titulo.trim()} (${i + 1}/${totalParcelas})`;
        // Se dividiu um valor com dízima (ex.: R$ 100 / 3), ajusta os centavos na última parcela
        const valorParcela =
          i === totalParcelas - 1
            ? Math.round((valorBase + diferencaCentavos) * 100) / 100
            : valorBase;

        const resultado = insertStmt.run(
          req.usuario.id,
          tituloParcela,
          valorParcela,
          tipo,
          categoriaFinal,
          dataParcela,
          statusFinal,
          observacaoFinal,
          grupoId
        );

        criados.push(selectById.get(Number(resultado.lastInsertRowid)));
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    return res.status(201).json({ lancamento: criados[0], lancamentos: criados });
  }

  const resultado = insertStmt.run(
    req.usuario.id,
    titulo.trim(),
    valorNumero,
    tipo,
    categoriaFinal,
    data,
    statusFinal,
    observacaoFinal,
    null
  );

  const criado = selectById.get(Number(resultado.lastInsertRowid));
  return res.status(201).json({ lancamento: criado });
});

// 6. Atualizar status (ex.: marcar uma dívida ou conta pendente como "pago")
app.patch('/api/lancamentos/:id/status', autenticar, (req, res) => {
  const id = Number(req.params.id);
  const { status } = req.body;

  if (!['pago', 'pendente'].includes(status)) {
    return res.status(400).json({ erro: 'Status inválido. Use "pago" ou "pendente".' });
  }

  // O "AND usuario_id = ?" garante que você só altera lançamentos da SUA conta
  const resultado = db
    .prepare('UPDATE lancamentos SET status = ? WHERE id = ? AND usuario_id = ?')
    .run(status, id, req.usuario.id);

  if (resultado.changes === 0) {
    return res.status(404).json({ erro: 'Lançamento não encontrado.' });
  }

  const atualizado = db
    .prepare('SELECT id, titulo, valor, tipo, categoria, data, status, observacao, criado_em FROM lancamentos WHERE id = ?')
    .get(id);

  return res.json({ lancamento: atualizado });
});

// 7. Excluir um lançamento
app.delete('/api/lancamentos/:id', autenticar, (req, res) => {
  const id = Number(req.params.id);

  const resultado = db
    .prepare('DELETE FROM lancamentos WHERE id = ? AND usuario_id = ?')
    .run(id, req.usuario.id);

  if (resultado.changes === 0) {
    return res.status(404).json({ erro: 'Lançamento não encontrado.' });
  }

  return res.json({ ok: true });
});

// Serve o Frontend React compilado (frontend/dist) se existir, permitindo rodar tudo em 1 único servidor
const frontendDist = path.join(__dirname, '..', '..', 'frontend', 'dist');
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
}

app.listen(PORT, '127.0.0.1', () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
