import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Descobre o caminho da pasta "backend/" para salvar o arquivo financas.db sempre no lugar certo
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.join(__dirname, '..', 'financas.db');

// Abre (ou cria automaticamente) o arquivo do banco de dados SQLite
export const db = new DatabaseSync(dbPath);

// Ativa a verificação de chaves estrangeiras (FOREIGN KEY) no SQLite
db.exec('PRAGMA foreign_keys = ON;');

// Cria as tabelas SQL caso ainda não existam
db.exec(`
  -- Tabela 1: Usuários do sistema (para o Login)
  CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    senha_hash TEXT NOT NULL,
    criado_em TEXT DEFAULT (datetime('now', 'localtime'))
  );

  -- Tabela 2: Carteiras / Contas (onde o dinheiro está guardado)
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

  -- Tabela 3: Lançamentos financeiros (Entradas, Saídas e Dívidas)
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

  -- Tabela 4: Configuração de Salário Fixo recorrente (1 por usuário)
  CREATE TABLE IF NOT EXISTS salario_fixo (
    usuario_id INTEGER PRIMARY KEY,
    valor REAL NOT NULL,
    dia_pagamento INTEGER NOT NULL CHECK (dia_pagamento BETWEEN 1 AND 31),
    conta_id INTEGER DEFAULT NULL,
    atualizado_em TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
    FOREIGN KEY (conta_id) REFERENCES contas(id) ON DELETE SET NULL
  );
`);

// Migrações seguras: adiciona novas colunas em bancos já existentes sem perder nenhum dado
const colunasContas = db.prepare('PRAGMA table_info(contas)').all();
if (!colunasContas.some((c) => c.name === 'rendimento')) {
  db.exec("ALTER TABLE contas ADD COLUMN rendimento TEXT NOT NULL DEFAULT '';");
}

const colunasLancamentos = db.prepare('PRAGMA table_info(lancamentos)').all();
if (!colunasLancamentos.some((c) => c.name === 'grupo_parcela')) {
  db.exec('ALTER TABLE lancamentos ADD COLUMN grupo_parcela TEXT DEFAULT NULL;');
}
if (!colunasLancamentos.some((c) => c.name === 'descontar_saldo')) {
  db.exec('ALTER TABLE lancamentos ADD COLUMN descontar_saldo INTEGER NOT NULL DEFAULT 1;');
}
if (!colunasLancamentos.some((c) => c.name === 'conta_id')) {
  db.exec('ALTER TABLE lancamentos ADD COLUMN conta_id INTEGER DEFAULT NULL;');
}
if (!colunasLancamentos.some((c) => c.name === 'origem_divida')) {
  db.exec("ALTER TABLE lancamentos ADD COLUMN origem_divida TEXT NOT NULL DEFAULT '';");
}

console.log(`Banco de dados SQLite pronto em: ${dbPath}`);
