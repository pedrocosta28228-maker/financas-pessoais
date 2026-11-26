import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { agenteRateLimiter } from '../src/security.js';
import {
  DECLARACOES_FERRAMENTAS,
  FERRAMENTAS_PROPOSTA,
  executarFerramentaLeitura,
  criarPropostaAcao,
  confirmarAcaoPendente,
  cancelarAcaoPendente,
} from '../src/agente-tools.js';
import {
  obterStatusAgente,
  carregarHistoricoAgente,
  limparHistoricoAgente,
  processarMensagemAgente,
} from '../src/agente.js';

function criarDbTeste() {
  const tempPath = path.join(
    os.tmpdir(),
    `financeiro-agente-test-${Date.now()}-${Math.random().toString(16).slice(2)}.db`
  );
  const conn = new DatabaseSync(tempPath);
  conn.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE usuarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      senha_hash TEXT NOT NULL
    );
    CREATE TABLE contas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER NOT NULL,
      nome TEXT NOT NULL,
      etiqueta TEXT NOT NULL DEFAULT '',
      rendimento TEXT NOT NULL DEFAULT '',
      cor TEXT NOT NULL DEFAULT '#3b82f6',
      saldo_ajuste REAL NOT NULL DEFAULT 0,
      FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
    );
    CREATE TABLE lancamentos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER NOT NULL,
      titulo TEXT NOT NULL,
      valor REAL NOT NULL,
      tipo TEXT NOT NULL CHECK (tipo IN ('entrada', 'saida', 'divida')),
      categoria TEXT NOT NULL DEFAULT 'Geral',
      data TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pago' CHECK (status IN ('pago', 'pendente')),
      observacao TEXT DEFAULT '',
      grupo_parcela TEXT DEFAULT NULL,
      descontar_saldo INTEGER NOT NULL DEFAULT 1,
      conta_id INTEGER DEFAULT NULL,
      origem_divida TEXT NOT NULL DEFAULT '',
      criado_em TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
      FOREIGN KEY (conta_id) REFERENCES contas(id) ON DELETE SET NULL
    );
    CREATE TABLE salario_fixo (
      usuario_id INTEGER PRIMARY KEY,
      valor REAL NOT NULL,
      dia_pagamento INTEGER NOT NULL,
      conta_id INTEGER DEFAULT NULL,
      FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
    );
    CREATE TABLE metas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER NOT NULL,
      titulo TEXT NOT NULL,
      valor_alvo REAL NOT NULL,
      valor_atual REAL NOT NULL DEFAULT 0,
      prazo TEXT DEFAULT NULL,
      cor TEXT NOT NULL DEFAULT '#22c55e',
      conta_id INTEGER DEFAULT NULL,
      observacao TEXT NOT NULL DEFAULT '',
      criado_em TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
    );
    CREATE TABLE despesas_fixas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER NOT NULL,
      titulo TEXT NOT NULL,
      valor REAL NOT NULL,
      dia_vencimento INTEGER NOT NULL,
      categoria TEXT NOT NULL DEFAULT 'Moradia',
      conta_id INTEGER DEFAULT NULL,
      ativa INTEGER NOT NULL DEFAULT 1,
      criado_em TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
    );
    CREATE TABLE agente_mensagens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER NOT NULL,
      papel TEXT NOT NULL CHECK (papel IN ('usuario', 'assistente')),
      conteudo TEXT NOT NULL,
      criado_em TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
    );
    CREATE TABLE agente_acoes_pendentes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER NOT NULL,
      mensagem_id INTEGER DEFAULT NULL,
      tipo_acao TEXT NOT NULL CHECK (tipo_acao IN ('criar_lancamento', 'marcar_pago', 'criar_meta', 'criar_despesa_fixa')),
      resumo TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'confirmada', 'cancelada')),
      resultado_json TEXT DEFAULT NULL,
      criado_em TEXT DEFAULT (datetime('now', 'localtime')),
      resolvido_em TEXT DEFAULT NULL,
      FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
      FOREIGN KEY (mensagem_id) REFERENCES agente_mensagens(id) ON DELETE SET NULL
    );
  `);

  const executor = {
    async get(sql, ...params) {
      return conn.prepare(sql).get(...params);
    },
    async all(sql, ...params) {
      return conn.prepare(sql).all(...params);
    },
    async run(sql, ...params) {
      const res = conn.prepare(sql).run(...params);
      return { changes: Number(res.changes ?? 0) };
    },
    async insert(sql, ...params) {
      const res = conn.prepare(sql).run(...params);
      return Number(res.lastInsertRowid);
    },
    async transaction(fn) {
      conn.exec('BEGIN');
      try {
        const res = await fn(executor);
        conn.exec('COMMIT');
        return res;
      } catch (err) {
        conn.exec('ROLLBACK');
        throw err;
      }
    },
  };

  return {
    db: executor,
    fechar() {
      conn.close();
      try {
        fs.unlinkSync(tempPath);
      } catch {
        // ignora limpeza no Windows
      }
    },
  };
}

test('agenteRateLimiter é exportado como middleware Express', () => {
  assert.equal(typeof agenteRateLimiter, 'function');
});

test('DECLARACOES_FERRAMENTAS expõe 7 leituras + 4 propostas e proíbe exclusão/transferência', () => {
  assert.equal(DECLARACOES_FERRAMENTAS.length, 11);
  assert.equal(FERRAMENTAS_PROPOSTA.size, 4);
  for (const fn of DECLARACOES_FERRAMENTAS) {
    assert.ok(!/excluir|deletar|delete|transferir|transfer/i.test(fn.name), `Proibida: ${fn.name}`);
  }
});

test('ferramentas de leitura retornam dados corretos e isolados por usuario_id', async () => {
  const ctx = criarDbTeste();
  try {
    const u1 = await ctx.db.insert(
      'INSERT INTO usuarios (nome, email, senha_hash) VALUES (?, ?, ?)',
      'Pedro',
      'pedro@a.dev',
      'hash'
    );
    const u2 = await ctx.db.insert(
      'INSERT INTO usuarios (nome, email, senha_hash) VALUES (?, ?, ?)',
      'Maria',
      'maria@b.dev',
      'hash'
    );

    const c1 = await ctx.db.insert(
      'INSERT INTO contas (usuario_id, nome, saldo_ajuste) VALUES (?, ?, ?)',
      u1,
      'Nubank',
      500
    );
    await ctx.db.insert(
      'INSERT INTO contas (usuario_id, nome, saldo_ajuste) VALUES (?, ?, ?)',
      u2,
      'Secreto Maria',
      99999
    );
    await ctx.db.insert(
      'INSERT INTO lancamentos (usuario_id, titulo, valor, tipo, categoria, data, status, conta_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      u1,
      'Salário',
      3000,
      'entrada',
      'Salário',
      '2026-11-05',
      'pago',
      c1
    );
    await ctx.db.insert(
      'INSERT INTO lancamentos (usuario_id, titulo, valor, tipo, categoria, data, status, origem_divida) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      u1,
      'Notebook (1/3)',
      400,
      'divida',
      'Tecnologia',
      '2026-11-28',
      'pendente',
      'Cartão Nubank'
    );
    await ctx.db.insert(
      'INSERT INTO salario_fixo (usuario_id, valor, dia_pagamento) VALUES (?, ?, ?)',
      u1,
      3000,
      5
    );
    await ctx.db.insert(
      'INSERT INTO despesas_fixas (usuario_id, titulo, valor, dia_vencimento, ativa) VALUES (?, ?, ?, ?, ?)',
      u1,
      'Aluguel',
      1200,
      10,
      1
    );

    const resumo = await executarFerramentaLeitura(
      'obter_resumo_financeiro',
      { mes: '2026-11' },
      u1,
      { db: ctx.db, hojeIso: '2026-11-24' }
    );
    assert.equal(resumo.entradasRecebidas, 3000);
    assert.equal(resumo.dividasPendentes, 400);
    assert.equal(resumo.despesasFixasAtivasTotal, 1200);

    const carteiras = await executarFerramentaLeitura('listar_carteiras', {}, u1, {
      db: ctx.db,
      hojeIso: '2026-11-24',
    });
    assert.equal(carteiras.carteiras.length, 1);
    assert.equal(carteiras.carteiras[0].nome, 'Nubank');
    assert.equal(carteiras.carteiras[0].saldo, 3500);

    const dividas = await executarFerramentaLeitura('resumo_dividas_e_cartoes', {}, u1, {
      db: ctx.db,
      hojeIso: '2026-11-24',
    });
    assert.equal(dividas.totalPendente, 400);
    assert.equal(dividas.porOrigem[0].origem, 'Cartão Nubank');

    const projecao = await executarFerramentaLeitura(
      'projetar_proximos_meses',
      { meses: 3 },
      u1,
      { db: ctx.db, hojeIso: '2026-11-24' }
    );
    assert.equal(projecao.meses.length, 3);
    assert.equal(projecao.meses[0].mes, '2026-11');
  } finally {
    ctx.fechar();
  }
});

test('propor_criar_lancamento parcelado (modo total vs parcela) só grava após confirmar e arredonda centavos', async () => {
  const ctx = criarDbTeste();
  try {
    const u1 = await ctx.db.insert(
      'INSERT INTO usuarios (nome, email, senha_hash) VALUES (?, ?, ?)',
      'Pedro',
      'pedro@p.dev',
      'hash'
    );

    // Modo TOTAL: R$ 100 em 3x -> 33.33 + 33.33 + 33.34
    const propTotal = await criarPropostaAcao(
      'propor_criar_lancamento',
      {
        titulo: 'Fone',
        valor: 100,
        tipo: 'divida',
        parcelas: 3,
        modo_valor_parcela: 'total',
        data: '2026-11-24',
        status: 'pendente',
        origem_divida: 'Nubank',
      },
      u1,
      { db: ctx.db, hojeIso: '2026-11-24' }
    );

    // Antes de confirmar: zero lançamentos no banco!
    const antes = await ctx.db.all('SELECT * FROM lancamentos WHERE usuario_id = ?', u1);
    assert.equal(antes.length, 0);
    assert.match(propTotal.acao.resumo, /3x/);
    assert.match(propTotal.acao.resumo, /100,00/);

    const confTotal = await confirmarAcaoPendente(propTotal.acao.id, u1, { db: ctx.db });
    assert.equal(confTotal.acao.status, 'confirmada');

    const depoisTotal = await ctx.db.all(
      'SELECT titulo, valor, grupo_parcela FROM lancamentos WHERE usuario_id = ? ORDER BY id ASC',
      u1
    );
    assert.equal(depoisTotal.length, 3);
    assert.deepEqual(
      depoisTotal.map((l) => l.valor),
      [33.33, 33.33, 33.34]
    );
    assert.ok(depoisTotal[0].grupo_parcela);
    assert.equal(depoisTotal[0].grupo_parcela, depoisTotal[2].grupo_parcela);

    // Modo PARCELA: 3x de R$ 100 -> Total 300
    const propParcela = await criarPropostaAcao(
      'propor_criar_lancamento',
      {
        titulo: 'Cadeira',
        valor: 100,
        tipo: 'divida',
        parcelas: 3,
        modo_valor_parcela: 'parcela',
        data: '2026-11-24',
        status: 'pendente',
      },
      u1,
      { db: ctx.db, hojeIso: '2026-11-24' }
    );
    assert.match(propParcela.acao.resumo, /300,00/);
    await confirmarAcaoPendente(propParcela.acao.id, u1, { db: ctx.db });
    const cadeiras = await ctx.db.all(
      "SELECT valor FROM lancamentos WHERE usuario_id = ? AND titulo LIKE 'Cadeira%' ORDER BY id ASC",
      u1
    );
    assert.deepEqual(
      cadeiras.map((l) => l.valor),
      [100, 100, 100]
    );
  } finally {
    ctx.fechar();
  }
});

test('confirmarAcaoPendente bloqueia duplo clique e confirmação após cancelamento (409)', async () => {
  const ctx = criarDbTeste();
  try {
    const u1 = await ctx.db.insert(
      'INSERT INTO usuarios (nome, email, senha_hash) VALUES (?, ?, ?)',
      'Pedro',
      'pedro@c.dev',
      'hash'
    );

    const p1 = await criarPropostaAcao(
      'propor_criar_lancamento',
      { titulo: 'Mercado', valor: 85, tipo: 'saida', data: '2026-11-24' },
      u1,
      { db: ctx.db, hojeIso: '2026-11-24' }
    );
    await confirmarAcaoPendente(p1.acao.id, u1, { db: ctx.db });

    await assert.rejects(
      () => confirmarAcaoPendente(p1.acao.id, u1, { db: ctx.db }),
      (err) => err.status === 409
    );

    const p2 = await criarPropostaAcao(
      'propor_criar_lancamento',
      { titulo: 'Farmácia', valor: 40, tipo: 'saida', data: '2026-11-24' },
      u1,
      { db: ctx.db, hojeIso: '2026-11-24' }
    );
    const canc = await cancelarAcaoPendente(p2.acao.id, u1, { db: ctx.db });
    assert.equal(canc.acao.status, 'cancelada');

    await assert.rejects(
      () => confirmarAcaoPendente(p2.acao.id, u1, { db: ctx.db }),
      (err) => err.status === 409
    );

    const lancamentos = await ctx.db.all('SELECT * FROM lancamentos WHERE usuario_id = ?', u1);
    assert.equal(lancamentos.length, 1);
  } finally {
    ctx.fechar();
  }
});

test('isolamento entre usuários (IDOR): bloqueia confirmação, cancelamento e referência a recursos alheios', async () => {
  const ctx = criarDbTeste();
  try {
    const u1 = await ctx.db.insert(
      'INSERT INTO usuarios (nome, email, senha_hash) VALUES (?, ?, ?)',
      'Pedro',
      'pedro@i.dev',
      'hash'
    );
    const u2 = await ctx.db.insert(
      'INSERT INTO usuarios (nome, email, senha_hash) VALUES (?, ?, ?)',
      'Outro',
      'outro@i.dev',
      'hash'
    );

    const contaU1 = await ctx.db.insert(
      'INSERT INTO contas (usuario_id, nome) VALUES (?, ?)',
      u1,
      'Conta Pedro'
    );
    const lancU1 = await ctx.db.insert(
      'INSERT INTO lancamentos (usuario_id, titulo, valor, tipo, data, status) VALUES (?, ?, ?, ?, ?, ?)',
      u1,
      'Conta Luz',
      150,
      'saida',
      '2026-11-25',
      'pendente'
    );

    const pU1 = await criarPropostaAcao(
      'propor_criar_lancamento',
      { titulo: 'Café', valor: 12, tipo: 'saida', data: '2026-11-24', conta_id: contaU1 },
      u1,
      { db: ctx.db, hojeIso: '2026-11-24' }
    );

    // Usuário 2 não consegue confirmar nem cancelar proposta do usuário 1
    await assert.rejects(
      () => confirmarAcaoPendente(pU1.acao.id, u2, { db: ctx.db }),
      (err) => err.status === 404
    );
    await assert.rejects(
      () => cancelarAcaoPendente(pU1.acao.id, u2, { db: ctx.db }),
      (err) => err.status === 404
    );

    // Usuário 2 tentando propor marcar_pago em lançamento do usuário 1 falha
    await assert.rejects(
      () =>
        criarPropostaAcao('propor_marcar_pago', { lancamento_id: lancU1 }, u2, {
          db: ctx.db,
          hojeIso: '2026-11-24',
        }),
      (err) => err.status === 404
    );

    // Usuário 2 tentando usar conta_id do usuário 1 tem conta_id sanitizado para null
    const pU2 = await criarPropostaAcao(
      'propor_criar_lancamento',
      { titulo: 'Lanche', valor: 20, tipo: 'saida', data: '2026-11-24', conta_id: contaU1 },
      u2,
      { db: ctx.db, hojeIso: '2026-11-24' }
    );
    assert.equal(pU2.acao.payload.conta_id, null);
  } finally {
    ctx.fechar();
  }
});

test('agente: loop de leitura com tool calling salva histórico corretamente', async () => {
  const ctx = criarDbTeste();
  try {
    const u1 = await ctx.db.insert(
      'INSERT INTO usuarios (nome, email, senha_hash) VALUES (?, ?, ?)',
      'Pedro',
      'pedro@ag1.dev',
      'hash'
    );
    await ctx.db.insert(
      'INSERT INTO lancamentos (usuario_id, titulo, valor, tipo, data, status) VALUES (?, ?, ?, ?, ?, ?)',
      u1,
      'Salário',
      4500,
      'entrada',
      '2026-11-05',
      'pago'
    );

    let chamadas = 0;
    const chamarGeminiMock = async ({ contents }) => {
      chamadas += 1;
      if (chamadas === 1) {
        return {
          candidates: [
            {
              content: {
                role: 'model',
                parts: [{ functionCall: { name: 'obter_resumo_financeiro', args: { mes: '2026-11' } } }],
              },
            },
          ],
        };
      }
      // Confere que a resposta da ferramenta foi enviada de volta ao modelo
      const ultima = contents[contents.length - 1];
      assert.equal(ultima.parts[0].functionResponse.name, 'obter_resumo_financeiro');
      assert.equal(ultima.parts[0].functionResponse.response.entradasRecebidas, 4500);
      return {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [{ text: 'Em novembro você já recebeu R$ 4.500,00.' }],
            },
          },
        ],
      };
    };

    const res = await processarMensagemAgente({
      usuarioId: u1,
      mensagem: 'Como está meu mês?',
      db: ctx.db,
      chamarGemini: chamarGeminiMock,
      env: { GEMINI_API_KEY: 'chave-fake' },
      hojeIso: '2026-11-24',
    });

    assert.equal(chamadas, 2);
    assert.match(res.mensagemAssistente.conteudo, /4\.500,00/);
    assert.equal(res.acoesPendentes.length, 0);

    const hist = await carregarHistoricoAgente(u1, { db: ctx.db });
    assert.equal(hist.length, 2);
    assert.equal(hist[0].papel, 'usuario');
    assert.equal(hist[1].papel, 'assistente');
  } finally {
    ctx.fechar();
  }
});

test('agente: suporta múltiplas propostas em 1 turno até teto de 5 e rejeita 6ª sem linha órfã', async () => {
  const ctx = criarDbTeste();
  try {
    const u1 = await ctx.db.insert(
      'INSERT INTO usuarios (nome, email, senha_hash) VALUES (?, ?, ?)',
      'Pedro',
      'pedro@ag2.dev',
      'hash'
    );

    let passo = 0;
    const chamarGeminiMock = async () => {
      passo += 1;
      if (passo === 1) {
        return {
          candidates: [
            {
              content: {
                role: 'model',
                parts: Array.from({ length: 6 }, (_, i) => ({
                  functionCall: {
                    name: 'propor_criar_lancamento',
                    args: { titulo: `Gasto ${i + 1}`, valor: 10 + i, tipo: 'saida', data: '2026-11-24' },
                  },
                })),
              },
            },
          ],
        };
      }
      return {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [{ text: 'Preparei os 5 primeiros lançamentos para você confirmar!' }],
            },
          },
        ],
      };
    };

    const res = await processarMensagemAgente({
      usuarioId: u1,
      mensagem: 'Lança 6 gastos aí',
      db: ctx.db,
      chamarGemini: chamarGeminiMock,
      env: { GEMINI_API_KEY: 'chave-fake' },
      hojeIso: '2026-11-24',
    });

    assert.equal(res.acoesPendentes.length, 5);
    for (const a of res.acoesPendentes) {
      assert.equal(a.mensagemId, res.mensagemAssistente.id);
    }

    const totalDb = await ctx.db.all('SELECT id FROM agente_acoes_pendentes WHERE usuario_id = ?', u1);
    assert.equal(totalDb.length, 5);

    const hist = await carregarHistoricoAgente(u1, { db: ctx.db });
    assert.equal(hist[1].acoes.length, 5);

    await limparHistoricoAgente(u1, { db: ctx.db });
    const histPosLimpar = await carregarHistoricoAgente(u1, { db: ctx.db });
    assert.equal(histPosLimpar.length, 0);
  } finally {
    ctx.fechar();
  }
});

test('agente: falha graciosamente quando GEMINI_API_KEY está ausente (503)', async () => {
  const status = obterStatusAgente({});
  assert.equal(status.configurado, false);
  assert.equal(status.modelo, 'gemini-3.5-flash');

  const ctx = criarDbTeste();
  try {
    const u1 = await ctx.db.insert(
      'INSERT INTO usuarios (nome, email, senha_hash) VALUES (?, ?, ?)',
      'Pedro',
      'pedro@ag3.dev',
      'hash'
    );
    await assert.rejects(
      () =>
        processarMensagemAgente({
          usuarioId: u1,
          mensagem: 'Oi',
          db: ctx.db,
          env: {},
        }),
      (err) => err.status === 503 && /GEMINI_API_KEY/.test(err.message)
    );
  } finally {
    ctx.fechar();
  }
});

test('agente: trata erro de cota 429 do Gemini sem gravar resposta vazia', async () => {
  const ctx = criarDbTeste();
  try {
    const u1 = await ctx.db.insert(
      'INSERT INTO usuarios (nome, email, senha_hash) VALUES (?, ?, ?)',
      'Pedro',
      'pedro@ag4.dev',
      'hash'
    );
    const chamarGemini429 = async () => {
      const err = new Error('Limite gratuito da IA atingido no momento.');
      err.status = 429;
      throw err;
    };

    await assert.rejects(
      () =>
        processarMensagemAgente({
          usuarioId: u1,
          mensagem: 'Quanto tenho?',
          db: ctx.db,
          chamarGemini: chamarGemini429,
          env: { GEMINI_API_KEY: 'chave-fake' },
        }),
      (err) => err.status === 429
    );

    const msgs = await ctx.db.all('SELECT * FROM agente_mensagens WHERE usuario_id = ?', u1);
    assert.equal(msgs.length, 0);
  } finally {
    ctx.fechar();
  }
});

test('agente: encerra loop de ferramentas na 5ª iteração com resposta segura', async () => {
  const ctx = criarDbTeste();
  try {
    const u1 = await ctx.db.insert(
      'INSERT INTO usuarios (nome, email, senha_hash) VALUES (?, ?, ?)',
      'Pedro',
      'pedro@ag5.dev',
      'hash'
    );

    let iteracoes = 0;
    const chamarGeminiInfinito = async () => {
      iteracoes += 1;
      return {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [{ functionCall: { name: 'listar_carteiras', args: {} } }],
            },
          },
        ],
      };
    };

    const res = await processarMensagemAgente({
      usuarioId: u1,
      mensagem: 'Loop teste',
      db: ctx.db,
      chamarGemini: chamarGeminiInfinito,
      env: { GEMINI_API_KEY: 'chave-fake' },
      hojeIso: '2026-11-24',
    });

    assert.equal(iteracoes, 5);
    assert.ok(res.mensagemAssistente.conteudo.length > 0);
  } finally {
    ctx.fechar();
  }
});

test('revisão #1: listar_metas calcula saldo real da carteira quando meta está vinculada a conta_id', async () => {
  const ctx = criarDbTeste();
  try {
    const u1 = await ctx.db.insert(
      'INSERT INTO usuarios (nome, email, senha_hash) VALUES (?, ?, ?)',
      'Pedro',
      'pedro@rev1.dev',
      'hash'
    );
    const c1 = await ctx.db.insert(
      'INSERT INTO contas (usuario_id, nome, saldo_ajuste) VALUES (?, ?, ?)',
      u1,
      'Reserva CDB',
      2500
    );
    await ctx.db.insert(
      'INSERT INTO metas (usuario_id, titulo, valor_alvo, valor_atual, conta_id) VALUES (?, ?, ?, ?, ?)',
      u1,
      'Emergência',
      10000,
      0,
      c1
    );

    const res = await executarFerramentaLeitura('listar_metas', {}, u1, {
      db: ctx.db,
      hojeIso: '2026-11-24',
    });
    assert.equal(res.metas.length, 1);
    assert.equal(res.metas[0].valorAtual, 2500);
    assert.equal(res.metas[0].progressoPct, 25);
    assert.equal(res.metas[0].faltante, 7500);
  } finally {
    ctx.fechar();
  }
});

test('revisão #2: projetar_proximos_meses evita dupla contagem de salário/fixas já lançados e calcula saldoAcumulado', async () => {
  const ctx = criarDbTeste();
  try {
    const u1 = await ctx.db.insert(
      'INSERT INTO usuarios (nome, email, senha_hash) VALUES (?, ?, ?)',
      'Pedro',
      'pedro@rev2.dev',
      'hash'
    );
    await ctx.db.insert(
      'INSERT INTO salario_fixo (usuario_id, valor, dia_pagamento) VALUES (?, ?, ?)',
      u1,
      5000,
      5
    );
    await ctx.db.insert(
      'INSERT INTO despesas_fixas (usuario_id, titulo, valor, dia_vencimento, ativa) VALUES (?, ?, ?, ?, ?)',
      u1,
      'Aluguel',
      1500,
      10,
      1
    );
    // Salário e Aluguel de novembro já recebidos/pagos
    await ctx.db.insert(
      'INSERT INTO lancamentos (usuario_id, titulo, valor, tipo, categoria, data, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
      u1,
      'Salário de Novembro',
      5000,
      'entrada',
      'Salário',
      '2026-11-05',
      'pago'
    );
    await ctx.db.insert(
      'INSERT INTO lancamentos (usuario_id, titulo, valor, tipo, categoria, data, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
      u1,
      'Aluguel',
      1500,
      'saida',
      'Moradia',
      '2026-11-10',
      'pago'
    );

    const proj = await executarFerramentaLeitura(
      'projetar_proximos_meses',
      { meses: 2 },
      u1,
      { db: ctx.db, hojeIso: '2026-11-24' }
    );
    // Novembro não deve somar salário nem aluguel novamente; saldoReal = 3500
    assert.equal(proj.meses[0].mes, '2026-11');
    assert.equal(proj.meses[0].entradasPrevistas, 0);
    assert.equal(proj.meses[0].despesasFixas, 0);
    assert.equal(proj.meses[0].saldoAcumulado, 3500);
    // Dezembro projeta salário 5000 - aluguel 1500 = +3500 -> acumulado 7000
    assert.equal(proj.meses[1].mes, '2026-12');
    assert.equal(proj.meses[1].entradasPrevistas, 5000);
    assert.equal(proj.meses[1].despesasFixas, 1500);
    assert.equal(proj.meses[1].saldoAcumulado, 7000);
  } finally {
    ctx.fechar();
  }
});

test('revisão #3: propor_criar_lancamento exige modo_valor_parcela quando parcelas > 1 e enum está declarado', async () => {
  const decl = DECLARACOES_FERRAMENTAS.find((f) => f.name === 'propor_criar_lancamento');
  assert.deepEqual(decl.parameters.properties.modo_valor_parcela.enum, ['total', 'parcela']);

  const ctx = criarDbTeste();
  try {
    const u1 = await ctx.db.insert(
      'INSERT INTO usuarios (nome, email, senha_hash) VALUES (?, ?, ?)',
      'Pedro',
      'pedro@rev3.dev',
      'hash'
    );
    await assert.rejects(
      () =>
        criarPropostaAcao(
          'propor_criar_lancamento',
          { titulo: 'TV', valor: 1200, tipo: 'divida', parcelas: 6, data: '2026-11-24' },
          u1,
          { db: ctx.db, hojeIso: '2026-11-24' }
        ),
      (err) => err.status === 400 && /modo_valor_parcela/.test(err.message)
    );
  } finally {
    ctx.fechar();
  }
});

test('revisão #4: cancelarAcaoPendente retorna 409 quando UPDATE condicional afetar 0 linhas (race)', async () => {
  const dbRace = {
    async get() {
      return { id: 10, usuario_id: 1, status: 'pendente' };
    },
    async run() {
      return { changes: 0 };
    },
  };
  await assert.rejects(
    () => cancelarAcaoPendente(10, 1, { db: dbRace }),
    (err) => err.status === 409
  );
});

test('revisão #5: listar_lancamentos filtra busca no SQL antes do LIMIT mesmo com >200 registros futuros', async () => {
  const ctx = criarDbTeste();
  try {
    const u1 = await ctx.db.insert(
      'INSERT INTO usuarios (nome, email, senha_hash) VALUES (?, ?, ?)',
      'Pedro',
      'pedro@rev5.dev',
      'hash'
    );
    await ctx.db.insert(
      'INSERT INTO lancamentos (usuario_id, titulo, valor, tipo, data, status) VALUES (?, ?, ?, ?, ?, ?)',
      u1,
      'Internet Fibra Especial',
      119.9,
      'saida',
      '2026-11-20',
      'pendente'
    );
    for (let i = 0; i < 210; i++) {
      await ctx.db.insert(
        'INSERT INTO lancamentos (usuario_id, titulo, valor, tipo, data, status) VALUES (?, ?, ?, ?, ?, ?)',
        u1,
        `Parcela Futura ${i}`,
        50,
        'divida',
        '2029-01-10',
        'pendente'
      );
    }

    const res = await executarFerramentaLeitura(
      'listar_lancamentos',
      { busca: 'fibra especial' },
      u1,
      { db: ctx.db, hojeIso: '2026-11-24' }
    );
    assert.equal(res.itens.length, 1);
    assert.equal(res.itens[0].titulo, 'Internet Fibra Especial');
  } finally {
    ctx.fechar();
  }
});

test('segurança IA: rejeita título gigante, valor sub-centavo e valor acima do teto máximo', async () => {
  const ctx = criarDbTeste();
  try {
    const u1 = await ctx.db.insert(
      'INSERT INTO usuarios (nome, email, senha_hash) VALUES (?, ?, ?)',
      'Pedro',
      'pedro@secia1.dev',
      'hash'
    );

    await assert.rejects(
      () =>
        criarPropostaAcao(
          'propor_criar_lancamento',
          { titulo: 'A'.repeat(121), valor: 50, tipo: 'saida' },
          u1,
          { db: ctx.db, hojeIso: '2026-11-26' }
        ),
      (err) => err.status === 400
    );

    await assert.rejects(
      () =>
        criarPropostaAcao(
          'propor_criar_lancamento',
          { titulo: 'Centavo zero', valor: 0.001, tipo: 'saida' },
          u1,
          { db: ctx.db, hojeIso: '2026-11-26' }
        ),
      (err) => err.status === 400
    );

    await assert.rejects(
      () =>
        criarPropostaAcao(
          'propor_criar_lancamento',
          { titulo: 'Absurdo', valor: 999_999_999_999, tipo: 'saida' },
          u1,
          { db: ctx.db, hojeIso: '2026-11-26' }
        ),
      (err) => err.status === 400
    );
  } finally {
    ctx.fechar();
  }
});

test('segurança IA: proposta pendente com mais de 24h expira (410), vira cancelada e não grava no banco', async () => {
  const ctx = criarDbTeste();
  try {
    const u1 = await ctx.db.insert(
      'INSERT INTO usuarios (nome, email, senha_hash) VALUES (?, ?, ?)',
      'Pedro',
      'pedro@secia2.dev',
      'hash'
    );

    const { acao } = await criarPropostaAcao(
      'propor_criar_lancamento',
      { titulo: 'Café antigo', valor: 15, tipo: 'saida', data: '2026-11-24' },
      u1,
      { db: ctx.db, hojeIso: '2026-11-24' }
    );

    // Simula confirmação 25 horas depois da criação
    const agoraFuturo = Date.now() + 25 * 60 * 60 * 1000;
    await assert.rejects(
      () => confirmarAcaoPendente(acao.id, u1, { db: ctx.db, agoraMs: agoraFuturo }),
      (err) => err.status === 410
    );

    const acaoDb = await ctx.db.get('SELECT status FROM agente_acoes_pendentes WHERE id = ?', acao.id);
    assert.equal(acaoDb.status, 'cancelada');

    const lancs = await ctx.db.all('SELECT id FROM lancamentos WHERE usuario_id = ?', u1);
    assert.equal(lancs.length, 0);
  } finally {
    ctx.fechar();
  }
});

test('segurança IA: marcar_pago com descontar_saldo=false limpa conta_id', async () => {
  const ctx = criarDbTeste();
  try {
    const u1 = await ctx.db.insert(
      'INSERT INTO usuarios (nome, email, senha_hash) VALUES (?, ?, ?)',
      'Pedro',
      'pedro@secia3.dev',
      'hash'
    );
    const contaId = await ctx.db.insert(
      'INSERT INTO contas (usuario_id, nome) VALUES (?, ?)',
      u1,
      'Nubank'
    );
    const lancId = await ctx.db.insert(
      'INSERT INTO lancamentos (usuario_id, titulo, valor, tipo, data, status, conta_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
      u1,
      'Parcela Notebook',
      300,
      'divida',
      '2026-11-26',
      'pendente',
      contaId
    );

    const { acao } = await criarPropostaAcao(
      'propor_marcar_pago',
      { lancamento_id: lancId, descontar_saldo: false },
      u1,
      { db: ctx.db, hojeIso: '2026-11-26' }
    );

    await confirmarAcaoPendente(acao.id, u1, { db: ctx.db });

    const atualizado = await ctx.db.get(
      'SELECT status, descontar_saldo, conta_id FROM lancamentos WHERE id = ?',
      lancId
    );
    assert.equal(atualizado.status, 'pago');
    assert.equal(atualizado.descontar_saldo, 0);
    assert.equal(atualizado.conta_id, null);
  } finally {
    ctx.fechar();
  }
});
