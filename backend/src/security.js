import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

const SEGREDOS_FRACOS = new Set([
  'segredo-local-desenvolvimento',
  'troque-por-uma-chave-secreta-bem-longa-e-aleatoria',
  'secret',
  '123456',
]);

/**
 * Resolve e valida o JWT_SECRET.
 * Em produção (NODE_ENV=production), aplica "Fail-Fast": impede o servidor de subir
 * sem uma chave forte (>= 32 caracteres), evitando exposição de contas na internet.
 */
export function resolverJwtSecret({
  envSecret = process.env.JWT_SECRET,
  nodeEnv = process.env.NODE_ENV,
} = {}) {
  const limpo = (envSecret || '').trim();
  const emProducao = nodeEnv === 'production';

  if (emProducao) {
    if (!limpo || limpo.length < 32 || SEGREDOS_FRACOS.has(limpo)) {
      throw new Error(
        'SEGURANÇA: Em produção (NODE_ENV=production), defina um JWT_SECRET forte e aleatório com pelo menos 32 caracteres.'
      );
    }
    return limpo;
  }

  return limpo || 'segredo-local-desenvolvimento';
}

/**
 * Valida formato básico de e-mail e tamanho máximo (evita payloads gigantes).
 */
export function validarEmail(email) {
  if (typeof email !== 'string') return false;
  const limpo = email.trim().toLowerCase();
  if (limpo.length < 5 || limpo.length > 120) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(limpo);
}

/**
 * Configura o CORS:
 * - Em produção: aceita apenas o(s) endereço(s) listados em FRONTEND_URL (além de requisições da mesma origem).
 * - Em desenvolvimento: aceita localhost nas portas do Vite (5173) e Express (3001).
 */
export function criarOpcoesCors({
  frontendUrl = process.env.FRONTEND_URL || '',
  renderExternalUrl = process.env.RENDER_EXTERNAL_URL || '',
  nodeEnv = process.env.NODE_ENV,
} = {}) {
  const emProducao = nodeEnv === 'production';

  const permitidas = new Set(
    [frontendUrl, renderExternalUrl]
      .join(',')
      .split(',')
      .map((u) => u.trim().replace(/\/+$/, ''))
      .filter(Boolean)
  );

  if (!emProducao) {
    permitidas.add('http://localhost:3001');
    permitidas.add('http://127.0.0.1:3001');
    permitidas.add('http://localhost:5173');
    permitidas.add('http://127.0.0.1:5173');
  }

  return {
    origin(origin, callback) {
      // Requisições sem cabeçalho Origin (mesma origem, health checks, navegador abrindo o HTML)
      if (!origin) return callback(null, true);

      const origemLimpa = origin.replace(/\/+$/, '');
      if (permitidas.has(origemLimpa)) {
        return callback(null, true);
      }

      // Em produção sem FRONTEND_URL configurado, o frontend servido pelo próprio Express funciona
      // na mesma origem, e qualquer outro site externo é bloqueado.
      const err = new Error('Origem não autorizada pelo CORS.');
      err.status = 403;
      return callback(err);
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  };
}

/**
 * Helmet: adiciona cabeçalhos HTTP de segurança (anti-clickjacking, nosniff, CSP etc.)
 * liberando nossas fontes do Google Fonts (Plus Jakarta Sans) e estilos inline do React.
 */
export const helmetMiddleware = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'", 'https://fonts.googleapis.com', 'https://fonts.gstatic.com'],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
});

/**
 * Rate Limit estrito para Login e Cadastro:
 * bloqueia ataques de força bruta (robôs testando milhares de senhas).
 * Máximo de 15 tentativas a cada 15 minutos por IP.
 */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 15,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    erro: 'Muitas tentativas seguidas. Por segurança, aguarde alguns minutos e tente novamente.',
  },
});

/**
 * Rate Limit geral para a API:
 * evita sobrecarga/spam contra o servidor gratuito (300 requisições a cada 15 minutos por IP).
 */
export const apiRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    erro: 'Muitas requisições em pouco tempo. Aguarde um instante e tente novamente.',
  },
});

/**
 * Rate Limit dedicado para o Agente de IA:
 * protege a cota gratuita da API do Gemini contra rajadas de mensagens (30 a cada 15 min por IP).
 */
export const agenteRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    erro: 'Muitas mensagens para o assistente em pouco tempo. Aguarde alguns minutos e tente novamente.',
  },
});
