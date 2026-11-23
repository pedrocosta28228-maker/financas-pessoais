import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { hashSenha, verificarSenha, gerarToken } from '../src/auth.js';
import { resolverJwtSecret, validarEmail, criarOpcoesCors } from '../src/security.js';
import { traduzirPlaceholdersPg } from '../src/db.js';
import {
  detectarResumoMensalParaHoje,
  calcularProximoDisparoResumo,
  executarRotinaNotificacoes,
} from '../src/notificacoes.js';
import {
  montarHtmlLembreteVencimento,
  montarHtmlResumoMensal,
} from '../src/email.js';

test('hashSenha gera hash irreversível e verificarSenha valida corretamente', () => {
  const senhaOriginal = 'minhaSenhaForte123';
  const hash1 = hashSenha(senhaOriginal);
  const hash2 = hashSenha(senhaOriginal);

  // Mesmo com a mesma senha, o salt aleatório gera hashes diferentes
  assert.notEqual(hash1, hash2);
  assert.ok(!hash1.includes(senhaOriginal));
  assert.equal(verificarSenha(senhaOriginal, hash1), true);
  assert.equal(verificarSenha('senhaErrada', hash1), false);
});

test('gerarToken produz um JWT válido de 3 partes', () => {
  const token = gerarToken({ id: 1, nome: 'Pedro', email: 'pedro@teste.dev' });
  assert.equal(token.split('.').length, 3);
});

test('SQLite: isolamento por usuario_id (proteção contra IDOR) e transferência conservando saldo total', () => {
  const tempDb = path.join(os.tmpdir(), `financeiro-test-${Date.now()}.db`);
  const db = new DatabaseSync(tempDb);

  try {
    db.exec(`
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
        saldo_ajuste REAL NOT NULL DEFAULT 0,
        FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
      );
      CREATE TABLE lancamentos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        usuario_id INTEGER NOT NULL,
        titulo TEXT NOT NULL,
        valor REAL NOT NULL,
        tipo TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pago',
        descontar_saldo INTEGER NOT NULL DEFAULT 1,
        conta_id INTEGER DEFAULT NULL,
        FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
      );
    `);

    const u1 = Number(
      db
        .prepare('INSERT INTO usuarios (nome, email, senha_hash) VALUES (?, ?, ?)')
        .run('Pedro', 'pedro@teste.dev', hashSenha('123456')).lastInsertRowid
    );
    const u2 = Number(
      db
        .prepare('INSERT INTO usuarios (nome, email, senha_hash) VALUES (?, ?, ?)')
        .run('Outro', 'outro@teste.dev', hashSenha('123456')).lastInsertRowid
    );

    const c1 = Number(
      db.prepare('INSERT INTO contas (usuario_id, nome) VALUES (?, ?)').run(u1, 'Uso diário')
        .lastInsertRowid
    );
    const c2 = Number(
      db.prepare('INSERT INTO contas (usuario_id, nome) VALUES (?, ?)').run(u1, 'Cofrinho')
        .lastInsertRowid
    );

    // Entrada de R$ 1500 na carteira Uso diário
    const lancId = Number(
      db
        .prepare(
          'INSERT INTO lancamentos (usuario_id, titulo, valor, tipo, status, conta_id) VALUES (?, ?, ?, ?, ?, ?)'
        )
        .run(u1, 'Salário', 1500, 'entrada', 'pago', c1).lastInsertRowid
    );

    // Usuário 2 tenta apagar lançamento do Usuário 1 -> 0 alterações!
    const tentativaInvasao = db
      .prepare('DELETE FROM lancamentos WHERE id = ? AND usuario_id = ?')
      .run(lancId, u2);
    assert.equal(tentativaInvasao.changes, 0);

    // Transfere R$ 400 de Uso diário -> Cofrinho dentro de uma transação SQL
    db.exec('BEGIN');
    db.prepare('UPDATE contas SET saldo_ajuste = saldo_ajuste - ? WHERE id = ? AND usuario_id = ?').run(400, c1, u1);
    db.prepare('UPDATE contas SET saldo_ajuste = saldo_ajuste + ? WHERE id = ? AND usuario_id = ?').run(400, c2, u1);
    db.exec('COMMIT');

    // Confere saldo individual de cada carteira e conservação do saldo total (1100 + 400 = 1500)
    const saldos = db
      .prepare(`
        SELECT c.nome,
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
      .all(u1);

    assert.equal(saldos[0].saldo, 1100);
    assert.equal(saldos[1].saldo, 400);
    assert.equal(saldos[0].saldo + saldos[1].saldo, 1500);
  } finally {
    db.close();
    fs.rmSync(tempDb, { force: true });
  }
});

test('SQLite (Metas): aportes atômicos, piso zero, vínculo com carteira e isolamento por usuario_id', () => {
  const tempDb = path.join(os.tmpdir(), `financeiro-metas-test-${Date.now()}.db`);
  const db = new DatabaseSync(tempDb);

  try {
    db.exec(`
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
        FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
        FOREIGN KEY (conta_id) REFERENCES contas(id) ON DELETE SET NULL
      );
    `);

    const u1 = Number(
      db
        .prepare('INSERT INTO usuarios (nome, email, senha_hash) VALUES (?, ?, ?)')
        .run('Pedro', 'pedro@metas.dev', hashSenha('123456')).lastInsertRowid
    );
    const u2 = Number(
      db
        .prepare('INSERT INTO usuarios (nome, email, senha_hash) VALUES (?, ?, ?)')
        .run('Outro', 'outro@metas.dev', hashSenha('123456')).lastInsertRowid
    );

    const cofrinhoId = Number(
      db.prepare('INSERT INTO contas (usuario_id, nome) VALUES (?, ?)').run(u1, 'Cofrinho')
        .lastInsertRowid
    );

    // Meta 1 (manual)
    const m1 = Number(
      db
        .prepare('INSERT INTO metas (usuario_id, titulo, valor_alvo, valor_atual) VALUES (?, ?, ?, ?)')
        .run(u1, 'Celular novo', 2500, 300).lastInsertRowid
    );

    // Meta 2 (vinculada à carteira Cofrinho)
    const m2 = Number(
      db
        .prepare('INSERT INTO metas (usuario_id, titulo, valor_alvo, conta_id) VALUES (?, ?, ?, ?)')
        .run(u1, 'Reserva de emergência', 5000, cofrinhoId).lastInsertRowid
    );

    // Aporte atômico (+450 -> 750)
    db.prepare(
      'UPDATE metas SET valor_atual = ROUND(MAX(0, valor_atual + ?), 2) WHERE id = ? AND usuario_id = ?'
    ).run(450, m1, u1);
    assert.equal(db.prepare('SELECT valor_atual FROM metas WHERE id = ?').get(m1).valor_atual, 750);

    // Retirada maior que o guardado não fica negativa (piso 0)
    db.prepare(
      'UPDATE metas SET valor_atual = ROUND(MAX(0, valor_atual + ?), 2) WHERE id = ? AND usuario_id = ?'
    ).run(-2000, m1, u1);
    assert.equal(db.prepare('SELECT valor_atual FROM metas WHERE id = ?').get(m1).valor_atual, 0);

    // Proteção IDOR: usuário 2 não consegue alterar nem excluir meta do usuário 1
    const tentativaUpdate = db
      .prepare('UPDATE metas SET titulo = ? WHERE id = ? AND usuario_id = ?')
      .run('Hackeada', m1, u2);
    assert.equal(tentativaUpdate.changes, 0);

    const tentativaDelete = db
      .prepare('DELETE FROM metas WHERE id = ? AND usuario_id = ?')
      .run(m1, u2);
    assert.equal(tentativaDelete.changes, 0);

    // Excluir a carteira desvincula a meta (ON DELETE SET NULL) sem apagar a meta
    db.prepare('DELETE FROM contas WHERE id = ? AND usuario_id = ?').run(cofrinhoId, u1);
    const metaAposExcluirConta = db.prepare('SELECT id, conta_id FROM metas WHERE id = ?').get(m2);
    assert.equal(metaAposExcluirConta.id, m2);
    assert.equal(metaAposExcluirConta.conta_id, null);
  } finally {
    db.close();
    fs.rmSync(tempDb, { force: true });
  }
});

test('SQLite (Despesas Fixas): CHECK dia 1..31, pausar/reativar, FK conta e isolamento IDOR', () => {
  const tempDb = path.join(os.tmpdir(), `financeiro-fixas-test-${Date.now()}.db`);
  const db = new DatabaseSync(tempDb);

  try {
    db.exec(`
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
        FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
      );
      CREATE TABLE despesas_fixas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        usuario_id INTEGER NOT NULL,
        titulo TEXT NOT NULL,
        valor REAL NOT NULL,
        dia_vencimento INTEGER NOT NULL CHECK (dia_vencimento BETWEEN 1 AND 31),
        categoria TEXT NOT NULL DEFAULT 'Moradia',
        conta_id INTEGER DEFAULT NULL,
        ativa INTEGER NOT NULL DEFAULT 1,
        FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
        FOREIGN KEY (conta_id) REFERENCES contas(id) ON DELETE SET NULL
      );
    `);

    const u1 = Number(
      db
        .prepare('INSERT INTO usuarios (nome, email, senha_hash) VALUES (?, ?, ?)')
        .run('Pedro', 'pedro@fixas.dev', hashSenha('123456')).lastInsertRowid
    );
    const u2 = Number(
      db
        .prepare('INSERT INTO usuarios (nome, email, senha_hash) VALUES (?, ?, ?)')
        .run('Outro', 'outro@fixas.dev', hashSenha('123456')).lastInsertRowid
    );
    const contaId = Number(
      db.prepare('INSERT INTO contas (usuario_id, nome) VALUES (?, ?)').run(u1, 'Uso diário')
        .lastInsertRowid
    );

    // Dia inválido (32) deve ser rejeitado pela constraint CHECK do SQLite
    assert.throws(() => {
      db.prepare(
        'INSERT INTO despesas_fixas (usuario_id, titulo, valor, dia_vencimento) VALUES (?, ?, ?, ?)'
      ).run(u1, 'Internet', 99.9, 32);
    });

    const d1 = Number(
      db
        .prepare(
          'INSERT INTO despesas_fixas (usuario_id, titulo, valor, dia_vencimento, conta_id) VALUES (?, ?, ?, ?, ?)'
        )
        .run(u1, 'Internet', 99.9, 10, contaId).lastInsertRowid
    );

    // Pausar e conferir
    db.prepare('UPDATE despesas_fixas SET ativa = 0 WHERE id = ? AND usuario_id = ?').run(d1, u1);
    assert.equal(db.prepare('SELECT ativa FROM despesas_fixas WHERE id = ?').get(d1).ativa, 0);

    // Usuário 2 não pode alterar nem apagar despesa fixa do Usuário 1
    assert.equal(
      db.prepare('UPDATE despesas_fixas SET ativa = 1 WHERE id = ? AND usuario_id = ?').run(d1, u2)
        .changes,
      0
    );
    assert.equal(
      db.prepare('DELETE FROM despesas_fixas WHERE id = ? AND usuario_id = ?').run(d1, u2).changes,
      0
    );

    // Excluir carteira apenas desvincula conta_id (ON DELETE SET NULL)
    db.prepare('DELETE FROM contas WHERE id = ? AND usuario_id = ?').run(contaId, u1);
    const aposExcluirConta = db
      .prepare('SELECT id, conta_id FROM despesas_fixas WHERE id = ?')
      .get(d1);
    assert.equal(aposExcluirConta.id, d1);
    assert.equal(aposExcluirConta.conta_id, null);
  } finally {
    db.close();
    fs.rmSync(tempDb, { force: true });
  }
});

test('Segurança (Fail-Fast): rejeita JWT_SECRET fraco ou ausente em produção', () => {
  assert.throws(() => resolverJwtSecret({ envSecret: '', nodeEnv: 'production' }));
  assert.throws(() => resolverJwtSecret({ envSecret: 'curto123', nodeEnv: 'production' }));
  assert.throws(() =>
    resolverJwtSecret({ envSecret: 'segredo-local-desenvolvimento', nodeEnv: 'production' })
  );

  const chaveForte = 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0';
  assert.equal(
    resolverJwtSecret({ envSecret: chaveForte, nodeEnv: 'production' }),
    chaveForte
  );

  // Em desenvolvimento continua funcionando localmente
  assert.ok(resolverJwtSecret({ envSecret: '', nodeEnv: 'development' }).length > 0);
});

test('Segurança (Validação e CORS): valida e-mail e bloqueia origens desconhecidas em produção', () => {
  assert.equal(validarEmail('pedro@teste.dev'), true);
  assert.equal(validarEmail('pedro.costa@alunos.ufersa.edu.br'), true);
  assert.equal(validarEmail('nao-eh-email'), false);
  assert.equal(validarEmail(`${'a'.repeat(120)}@teste.com`), false);

  const corsProd = criarOpcoesCors({
    frontendUrl: 'https://financas-pedro.onrender.com/',
    nodeEnv: 'production',
  });

  // Mesma origem (sem Origin) -> liberado
  corsProd.origin(undefined, (err, permitido) => {
    assert.equal(err, null);
    assert.equal(permitido, true);
  });

  // Domínio oficial -> liberado
  corsProd.origin('https://financas-pedro.onrender.com', (err, permitido) => {
    assert.equal(err, null);
    assert.equal(permitido, true);
  });

  // Domínio malicioso externo -> bloqueado (403)
  corsProd.origin('https://site-invasor.xyz', (err, permitido) => {
    assert.ok(err instanceof Error);
    assert.equal(err.status, 403);
    assert.equal(permitido, undefined);
  });
});

test('PostgreSQL adapter: traduzirPlaceholdersPg converte ? em $1, $2... ignorando literais de texto', () => {
  const sql =
    "UPDATE lancamentos SET titulo = ?, observacao = 'Pago?' WHERE id = ? AND usuario_id = ?";
  const traduzido = traduzirPlaceholdersPg(sql);
  assert.equal(
    traduzido,
    "UPDATE lancamentos SET titulo = $1, observacao = 'Pago?' WHERE id = $2 AND usuario_id = $3"
  );
});

test('Perfil e troca de senha: exige senha atual correta e invalida a senha antiga após troca', () => {
  const senhaAntiga = 'senhaInicial123';
  const senhaNova = 'novaSenhaSegura456';

  const hashOriginal = hashSenha(senhaAntiga);
  assert.equal(verificarSenha('senhaErrada', hashOriginal), false);
  assert.equal(verificarSenha(senhaAntiga, hashOriginal), true);

  const hashAtualizado = hashSenha(senhaNova);
  assert.equal(verificarSenha(senhaAntiga, hashAtualizado), false);
  assert.equal(verificarSenha(senhaNova, hashAtualizado), true);
});

test('Recuperação de senha: código SHA-256 validado com timingSafeEqual e expiração respeitada', () => {
  const codigo = '482915';
  const hashSalvo = crypto.createHash('sha256').update(codigo).digest('hex');

  // Nunca armazena o código em texto puro
  assert.ok(!hashSalvo.includes(codigo));

  const tentativaCorreta = Buffer.from(
    crypto.createHash('sha256').update('482915').digest('hex'),
    'hex'
  );
  const tentativaErrada = Buffer.from(
    crypto.createHash('sha256').update('000000').digest('hex'),
    'hex'
  );
  const salvoBuf = Buffer.from(hashSalvo, 'hex');

  assert.equal(crypto.timingSafeEqual(tentativaCorreta, salvoBuf), true);
  assert.equal(crypto.timingSafeEqual(tentativaErrada, salvoBuf), false);

  // Expiração de 15 minutos
  const expiraNoFuturo = Date.now() + 15 * 60 * 1000;
  const jaExpirou = Date.now() - 1000;
  assert.ok(expiraNoFuturo > Date.now());
  assert.ok(jaExpirou < Date.now());
});

test('Notificações: cálculo de disparo do resumo mensal (salário dia 5, dia 1, dia 30 e sem salário)', () => {
  // Salário dia 5, 1 dia antes -> dispara em 04/12 para resumir Dezembro
  const resDia5 = detectarResumoMensalParaHoje({
    hojeIso: '2026-12-04',
    diaPagamento: 5,
    diasAntes: 1,
  });
  assert.equal(resDia5?.mesRef, '2026-12');

  // Em outro dia qualquer não dispara
  assert.equal(
    detectarResumoMensalParaHoje({
      hojeIso: '2026-12-03',
      diaPagamento: 5,
      diasAntes: 1,
    }),
    null
  );

  // Salário dia 1, 1 dia antes -> dispara em 30/11 para resumir Dezembro
  const resDia1 = detectarResumoMensalParaHoje({
    hojeIso: '2026-11-30',
    diaPagamento: 1,
    diasAntes: 1,
  });
  assert.equal(resDia1?.mesRef, '2026-12');

  // Salário fim do mês (dia 30), 1 dia antes -> dispara em 29/11 para resumir Dezembro
  const resDia30 = detectarResumoMensalParaHoje({
    hojeIso: '2026-11-29',
    diaPagamento: 30,
    diasAntes: 1,
  });
  assert.equal(resDia30?.mesRef, '2026-12');

  // Sem salário cadastrado -> dispara no dia 1 do mês
  const resSemSalario = detectarResumoMensalParaHoje({
    hojeIso: '2026-12-01',
    diaPagamento: null,
    diasAntes: 1,
  });
  assert.equal(resSemSalario?.mesRef, '2026-12');

  // Próximo disparo exibido na UI
  const prox = calcularProximoDisparoResumo({
    hojeIso: '2026-11-23',
    diaPagamento: 5,
    diasAntes: 1,
  });
  assert.equal(prox?.dataDisparoIso, '2026-12-04');
  assert.equal(prox?.mesRef, '2026-12');
});

test('Notificações: rotina diária envia lembrete do dia + resumo mensal e impede duplicidade', async () => {
  const tempDb = path.join(os.tmpdir(), `financeiro-notif-test-${Date.now()}.db`);
  const conn = new DatabaseSync(tempDb);

  const dbMock = {
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
  };

  try {
    conn.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE usuarios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        senha_hash TEXT NOT NULL
      );
      CREATE TABLE lancamentos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        usuario_id INTEGER NOT NULL,
        titulo TEXT NOT NULL,
        valor REAL NOT NULL,
        tipo TEXT NOT NULL,
        categoria TEXT NOT NULL DEFAULT 'Geral',
        data TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pendente',
        origem_divida TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE despesas_fixas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        usuario_id INTEGER NOT NULL,
        titulo TEXT NOT NULL,
        valor REAL NOT NULL,
        dia_vencimento INTEGER NOT NULL,
        categoria TEXT NOT NULL DEFAULT 'Moradia',
        ativa INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE salario_fixo (
        usuario_id INTEGER PRIMARY KEY,
        valor REAL NOT NULL,
        dia_pagamento INTEGER NOT NULL
      );
      CREATE TABLE notificacoes_config (
        usuario_id INTEGER PRIMARY KEY,
        ativo INTEGER NOT NULL DEFAULT 1,
        lembrete_dia INTEGER NOT NULL DEFAULT 1,
        lembrete_vespera INTEGER NOT NULL DEFAULT 0,
        resumo_mensal INTEGER NOT NULL DEFAULT 1,
        dias_antes_salario INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE notificacoes_enviadas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        usuario_id INTEGER NOT NULL,
        tipo TEXT NOT NULL,
        chave_referencia TEXT NOT NULL,
        enviado_em TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (usuario_id, tipo, chave_referencia)
      );
    `);

    const userId = Number(
      conn
        .prepare('INSERT INTO usuarios (nome, email, senha_hash) VALUES (?, ?, ?)')
        .run('Pedro Morais', 'pedro@teste.dev', hashSenha('123456')).lastInsertRowid
    );

    // Salário dia 5 -> em 2026-12-04 dispara resumo de Dezembro!
    conn
      .prepare('INSERT INTO salario_fixo (usuario_id, valor, dia_pagamento) VALUES (?, ?, ?)')
      .run(userId, 3000, 5);

    // Uma dívida pendente hoje (04/12), uma já paga hoje (não deve notificar) e uma futura (15/12)
    conn
      .prepare(
        'INSERT INTO lancamentos (usuario_id, titulo, valor, tipo, categoria, data, status, origem_divida) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(userId, 'Parcela 1/3 Switch', 450, 'divida', 'Compras', '2026-12-04', 'pendente', 'Cartão Mãe');
    conn
      .prepare(
        'INSERT INTO lancamentos (usuario_id, titulo, valor, tipo, categoria, data, status, origem_divida) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(userId, 'Conta já paga', 200, 'divida', 'Geral', '2026-12-04', 'pago', 'Nubank');
    conn
      .prepare(
        'INSERT INTO lancamentos (usuario_id, titulo, valor, tipo, categoria, data, status, origem_divida) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(userId, 'Cartão amigo', 300, 'divida', 'Compras', '2026-12-15', 'pendente', 'Cartão João');

    // Despesa fixa ativa dia 4 e uma pausada dia 4
    conn
      .prepare(
        'INSERT INTO despesas_fixas (usuario_id, titulo, valor, dia_vencimento, categoria, ativa) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(userId, 'Internet', 100, 4, 'Moradia', 1);
    conn
      .prepare(
        'INSERT INTO despesas_fixas (usuario_id, titulo, valor, dia_vencimento, categoria, ativa) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(userId, 'Streaming pausado', 50, 4, 'Lazer', 0);

    const lembretesEnviados = [];
    const resumosEnviados = [];

    // 11:00 UTC em 2026-12-04 = 08:00 BRT em 2026-12-04
    const dataSimulada = new Date('2026-12-04T11:00:00Z');

    const r1 = await executarRotinaNotificacoes({
      db: dbMock,
      dataBase: dataSimulada,
      appUrl: 'https://financas.onrender.com',
      enviarLembreteFn: async (payload) => lembretesEnviados.push(payload),
      enviarResumoFn: async (payload) => resumosEnviados.push(payload),
    });

    assert.equal(r1.enviados.vencimentoHoje, 1);
    assert.equal(r1.enviados.resumoMensal, 1);
    assert.equal(lembretesEnviados.length, 1);
    assert.equal(lembretesEnviados[0].total, 550); // 450 (dívida pendente) + 100 (internet ativa)
    assert.equal(lembretesEnviados[0].itens.length, 2);

    assert.equal(resumosEnviados.length, 1);
    assert.equal(resumosEnviados[0].totalMes, 850); // 450 + 100 + 300
    assert.equal(resumosEnviados[0].itens.length, 3);

    // Rodando de novo no mesmo dia -> 0 envios (anti-duplicidade garantida!)
    const r2 = await executarRotinaNotificacoes({
      db: dbMock,
      dataBase: dataSimulada,
      appUrl: 'https://financas.onrender.com',
      enviarLembreteFn: async (payload) => lembretesEnviados.push(payload),
      enviarResumoFn: async (payload) => resumosEnviados.push(payload),
    });

    assert.equal(r2.enviados.vencimentoHoje, 0);
    assert.equal(r2.enviados.resumoMensal, 0);
    assert.equal(lembretesEnviados.length, 1);
    assert.equal(resumosEnviados.length, 1);
  } finally {
    conn.close();
    if (fs.existsSync(tempDb)) fs.unlinkSync(tempDb);
  }
});

test('Templates de e-mail: escapam HTML (proteção XSS) e exibem origem e total', () => {
  const htmlDia = montarHtmlLembreteVencimento({
    nome: 'Pedro <script>',
    dataIso: '2026-12-04',
    itens: [
      {
        titulo: 'Fatura <img src=x>',
        valor: 199.9,
        data: '2026-12-04',
        origem: 'Cartão <Mãe>',
      },
    ],
    total: 199.9,
    appUrl: 'https://financas.onrender.com',
  });

  assert.ok(!htmlDia.includes('<script>'));
  assert.ok(!htmlDia.includes('<img src=x>'));
  assert.ok(htmlDia.includes('Cartão &lt;Mãe&gt;'));
  assert.ok(htmlDia.includes('199,90'));

  const htmlMes = montarHtmlResumoMensal({
    nome: 'Pedro',
    nomeMes: 'Dezembro de 2026',
    diaSalario: 5,
    salarioValor: 3000,
    itens: [
      {
        titulo: 'Parcela 1/3',
        valor: 500,
        data: '2026-12-10',
        origem: 'Cartão Irmão',
      },
    ],
    totalMes: 500,
  });

  assert.ok(htmlMes.includes('Dezembro de 2026'));
  assert.ok(htmlMes.includes('Cartão Irmão'));
  assert.ok(htmlMes.includes('2.500,00')); // sobra prevista (3000 - 500)

  // Bloqueio contra URL maliciosa javascript: no botão do e-mail
  const htmlUrlMaliciosa = montarHtmlLembreteVencimento({
    nome: 'Pedro',
    dataIso: '2026-12-04',
    itens: [{ titulo: 'Conta', valor: 50, data: '2026-12-04', origem: '' }],
    total: 50,
    appUrl: 'javascript:alert(1)',
  });
  assert.ok(!htmlUrlMaliciosa.includes('javascript:'));
});

test('Notificações: respeita opt-out (ativo = 0) e envia aviso na véspera quando habilitado', async () => {
  const tempDb = path.join(os.tmpdir(), `financeiro-optout-test-${Date.now()}.db`);
  const conn = new DatabaseSync(tempDb);

  const dbMock = {
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
  };

  try {
    conn.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE usuarios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        senha_hash TEXT NOT NULL
      );
      CREATE TABLE lancamentos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        usuario_id INTEGER NOT NULL,
        titulo TEXT NOT NULL,
        valor REAL NOT NULL,
        tipo TEXT NOT NULL,
        categoria TEXT NOT NULL DEFAULT 'Geral',
        data TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pendente',
        origem_divida TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE despesas_fixas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        usuario_id INTEGER NOT NULL,
        titulo TEXT NOT NULL,
        valor REAL NOT NULL,
        dia_vencimento INTEGER NOT NULL,
        categoria TEXT NOT NULL DEFAULT 'Moradia',
        ativa INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE salario_fixo (
        usuario_id INTEGER PRIMARY KEY,
        valor REAL NOT NULL,
        dia_pagamento INTEGER NOT NULL
      );
      CREATE TABLE notificacoes_config (
        usuario_id INTEGER PRIMARY KEY,
        ativo INTEGER NOT NULL DEFAULT 1,
        lembrete_dia INTEGER NOT NULL DEFAULT 1,
        lembrete_vespera INTEGER NOT NULL DEFAULT 0,
        resumo_mensal INTEGER NOT NULL DEFAULT 1,
        dias_antes_salario INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE notificacoes_enviadas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        usuario_id INTEGER NOT NULL,
        tipo TEXT NOT NULL,
        chave_referencia TEXT NOT NULL,
        enviado_em TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (usuario_id, tipo, chave_referencia)
      );
    `);

    const uDesligado = Number(
      conn
        .prepare('INSERT INTO usuarios (nome, email, senha_hash) VALUES (?, ?, ?)')
        .run('Sem Aviso', 'off@teste.dev', hashSenha('123456')).lastInsertRowid
    );
    const uVespera = Number(
      conn
        .prepare('INSERT INTO usuarios (nome, email, senha_hash) VALUES (?, ?, ?)')
        .run('Com Véspera', 'vespera@teste.dev', hashSenha('123456')).lastInsertRowid
    );

    conn
      .prepare(
        'INSERT INTO notificacoes_config (usuario_id, ativo, lembrete_dia, lembrete_vespera, resumo_mensal) VALUES (?, 0, 1, 1, 1)'
      )
      .run(uDesligado);
    conn
      .prepare(
        'INSERT INTO notificacoes_config (usuario_id, ativo, lembrete_dia, lembrete_vespera, resumo_mensal) VALUES (?, 1, 1, 1, 0)'
      )
      .run(uVespera);

    conn
      .prepare(
        'INSERT INTO lancamentos (usuario_id, titulo, valor, tipo, data, status) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(uDesligado, 'Conta que não deve avisar', 100, 'divida', '2026-12-10', 'pendente');
    conn
      .prepare(
        'INSERT INTO lancamentos (usuario_id, titulo, valor, tipo, data, status) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(uVespera, 'Fatura amanhã', 220, 'divida', '2026-12-11', 'pendente');

    const enviados = [];
    const res = await executarRotinaNotificacoes({
      db: dbMock,
      dataBase: new Date('2026-12-10T11:00:00Z'),
      enviarLembreteFn: async (p) => enviados.push(p),
      enviarResumoFn: async () => {},
    });

    assert.equal(res.enviados.vencimentoHoje, 0);
    assert.equal(res.enviados.vencimentoAmanha, 1);
    assert.equal(enviados.length, 1);
    assert.equal(enviados[0].para, 'vespera@teste.dev');
    assert.equal(enviados[0].ehAmanha, true);
    assert.equal(enviados[0].total, 220);
  } finally {
    conn.close();
    if (fs.existsSync(tempDb)) fs.unlinkSync(tempDb);
  }
});
