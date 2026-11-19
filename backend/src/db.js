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

  -- Tabela 2: Lançamentos financeiros (Entradas, Saídas e Dívidas)
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
    criado_em TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
  );
`);

// Migração segura: se o banco já existia antes da função de parcelas, adiciona a coluna sem perder nenhum dado
const colunasLancamentos = db.prepare('PRAGMA table_info(lancamentos)').all();
if (!colunasLancamentos.some((c) => c.name === 'grupo_parcela')) {
  db.exec('ALTER TABLE lancamentos ADD COLUMN grupo_parcela TEXT DEFAULT NULL;');
}

console.log(`Banco de dados SQLite pronto em: ${dbPath}`);
