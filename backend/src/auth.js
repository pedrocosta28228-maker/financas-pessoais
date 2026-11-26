import 'dotenv/config';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { db } from './db.js';
import { resolverJwtSecret } from './security.js';

const JWT_SECRET = resolverJwtSecret();

/**
 * Transforma uma senha em texto puro em um hash criptográfico seguro (scrypt + salt aleatório).
 * Mesmo que alguém abra o arquivo financas.db, nunca verá sua senha original.
 */
export function hashSenha(senha) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(senha, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

const DUMMY_SENHA_HASH = hashSenha('senha-dummy-anti-timing-check');

/**
 * Compara a senha digitada no login com o hash salvo no banco de dados.
 */
export function verificarSenha(senhaDigitada, senhaSalva) {
  const [salt, hashOriginal] = senhaSalva.split(':');
  if (!salt || !hashOriginal) return false;

  const hashTentativa = crypto.scryptSync(senhaDigitada, salt, 64);
  const hashOriginalBuffer = Buffer.from(hashOriginal, 'hex');

  if (hashTentativa.length !== hashOriginalBuffer.length) return false;
  return crypto.timingSafeEqual(hashTentativa, hashOriginalBuffer);
}

/**
 * Executa uma comparação scrypt fictícia quando o e-mail não existe no login,
 * reduzindo diferenças de tempo de resposta (anti-timing attack).
 */
export function verificarSenhaDummy(senhaDigitada) {
  return verificarSenha(String(senhaDigitada || ''), DUMMY_SENHA_HASH);
}

/**
 * Gera o "crachá digital" (Token JWT) que o navegador usa para provar que você está logado.
 * Inclui "tv" (token_version) para revogar sessões antigas imediatamente ao trocar/redefinir senha.
 */
export function gerarToken(usuario) {
  return jwt.sign(
    {
      id: usuario.id,
      nome: usuario.nome,
      email: usuario.email,
      tv: Number(usuario.tokenVersion ?? usuario.token_version ?? 0),
    },
    JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '7d' }
  );
}

/**
 * Valida a assinatura do JWT restringindo explicitamente ao algoritmo HS256.
 */
export function verificarToken(token) {
  return jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
}

/**
 * Cria o middleware "Porteiro": valida JWT (HS256) e confere token_version no banco
 * para garantir que sessões revogadas (troca/redefinição de senha) sejam bloqueadas na hora.
 */
export function criarMiddlewareAutenticar(dbInstancia = db) {
  return async function autenticarMiddleware(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ erro: 'Acesso negado. Faça login para continuar.' });
    }

    const token = authHeader.slice(7);

    let dadosUsuario;
    try {
      dadosUsuario = verificarToken(token);
    } catch {
      return res.status(401).json({ erro: 'Sessão inválida ou expirada. Faça login novamente.' });
    }

    const usuarioId = Number(dadosUsuario?.id);
    if (!Number.isInteger(usuarioId) || usuarioId <= 0) {
      return res.status(401).json({ erro: 'Sessão inválida ou expirada. Faça login novamente.' });
    }

    try {
      const usuarioDb = await dbInstancia.get(
        'SELECT id, token_version FROM usuarios WHERE id = ?',
        usuarioId
      );
      if (!usuarioDb) {
        return res.status(401).json({ erro: 'Sessão inválida. Faça login novamente.' });
      }

      const versaoToken = Number(dadosUsuario.tv ?? 0);
      const versaoBanco = Number(usuarioDb.token_version ?? 0);
      if (versaoToken !== versaoBanco) {
        return res
          .status(401)
          .json({ erro: 'Sessão encerrada após alteração de senha. Faça login novamente.' });
      }

      req.usuario = { ...dadosUsuario, id: usuarioId, tokenVersion: versaoBanco };
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

export const autenticar = criarMiddlewareAutenticar(db);
