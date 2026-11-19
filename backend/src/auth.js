import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'segredo-local-desenvolvimento';

/**
 * Transforma uma senha em texto puro em um hash criptográfico seguro (scrypt + salt aleatório).
 * Mesmo que alguém abra o arquivo financas.db, nunca verá sua senha original.
 */
export function hashSenha(senha) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(senha, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

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
 * Gera o "crachá digital" (Token JWT) que o navegador usa para provar que você está logado.
 */
export function gerarToken(usuario) {
  return jwt.sign(
    { id: usuario.id, nome: usuario.nome, email: usuario.email },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

/**
 * Middleware "Porteiro": roda antes das rotas protegidas para exigir um token válido.
 */
export function autenticar(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ erro: 'Acesso negado. Faça login para continuar.' });
  }

  const token = authHeader.slice(7);

  try {
    const dadosUsuario = jwt.verify(token, JWT_SECRET);
    req.usuario = dadosUsuario; // Disponibiliza { id, nome, email } para a rota
    return next();
  } catch {
    return res.status(401).json({ erro: 'Sessão inválida ou expirada. Faça login novamente.' });
  }
}
