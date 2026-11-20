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
