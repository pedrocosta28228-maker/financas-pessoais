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

/**
 * Garante que a conta informada existe e pertence ao usuário logado (evita IDOR).
 */
function resolverContaId(contaIdBruto, usuarioId) {
  if (contaIdBruto === undefined || contaIdBruto === null || contaIdBruto === '') {
    return null;
  }
  const id = Number(contaIdBruto);
  if (!Number.isInteger(id) || id <= 0) return null;

  const conta = db
    .prepare('SELECT id FROM contas WHERE id = ? AND usuario_id = ?')
    .get(id, usuarioId);

  return conta ? conta.id : null;
}

const SELECT_LANCAMENTO_BASE = `
  SELECT
    l.id, l.titulo, l.valor, l.tipo, l.categoria, l.data, l.status,
    l.observacao, l.grupo_parcela, l.descontar_saldo, l.conta_id,
    l.origem_divida, l.criado_em,
    c.nome AS conta_nome,
    c.cor AS conta_cor
  FROM lancamentos l
  LEFT JOIN contas c ON c.id = l.conta_id AND c.usuario_id = l.usuario_id
`;

// 4. Listar lançamentos (todos ou de um mês específico) e calcular resumo
app.get('/api/lancamentos', autenticar, (req, res) => {
  const { mes } = req.query; // Formato esperado: YYYY-MM

  let lancamentos;

  if (mes && /^\d{4}-\d{2}$/.test(mes)) {
    lancamentos = db
      .prepare(`
        ${SELECT_LANCAMENTO_BASE}
        WHERE l.usuario_id = ? AND substr(l.data, 1, 7) = ?
        ORDER BY l.data DESC, l.id DESC
      `)
      .all(req.usuario.id, mes);
  } else {
    lancamentos = db
      .prepare(`
        ${SELECT_LANCAMENTO_BASE}
        WHERE l.usuario_id = ?
        ORDER BY l.data DESC, l.id DESC
      `)
      .all(req.usuario.id);
  }

  // Calcula os totais: o que entrou, o que saiu (do saldo) e o que ainda vai sair
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
          if (item.descontar_saldo !== 0) {
            acc.saidasPagas += item.valor;
          } else {
            acc.saidasPagasPorFora += item.valor;
          }
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
      saidasPagasPorFora: 0,
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

// 5. Criar novo lançamento (entrada, saída ou dívida — com suporte a parcelamento, carteira e origem da dívida!)
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
    contaId,
    origemDivida,
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
  const contaIdFinal = resolverContaId(contaId, req.usuario.id);
  const origemDividaFinal = tipo === 'divida' ? (origemDivida?.trim() || '') : '';

  const insertStmt = db.prepare(`
    INSERT INTO lancamentos (
      usuario_id, titulo, valor, tipo, categoria, data, status,
      observacao, grupo_parcela, conta_id, origem_divida
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const selectById = db.prepare(`${SELECT_LANCAMENTO_BASE} WHERE l.id = ?`);

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
          grupoId,
          contaIdFinal,
          origemDividaFinal
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
    null,
    contaIdFinal,
    origemDividaFinal
  );

  const criado = selectById.get(Number(resultado.lastInsertRowid));
  return res.status(201).json({ lancamento: criado });
});

// 6. Atualizar status (marcar como pago/adiantado com opção de descontar do saldo e carteira, ou voltar para pendente)
app.patch('/api/lancamentos/:id/status', autenticar, (req, res) => {
  const id = Number(req.params.id);
  const { status, descontarSaldo, valor, contaId } = req.body;

  if (!['pago', 'pendente'].includes(status)) {
    return res.status(400).json({ erro: 'Status inválido. Use "pago" ou "pendente".' });
  }

  const descontarValorDb =
    status === 'pendente' ? 1 : descontarSaldo === false ? 0 : 1;

  const valorNumero = valor !== undefined && valor !== null ? Number(valor) : null;
  if (valorNumero !== null && (!Number.isFinite(valorNumero) || valorNumero <= 0)) {
    return res.status(400).json({ erro: 'Informe um valor maior que zero.' });
  }

  const temContaNoBody = contaId !== undefined;
  const contaIdFinal =
    status === 'pendente' || descontarValorDb === 0
      ? null
      : resolverContaId(contaId, req.usuario.id);

  // O "AND usuario_id = ?" garante que você só altera lançamentos da SUA conta
  let resultado;
  if (valorNumero !== null && (temContaNoBody || status === 'pendente')) {
    resultado = db
      .prepare(
        'UPDATE lancamentos SET status = ?, descontar_saldo = ?, valor = ?, conta_id = ? WHERE id = ? AND usuario_id = ?'
      )
      .run(status, descontarValorDb, valorNumero, contaIdFinal, id, req.usuario.id);
  } else if (valorNumero !== null) {
    resultado = db
      .prepare(
        'UPDATE lancamentos SET status = ?, descontar_saldo = ?, valor = ? WHERE id = ? AND usuario_id = ?'
      )
      .run(status, descontarValorDb, valorNumero, id, req.usuario.id);
  } else if (temContaNoBody || status === 'pendente') {
    resultado = db
      .prepare(
        'UPDATE lancamentos SET status = ?, descontar_saldo = ?, conta_id = ? WHERE id = ? AND usuario_id = ?'
      )
      .run(status, descontarValorDb, contaIdFinal, id, req.usuario.id);
  } else {
    resultado = db
      .prepare(
        'UPDATE lancamentos SET status = ?, descontar_saldo = ? WHERE id = ? AND usuario_id = ?'
      )
      .run(status, descontarValorDb, id, req.usuario.id);
  }

  if (resultado.changes === 0) {
    return res.status(404).json({ erro: 'Lançamento não encontrado.' });
  }

  const atualizado = db.prepare(`${SELECT_LANCAMENTO_BASE} WHERE l.id = ?`).get(id);

  return res.json({ lancamento: atualizado });
});

// 7. Editar um lançamento existente
app.put('/api/lancamentos/:id', autenticar, (req, res) => {
  const id = Number(req.params.id);
  const {
    titulo,
    valor,
    tipo,
    categoria,
    data,
    status,
    observacao,
    descontarSaldo,
    contaId,
    origemDivida,
  } = req.body;

  const valorNumero = Number(valor);
  const tiposValidos = ['entrada', 'saida', 'divida'];
  const statusValidos = ['pago', 'pendente'];

  if (!titulo?.trim()) {
    return res.status(400).json({ erro: 'Informe uma descrição para o lançamento.' });
  }
  if (!Number.isFinite(valorNumero) || valorNumero <= 0) {
    return res.status(400).json({ erro: 'Informe um valor maior que zero.' });
  }
  if (!tiposValidos.includes(tipo)) {
    return res.status(400).json({ erro: 'Tipo inválido.' });
  }
  if (!data || !/^\d{4}-\d{2}-\d{2}$/.test(data)) {
    return res.status(400).json({ erro: 'Informe uma data válida (AAAA-MM-DD).' });
  }

  const statusFinal = statusValidos.includes(status) ? status : 'pago';
  const categoriaFinal = categoria?.trim() || 'Geral';
  const observacaoFinal = observacao?.trim() || '';
  const descontarValorDb =
    statusFinal === 'pendente' || tipo === 'entrada'
      ? 1
      : descontarSaldo === false
        ? 0
        : 1;
  const contaIdFinal = resolverContaId(contaId, req.usuario.id);
  const origemDividaFinal = tipo === 'divida' ? (origemDivida?.trim() || '') : '';

  const resultado = db
    .prepare(`
      UPDATE lancamentos
      SET titulo = ?, valor = ?, tipo = ?, categoria = ?, data = ?, status = ?,
          observacao = ?, descontar_saldo = ?, conta_id = ?, origem_divida = ?
      WHERE id = ? AND usuario_id = ?
    `)
    .run(
      titulo.trim(),
      valorNumero,
      tipo,
      categoriaFinal,
      data,
      statusFinal,
      observacaoFinal,
      descontarValorDb,
      contaIdFinal,
      origemDividaFinal,
      id,
      req.usuario.id
    );

  if (resultado.changes === 0) {
    return res.status(404).json({ erro: 'Lançamento não encontrado.' });
  }

  const atualizado = db.prepare(`${SELECT_LANCAMENTO_BASE} WHERE l.id = ?`).get(id);

  return res.json({ lancamento: atualizado });
});

// 8. Excluir todas as parcelas de um grupo de dívida de uma vez
app.delete('/api/lancamentos/grupo/:grupoId', autenticar, (req, res) => {
  const { grupoId } = req.params;

  const resultado = db
    .prepare('DELETE FROM lancamentos WHERE grupo_parcela = ? AND usuario_id = ?')
    .run(grupoId, req.usuario.id);

  if (resultado.changes === 0) {
    return res.status(404).json({ erro: 'Grupo de parcelas não encontrado.' });
  }

  return res.json({ ok: true, removidos: resultado.changes });
});

// 9. Excluir um único lançamento (ou uma única parcela)
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

// ============================================================================
// ROTAS DE CARTEIRAS / CONTAS (Onde seu dinheiro está guardado)
// ============================================================================

// 10. Listar carteiras com saldo calculado via SQL (LEFT JOIN + GROUP BY)
app.get('/api/contas', autenticar, (req, res) => {
  const contas = db
    .prepare(`
      SELECT
        c.id,
        c.nome,
        c.etiqueta,
        c.rendimento,
        c.cor,
        c.saldo_ajuste,
        c.saldo_ajuste + COALESCE(SUM(
          CASE
            WHEN l.tipo = 'entrada' AND l.status = 'pago' THEN l.valor
            WHEN l.tipo IN ('saida', 'divida') AND l.status = 'pago' AND l.descontar_saldo != 0 THEN -l.valor
            ELSE 0
          END
        ), 0) AS saldo
      FROM contas c
      LEFT JOIN lancamentos l ON l.conta_id = c.id AND l.usuario_id = c.usuario_id
      WHERE c.usuario_id = ?
      GROUP BY c.id
      ORDER BY c.id ASC
    `)
    .all(req.usuario.id);

  const semContaRow = db
    .prepare(`
      SELECT COALESCE(SUM(
        CASE
          WHEN tipo = 'entrada' AND status = 'pago' THEN valor
          WHEN tipo IN ('saida', 'divida') AND status = 'pago' AND descontar_saldo != 0 THEN -valor
          ELSE 0
        END
      ), 0) AS total
      FROM lancamentos
      WHERE usuario_id = ? AND conta_id IS NULL
    `)
    .get(req.usuario.id);

  return res.json({
    contas,
    saldoSemConta: semContaRow?.total || 0,
  });
});

// 11. Criar nova carteira
app.post('/api/contas', autenticar, (req, res) => {
  const { nome, etiqueta, rendimento, cor } = req.body;

  if (!nome?.trim()) {
    return res.status(400).json({ erro: 'Informe o nome da carteira (ex.: RecargaPay, Cofrinho).' });
  }

  const corFinal = /^#[0-9a-fA-F]{6}$/.test(cor || '') ? cor : '#3b82f6';
  const etiquetaFinal = etiqueta?.trim() || '';
  const rendimentoFinal = rendimento?.trim() || '';

  const resultado = db
    .prepare('INSERT INTO contas (usuario_id, nome, etiqueta, rendimento, cor) VALUES (?, ?, ?, ?, ?)')
    .run(req.usuario.id, nome.trim(), etiquetaFinal, rendimentoFinal, corFinal);

  const criada = db
    .prepare('SELECT id, nome, etiqueta, rendimento, cor, saldo_ajuste FROM contas WHERE id = ?')
    .get(Number(resultado.lastInsertRowid));

  return res.status(201).json({ conta: { ...criada, saldo: 0 } });
});

// 12. Editar carteira
app.put('/api/contas/:id', autenticar, (req, res) => {
  const id = Number(req.params.id);
  const { nome, etiqueta, rendimento, cor } = req.body;

  if (!nome?.trim()) {
    return res.status(400).json({ erro: 'Informe o nome da carteira.' });
  }

  const corFinal = /^#[0-9a-fA-F]{6}$/.test(cor || '') ? cor : '#3b82f6';
  const etiquetaFinal = etiqueta?.trim() || '';
  const rendimentoFinal = rendimento?.trim() || '';

  const resultado = db
    .prepare('UPDATE contas SET nome = ?, etiqueta = ?, rendimento = ?, cor = ? WHERE id = ? AND usuario_id = ?')
    .run(nome.trim(), etiquetaFinal, rendimentoFinal, corFinal, id, req.usuario.id);

  if (resultado.changes === 0) {
    return res.status(404).json({ erro: 'Carteira não encontrada.' });
  }

  const atualizada = db
    .prepare('SELECT id, nome, etiqueta, rendimento, cor, saldo_ajuste FROM contas WHERE id = ?')
    .get(id);

  return res.json({ conta: atualizada });
});

// 13. Transferir dinheiro entre carteiras (não altera o Saldo Total — apenas move entre lugares!)
app.post('/api/contas/transferir', autenticar, (req, res) => {
  const origemId = Number(req.body.origemId);
  const destinoId = Number(req.body.destinoId);
  const valor = Number(req.body.valor);

  if (!Number.isInteger(origemId) || !Number.isInteger(destinoId) || origemId === destinoId) {
    return res.status(400).json({ erro: 'Escolha duas carteiras diferentes para transferir.' });
  }
  if (!Number.isFinite(valor) || valor <= 0) {
    return res.status(400).json({ erro: 'Informe um valor maior que zero para transferir.' });
  }

  const origem = db
    .prepare('SELECT id FROM contas WHERE id = ? AND usuario_id = ?')
    .get(origemId, req.usuario.id);
  const destino = db
    .prepare('SELECT id FROM contas WHERE id = ? AND usuario_id = ?')
    .get(destinoId, req.usuario.id);

  if (!origem || !destino) {
    return res.status(404).json({ erro: 'Carteira de origem ou destino não encontrada.' });
  }

  // Transação SQL: ou tira da origem E coloca no destino, ou nada muda!
  db.exec('BEGIN');
  try {
    db.prepare('UPDATE contas SET saldo_ajuste = saldo_ajuste - ? WHERE id = ? AND usuario_id = ?').run(
      valor,
      origemId,
      req.usuario.id
    );
    db.prepare('UPDATE contas SET saldo_ajuste = saldo_ajuste + ? WHERE id = ? AND usuario_id = ?').run(
      valor,
      destinoId,
      req.usuario.id
    );
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return res.json({ ok: true });
});

// 14. Excluir carteira (mantém todos os lançamentos intactos!)
app.delete('/api/contas/:id', autenticar, (req, res) => {
  const id = Number(req.params.id);

  const conta = db
    .prepare('SELECT id, saldo_ajuste FROM contas WHERE id = ? AND usuario_id = ?')
    .get(id, req.usuario.id);

  if (!conta) {
    return res.status(404).json({ erro: 'Carteira não encontrada.' });
  }

  if (Math.abs(conta.saldo_ajuste) > 0.009) {
    return res.status(400).json({
      erro: 'Esta carteira possui transferências ativas. Transfira o valor de volta antes de excluí-la.',
    });
  }

  db.exec('BEGIN');
  try {
    db.prepare('UPDATE lancamentos SET conta_id = NULL WHERE conta_id = ? AND usuario_id = ?').run(
      id,
      req.usuario.id
    );
    db.prepare('DELETE FROM contas WHERE id = ? AND usuario_id = ?').run(id, req.usuario.id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return res.json({ ok: true });
});

// ============================================================================
// ROTAS DE SALÁRIO FIXO RECORRENTE ("Previsto para Entrar")
// ============================================================================

const NOMES_MESES_PT = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
];

function montarDataNoMes(ano, mes1a12, diaDesejado) {
  const ultimoDia = new Date(ano, mes1a12, 0).getDate();
  const diaFinal = Math.min(diaDesejado, ultimoDia);
  return `${ano}-${String(mes1a12).padStart(2, '0')}-${String(diaFinal).padStart(2, '0')}`;
}

/**
 * Calcula automaticamente o próximo salário previsto:
 * se o dia de pagamento deste mês já passou OU já existe um salário recebido neste mês,
 * aponta para o próximo mês (ex.: em novembro -> "Salário de Dezembro").
 */
function calcularProximoSalario(config, usuarioId) {
  if (!config) return null;

  const hoje = new Date();
  let ano = hoje.getFullYear();
  let mes = hoje.getMonth() + 1; // 1..12
  const diaHoje = hoje.getDate();

  const mesAtualRef = `${ano}-${String(mes).padStart(2, '0')}`;
  const jaRecebeuMesAtual = Boolean(
    db
      .prepare(`
        SELECT id FROM lancamentos
        WHERE usuario_id = ?
          AND tipo = 'entrada'
          AND status = 'pago'
          AND categoria = 'Salário'
          AND substr(data, 1, 7) = ?
        LIMIT 1
      `)
      .get(usuarioId, mesAtualRef)
  );

  if (diaHoje > config.dia_pagamento || jaRecebeuMesAtual) {
    mes += 1;
    if (mes > 12) {
      mes = 1;
      ano += 1;
    }
  }

  // Se o usuário já adiantou/registrou até o mês seguinte, pula mais um mês
  let tentativas = 0;
  while (tentativas < 12) {
    const mesRef = `${ano}-${String(mes).padStart(2, '0')}`;
    const jaRecebeu = Boolean(
      db
        .prepare(`
          SELECT id FROM lancamentos
          WHERE usuario_id = ?
            AND tipo = 'entrada'
            AND status = 'pago'
            AND categoria = 'Salário'
            AND substr(data, 1, 7) = ?
          LIMIT 1
        `)
        .get(usuarioId, mesRef)
    );
    if (!jaRecebeu) break;
    mes += 1;
    if (mes > 12) {
      mes = 1;
      ano += 1;
    }
    tentativas += 1;
  }

  const mesRef = `${ano}-${String(mes).padStart(2, '0')}`;
  const mesNome = NOMES_MESES_PT[mes - 1];
  const dataIso = montarDataNoMes(ano, mes, config.dia_pagamento);

  return {
    titulo: `Salário de ${mesNome}`,
    mesNome,
    ano,
    mesRef,
    dataIso,
    valor: config.valor,
    diaPagamento: config.dia_pagamento,
    contaId: config.conta_id || null,
    contaNome: config.conta_nome || null,
  };
}

// 15. Obter salário fixo configurado e o próximo mês previsto
app.get('/api/salario', autenticar, (req, res) => {
  const config = db
    .prepare(`
      SELECT s.valor, s.dia_pagamento, s.conta_id, c.nome AS conta_nome
      FROM salario_fixo s
      LEFT JOIN contas c ON c.id = s.conta_id AND c.usuario_id = s.usuario_id
      WHERE s.usuario_id = ?
    `)
    .get(req.usuario.id);

  if (!config) {
    return res.json({ salario: null, proximo: null });
  }

  const proximo = calcularProximoSalario(config, req.usuario.id);
  return res.json({
    salario: {
      valor: config.valor,
      diaPagamento: config.dia_pagamento,
      contaId: config.conta_id || null,
      contaNome: config.conta_nome || null,
    },
    proximo,
  });
});

// 16. Criar ou atualizar salário fixo (UPSERT em SQL)
app.put('/api/salario', autenticar, (req, res) => {
  const valor = Number(req.body.valor);
  const diaPagamento = Math.floor(Number(req.body.diaPagamento));
  const contaIdFinal = resolverContaId(req.body.contaId, req.usuario.id);

  if (!Number.isFinite(valor) || valor <= 0) {
    return res.status(400).json({ erro: 'Informe um valor de salário maior que zero.' });
  }
  if (!Number.isInteger(diaPagamento) || diaPagamento < 1 || diaPagamento > 31) {
    return res.status(400).json({ erro: 'Informe um dia de pagamento entre 1 e 31.' });
  }

  db.prepare(`
    INSERT INTO salario_fixo (usuario_id, valor, dia_pagamento, conta_id, atualizado_em)
    VALUES (?, ?, ?, ?, datetime('now', 'localtime'))
    ON CONFLICT(usuario_id) DO UPDATE SET
      valor = excluded.valor,
      dia_pagamento = excluded.dia_pagamento,
      conta_id = excluded.conta_id,
      atualizado_em = datetime('now', 'localtime')
  `).run(req.usuario.id, valor, diaPagamento, contaIdFinal);

  const config = db
    .prepare(`
      SELECT s.valor, s.dia_pagamento, s.conta_id, c.nome AS conta_nome
      FROM salario_fixo s
      LEFT JOIN contas c ON c.id = s.conta_id AND c.usuario_id = s.usuario_id
      WHERE s.usuario_id = ?
    `)
    .get(req.usuario.id);

  const proximo = calcularProximoSalario(config, req.usuario.id);

  return res.json({
    salario: {
      valor: config.valor,
      diaPagamento: config.dia_pagamento,
      contaId: config.conta_id || null,
      contaNome: config.conta_nome || null,
    },
    proximo,
  });
});

// 17. Remover salário fixo
app.delete('/api/salario', autenticar, (req, res) => {
  db.prepare('DELETE FROM salario_fixo WHERE usuario_id = ?').run(req.usuario.id);
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
