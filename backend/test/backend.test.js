import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { hashSenha, verificarSenha, gerarToken } from '../src/auth.js';

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
