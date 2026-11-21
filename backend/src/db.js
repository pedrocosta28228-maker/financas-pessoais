import 'dotenv/config';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const sqlitePath = path.join(__dirname, '..', 'financas.db');

/**
 * Converte placeholders "?" (estilo SQLite) para "$1, $2, $3..." (estilo PostgreSQL),
 * ignorando "?" que eventualmente apareçam dentro de textos entre aspas simples.
 */
export function traduzirPlaceholdersPg(sql) {
  let indice = 0;
  let dentroDeTexto = false;
  let resultado = '';

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'") {
      // Trata aspas escapadas '' dentro de string SQL
      if (dentroDeTexto && sql[i + 1] === "'") {
        resultado += "''";
        i += 1;
        continue;
      }
      dentroDeTexto = !dentroDeTexto;
      resultado += ch;
    } else if (ch === '?' && !dentroDeTexto) {
      indice += 1;
      resultado += `$${indice}`;
    } else {
      resultado += ch;
    }
  }

  return resultado;
}

const DATABASE_URL = (process.env.DATABASE_URL || '').trim();
export const dbType = DATABASE_URL ? 'postgres' : 'sqlite';

let sqliteDb = null;
let pgPool = null;

if (dbType === 'postgres') {
  const ehLocal =
    DATABASE_URL.includes('localhost') || DATABASE_URL.includes('127.0.0.1');

  pgPool = new Pool({
    connectionString: DATABASE_URL,
    ssl: ehLocal ? false : { rejectUnauthorized: false },
  });
} else {
  sqliteDb = new DatabaseSync(sqlitePath);
  sqliteDb.exec('PRAGMA foreign_keys = ON;');
}

function criarExecutorPg(runner) {
  return {
    async get(sql, ...params) {
      const res = await runner.query(traduzirPlaceholdersPg(sql), params);
      return res.rows[0] ?? undefined;
    },
    async all(sql, ...params) {
      const res = await runner.query(traduzirPlaceholdersPg(sql), params);
      return res.rows;
    },
    async run(sql, ...params) {
      const res = await runner.query(traduzirPlaceholdersPg(sql), params);
      return { changes: res.rowCount ?? 0 };
    },
    async insert(sql, ...params) {
      const sqlComReturning = /\bRETURNING\b/i.test(sql)
        ? sql
        : `${sql.trim().replace(/;$/, '')} RETURNING id`;
      const res = await runner.query(traduzirPlaceholdersPg(sqlComReturning), params);
      return Number(res.rows[0]?.id);
    },
  };
}

function criarExecutorSqlite(conn) {
  return {
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
  };
}

const baseExecutor =
  dbType === 'postgres' ? criarExecutorPg(pgPool) : criarExecutorSqlite(sqliteDb);

/**
 * Interface unificada assíncrona do banco de dados:
 * funciona tanto em SQLite local (seu PC) quanto em PostgreSQL na nuvem (Neon/Render).
 */
export const db = {
  ...baseExecutor,

  /**
   * Executa um bloco de queries dentro de uma Transação SQL (tudo ou nada).
   */
  async transaction(fn) {
    if (dbType === 'postgres') {
      const client = await pgPool.connect();
      try {
        await client.query('BEGIN');
        const resultado = await fn(criarExecutorPg(client));
        await client.query('COMMIT');
        return resultado;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }

    sqliteDb.exec('BEGIN');
    try {
      const resultado = await fn(criarExecutorSqlite(sqliteDb));
      sqliteDb.exec('COMMIT');
      return resultado;
    } catch (err) {
      sqliteDb.exec('ROLLBACK');
      throw err;
    }
  },
};

/**
 * Cria todas as 6 tabelas SQL (se ainda não existirem) e aplica migrações seguras no SQLite local.
 */
export async function initDb() {
  if (dbType === 'postgres') {
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS usuarios (
        id SERIAL PRIMARY KEY,
        nome TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        senha_hash TEXT NOT NULL,
        criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS contas (
        id SERIAL PRIMARY KEY,
        usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
        nome TEXT NOT NULL,
        etiqueta TEXT NOT NULL DEFAULT '',
        rendimento TEXT NOT NULL DEFAULT '',
        cor TEXT NOT NULL DEFAULT '#3b82f6',
        saldo_ajuste DOUBLE PRECISION NOT NULL DEFAULT 0,
        criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS lancamentos (
        id SERIAL PRIMARY KEY,
        usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
        titulo TEXT NOT NULL,
        valor DOUBLE PRECISION NOT NULL,
        tipo TEXT NOT NULL CHECK (tipo IN ('entrada', 'saida', 'divida')),
        categoria TEXT NOT NULL DEFAULT 'Geral',
        data TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pago' CHECK (status IN ('pago', 'pendente')),
        observacao TEXT DEFAULT '',
        grupo_parcela TEXT DEFAULT NULL,
        descontar_saldo INTEGER NOT NULL DEFAULT 1,
        conta_id INTEGER DEFAULT NULL REFERENCES contas(id) ON DELETE SET NULL,
        origem_divida TEXT NOT NULL DEFAULT '',
        criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS salario_fixo (
        usuario_id INTEGER PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
        valor DOUBLE PRECISION NOT NULL,
        dia_pagamento INTEGER NOT NULL CHECK (dia_pagamento BETWEEN 1 AND 31),
        conta_id INTEGER DEFAULT NULL REFERENCES contas(id) ON DELETE SET NULL,
        atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS metas (
        id SERIAL PRIMARY KEY,
        usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
        titulo TEXT NOT NULL,
        valor_alvo DOUBLE PRECISION NOT NULL,
        valor_atual DOUBLE PRECISION NOT NULL DEFAULT 0,
        prazo TEXT DEFAULT NULL,
        cor TEXT NOT NULL DEFAULT '#22c55e',
        conta_id INTEGER DEFAULT NULL REFERENCES contas(id) ON DELETE SET NULL,
        observacao TEXT NOT NULL DEFAULT '',
        criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS despesas_fixas (
        id SERIAL PRIMARY KEY,
        usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
        titulo TEXT NOT NULL,
        valor DOUBLE PRECISION NOT NULL,
        dia_vencimento INTEGER NOT NULL CHECK (dia_vencimento BETWEEN 1 AND 31),
        categoria TEXT NOT NULL DEFAULT 'Moradia',
        conta_id INTEGER DEFAULT NULL REFERENCES contas(id) ON DELETE SET NULL,
        ativa INTEGER NOT NULL DEFAULT 1,
        criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    console.log('Banco de dados PostgreSQL conectado e tabelas prontas!');
    return;
  }

  // SQLite local (desenvolvimento no seu computador)
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      senha_hash TEXT NOT NULL,
      criado_em TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS contas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER NOT NULL,
      nome TEXT NOT NULL,
      etiqueta TEXT NOT NULL DEFAULT '',
      rendimento TEXT NOT NULL DEFAULT '',
      cor TEXT NOT NULL DEFAULT '#3b82f6',
      saldo_ajuste REAL NOT NULL DEFAULT 0,
      criado_em TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS lancamentos (
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

    CREATE TABLE IF NOT EXISTS salario_fixo (
      usuario_id INTEGER PRIMARY KEY,
      valor REAL NOT NULL,
      dia_pagamento INTEGER NOT NULL CHECK (dia_pagamento BETWEEN 1 AND 31),
      conta_id INTEGER DEFAULT NULL,
      atualizado_em TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
      FOREIGN KEY (conta_id) REFERENCES contas(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS metas (
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
      FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
      FOREIGN KEY (conta_id) REFERENCES contas(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS despesas_fixas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER NOT NULL,
      titulo TEXT NOT NULL,
      valor REAL NOT NULL,
      dia_vencimento INTEGER NOT NULL CHECK (dia_vencimento BETWEEN 1 AND 31),
      categoria TEXT NOT NULL DEFAULT 'Moradia',
      conta_id INTEGER DEFAULT NULL,
      ativa INTEGER NOT NULL DEFAULT 1,
      criado_em TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
      FOREIGN KEY (conta_id) REFERENCES contas(id) ON DELETE SET NULL
    );
  `);

  // Migrações seguras para bancos SQLite antigos sem perder nenhum dado
  const colunasContas = sqliteDb.prepare('PRAGMA table_info(contas)').all();
  if (!colunasContas.some((c) => c.name === 'rendimento')) {
    sqliteDb.exec("ALTER TABLE contas ADD COLUMN rendimento TEXT NOT NULL DEFAULT '';");
  }

  const colunasLancamentos = sqliteDb.prepare('PRAGMA table_info(lancamentos)').all();
  if (!colunasLancamentos.some((c) => c.name === 'grupo_parcela')) {
    sqliteDb.exec('ALTER TABLE lancamentos ADD COLUMN grupo_parcela TEXT DEFAULT NULL;');
  }
  if (!colunasLancamentos.some((c) => c.name === 'descontar_saldo')) {
    sqliteDb.exec('ALTER TABLE lancamentos ADD COLUMN descontar_saldo INTEGER NOT NULL DEFAULT 1;');
  }
  if (!colunasLancamentos.some((c) => c.name === 'conta_id')) {
    sqliteDb.exec('ALTER TABLE lancamentos ADD COLUMN conta_id INTEGER DEFAULT NULL;');
  }
  if (!colunasLancamentos.some((c) => c.name === 'origem_divida')) {
    sqliteDb.exec("ALTER TABLE lancamentos ADD COLUMN origem_divida TEXT NOT NULL DEFAULT '';");
  }

  console.log(`Banco de dados SQLite pronto em: ${sqlitePath}`);
}
