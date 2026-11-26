import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, initDb, dbType } from './db.js';
import { hashSenha, verificarSenha, verificarSenhaDummy, gerarToken, autenticar } from './auth.js';
import {
  enviarCodigoRecuperacao,
  enviarLembreteVencimento,
  enviarResumoMensal,
  emailConfigurado,
} from './email.js';
import {
  obterDataBrasilia,
  obterConfigNotificacaoUsuario,
  calcularProximoDisparoResumo,
  coletarContasDoDia,
  coletarResumoDoMes,
  executarRotinaNotificacoes,
} from './notificacoes.js';
import {
  helmetMiddleware,
  criarOpcoesCors,
  authRateLimiter,
  apiRateLimiter,
  agenteRateLimiter,
  validarEmail,
  validarIdPositivo,
} from './security.js';
import {
  obterStatusAgente,
  carregarHistoricoAgente,
  limparHistoricoAgente,
  processarMensagemAgente,
} from './agente.js';
import {
  confirmarAcaoPendente,
  cancelarAcaoPendente,
} from './agente-tools.js';

/**
 * Envolve rotas async no Express 4 para que qualquer erro rejeitado
 * caia automaticamente no tratador global de erros (sem travar o servidor).
 */
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

/**
 * Soma N meses a uma data YYYY-MM-DD preservando o dia de vencimento
 * (ex.: 2026-01-31 + 1 mês = 2026-02-28, e + 2 meses = 2026-03-31).
 */
function somarMesesSeguro(dataIso, mesesParaSomar) {
  const [anoOrig, mesOrig, diaOrig] = dataIso.split('-').map(Number);
  const totalMeses = anoOrig * 12 + (mesOrig - 1) + mesesParaSomar;
  const novoAno = Math.floor(totalMeses / 12);
  const novoMes = (totalMeses % 12) + 1;
  const ultimoDiaDoMes = new Date(novoAno, novoMes, 0).getDate();
  const diaFinal = Math.min(diaOrig, ultimoDiaDoMes);

  return `${novoAno}-${String(novoMes).padStart(2, '0')}-${String(diaFinal).padStart(2, '0')}`;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;
const IS_PROD = process.env.NODE_ENV === 'production';
const HOST = IS_PROD ? '0.0.0.0' : '127.0.0.1';

// Em hospedagens na nuvem (Render, Railway etc.), existe um proxy na frente do Node.
// "trust proxy" permite ao Rate Limit enxergar o IP real de cada visitante.
if (IS_PROD) {
  app.set('trust proxy', 1);
}

// Esconde o cabeçalho "X-Powered-By: Express" para não facilitar reconhecimento por invasores
app.disable('x-powered-by');

// Middlewares de segurança e leitura de JSON com limite de tamanho (100kb)
app.use(helmetMiddleware);
app.use(cors(criarOpcoesCors()));
app.use(express.json({ limit: '100kb' }));
app.use('/api', apiRateLimiter);

// Rota simples para testar se o servidor está no ar (sem expor detalhes internos de banco/stack)
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, mensagem: 'API Financeiro rodando!' });
});

// ============================================================================
// ROTAS DE AUTENTICAÇÃO (Cadastro, Login e Usuário Logado)
// ============================================================================

// 1. Criar nova conta (protegida por Rate Limit contra spam/força bruta)
app.post(
  '/api/auth/register',
  authRateLimiter,
  asyncHandler(async (req, res) => {
    const { nome, email, senha } = req.body;

    if (!nome?.trim() || !email?.trim() || !senha) {
      return res.status(400).json({ erro: 'Preencha nome, e-mail e senha.' });
    }

    if (nome.trim().length > 80) {
      return res.status(400).json({ erro: 'O nome pode ter no máximo 80 caracteres.' });
    }

    if (!validarEmail(email)) {
      return res.status(400).json({ erro: 'Informe um endereço de e-mail válido.' });
    }

    if (typeof senha !== 'string' || senha.length < 6 || senha.length > 128) {
      return res
        .status(400)
        .json({ erro: 'A senha precisa ter entre 6 e 128 caracteres.' });
    }

    const emailLimpo = email.trim().toLowerCase();

    // Verifica no SQL se já existe uma conta com esse e-mail
    const existente = await db.get(
      'SELECT id FROM usuarios WHERE email = ?',
      emailLimpo
    );

    if (existente) {
      return res.status(409).json({ erro: 'Já existe uma conta cadastrada com este e-mail.' });
    }

    const senhaCriptografada = hashSenha(senha);

    // INSERT com "?" (Prepared Statement) evita ataques de SQL Injection
    const novoId = await db.insert(
      'INSERT INTO usuarios (nome, email, senha_hash) VALUES (?, ?, ?)',
      nome.trim(),
      emailLimpo,
      senhaCriptografada
    );

    const usuarioCriado = await db.get(
      'SELECT id, nome, email, avatar_cor, token_version, criado_em FROM usuarios WHERE id = ?',
      novoId
    );

    const novoUsuario = {
      id: usuarioCriado.id,
      nome: usuarioCriado.nome,
      email: usuarioCriado.email,
      avatarCor: usuarioCriado.avatar_cor || '#0052d4',
      criadoEm: usuarioCriado.criado_em || null,
    };

    const token = gerarToken({
      ...novoUsuario,
      tokenVersion: Number(usuarioCriado.token_version ?? 0),
    });

    return res.status(201).json({ usuario: novoUsuario, token });
  })
);

// 2. Fazer login (protegida por Rate Limit contra tentativas de adivinhar senha)
app.post(
  '/api/auth/login',
  authRateLimiter,
  asyncHandler(async (req, res) => {
    const { email, senha } = req.body;

    if (!email?.trim() || !senha) {
      return res.status(400).json({ erro: 'Informe seu e-mail e sua senha.' });
    }

    if (typeof senha !== 'string' || senha.length > 128) {
      return res.status(401).json({ erro: 'E-mail ou senha incorretos.' });
    }

    const emailLimpo = email.trim().toLowerCase();

    const usuarioDb = await db.get(
      'SELECT id, nome, email, senha_hash, avatar_cor, token_version, criado_em FROM usuarios WHERE email = ?',
      emailLimpo
    );

    if (!usuarioDb) {
      verificarSenhaDummy(senha);
      return res.status(401).json({ erro: 'E-mail ou senha incorretos.' });
    }

    if (!verificarSenha(senha, usuarioDb.senha_hash)) {
      return res.status(401).json({ erro: 'E-mail ou senha incorretos.' });
    }

    const usuario = {
      id: usuarioDb.id,
      nome: usuarioDb.nome,
      email: usuarioDb.email,
      avatarCor: usuarioDb.avatar_cor || '#0052d4',
      criadoEm: usuarioDb.criado_em || null,
    };

    const token = gerarToken({
      ...usuario,
      tokenVersion: Number(usuarioDb.token_version ?? 0),
    });

    return res.json({ usuario, token });
  })
);

// 3. Consultar quem está logado (lê dados atualizados do banco)
app.get(
  '/api/auth/me',
  autenticar,
  asyncHandler(async (req, res) => {
    const usuarioDb = await db.get(
      'SELECT id, nome, email, avatar_cor, criado_em FROM usuarios WHERE id = ?',
      req.usuario.id
    );

    if (!usuarioDb) {
      return res.status(401).json({ erro: 'Sessão inválida. Faça login novamente.' });
    }

    return res.json({
      usuario: {
        id: usuarioDb.id,
        nome: usuarioDb.nome,
        email: usuarioDb.email,
        avatarCor: usuarioDb.avatar_cor || '#0052d4',
        criadoEm: usuarioDb.criado_em || null,
      },
    });
  })
);

// 3b. Atualizar dados do perfil (nome e cor do avatar)
app.put(
  '/api/auth/perfil',
  autenticar,
  asyncHandler(async (req, res) => {
    const nomeLimpo = (req.body.nome || '').trim();
    const avatarCor = /^#[0-9a-fA-F]{6}$/.test(req.body.avatarCor || '')
      ? req.body.avatarCor
      : '#0052d4';

    if (nomeLimpo.length < 2 || nomeLimpo.length > 80) {
      return res
        .status(400)
        .json({ erro: 'Informe um nome com 2 a 80 caracteres.' });
    }

    await db.run(
      'UPDATE usuarios SET nome = ?, avatar_cor = ? WHERE id = ?',
      nomeLimpo,
      avatarCor,
      req.usuario.id
    );

    const usuarioDb = await db.get(
      'SELECT id, nome, email, avatar_cor, token_version, criado_em FROM usuarios WHERE id = ?',
      req.usuario.id
    );

    const usuario = {
      id: usuarioDb.id,
      nome: usuarioDb.nome,
      email: usuarioDb.email,
      avatarCor: usuarioDb.avatar_cor || '#0052d4',
      criadoEm: usuarioDb.criado_em || null,
    };

    const token = gerarToken({
      ...usuario,
      tokenVersion: Number(usuarioDb.token_version ?? 0),
    });

    return res.json({ usuario, token });
  })
);

// 3c. Alterar senha da conta (exige a senha atual e revoga sessões antigas via token_version)
app.put(
  '/api/auth/senha',
  autenticar,
  authRateLimiter,
  asyncHandler(async (req, res) => {
    const { senhaAtual, novaSenha } = req.body;

    if (!senhaAtual || !novaSenha) {
      return res
        .status(400)
        .json({ erro: 'Informe a senha atual e a nova senha.' });
    }

    if (typeof novaSenha !== 'string' || novaSenha.length < 6 || novaSenha.length > 128) {
      return res
        .status(400)
        .json({ erro: 'A nova senha precisa ter entre 6 e 128 caracteres.' });
    }

    const usuarioDb = await db.get(
      'SELECT id, nome, email, senha_hash, token_version FROM usuarios WHERE id = ?',
      req.usuario.id
    );

    if (!usuarioDb || !verificarSenha(senhaAtual, usuarioDb.senha_hash)) {
      return res.status(401).json({ erro: 'A senha atual está incorreta.' });
    }

    const novoHash = hashSenha(novaSenha);
    const novaVersao = Number(usuarioDb.token_version ?? 0) + 1;
    await db.run(
      'UPDATE usuarios SET senha_hash = ?, token_version = ? WHERE id = ?',
      novoHash,
      novaVersao,
      req.usuario.id
    );

    const novoToken = gerarToken({
      id: usuarioDb.id,
      nome: usuarioDb.nome,
      email: usuarioDb.email,
      tokenVersion: novaVersao,
    });

    return res.json({ ok: true, token: novoToken });
  })
);

function hashCodigoReset(codigo) {
  return crypto.createHash('sha256').update(String(codigo)).digest('hex');
}

// 3d. Solicitar código de 6 dígitos para recuperar senha ("Esqueci minha senha")
app.post(
  '/api/auth/esqueci-senha',
  authRateLimiter,
  asyncHandler(async (req, res) => {
    const emailLimpo = (req.body.email || '').trim().toLowerCase();

    if (!validarEmail(emailLimpo)) {
      return res.status(400).json({ erro: 'Informe um endereço de e-mail válido.' });
    }

    if (IS_PROD && !emailConfigurado()) {
      return res.status(503).json({
        erro: 'Recuperação por e-mail ainda não configurada no servidor. Configure BREVO_API_KEY e EMAIL_REMETENTE no Render.',
      });
    }

    const mensagemPadrao =
      'Se este e-mail estiver cadastrado, enviamos um código de 6 dígitos (válido por 15 minutos).';

    const usuarioDb = await db.get(
      'SELECT id, nome, email FROM usuarios WHERE email = ?',
      emailLimpo
    );

    // Resposta idêntica mesmo quando o e-mail não existe (evita enumeração de contas)
    if (!usuarioDb) {
      return res.json({ ok: true, mensagem: mensagemPadrao });
    }

    const codigo = String(crypto.randomInt(100000, 1000000));
    const codigoHash = hashCodigoReset(codigo);
    const expiraEm = Date.now() + 15 * 60 * 1000;

    await db.transaction(async (tx) => {
      await tx.run('DELETE FROM reset_senhas WHERE usuario_id = ?', usuarioDb.id);
      await tx.insert(
        'INSERT INTO reset_senhas (usuario_id, codigo_hash, expira_em, usado) VALUES (?, ?, ?, 0)',
        usuarioDb.id,
        codigoHash,
        expiraEm
      );
    });

    const envio = await enviarCodigoRecuperacao({
      para: usuarioDb.email,
      nome: usuarioDb.nome,
      codigo,
    });

    return res.json({
      ok: true,
      mensagem: mensagemPadrao,
      // Apenas em desenvolvimento local (sem servidor de e-mail) facilita testar o fluxo
      ...(envio.modo === 'dev' && !IS_PROD ? { codigoDev: codigo } : {}),
    });
  })
);

const MAX_TENTATIVAS_RESET = 5;

// 3e. Confirmar código de 6 dígitos e gravar a nova senha (invalida após 5 erros e revoga sessões antigas)
app.post(
  '/api/auth/redefinir-senha',
  authRateLimiter,
  asyncHandler(async (req, res) => {
    const emailLimpo = (req.body.email || '').trim().toLowerCase();
    const codigoLimpo = String(req.body.codigo || '').replace(/\D/g, '');
    const { novaSenha } = req.body;

    if (!validarEmail(emailLimpo)) {
      return res.status(400).json({ erro: 'Informe um e-mail válido.' });
    }
    if (!/^\d{6}$/.test(codigoLimpo)) {
      return res.status(400).json({ erro: 'Informe o código de 6 dígitos recebido no e-mail.' });
    }
    if (typeof novaSenha !== 'string' || novaSenha.length < 6 || novaSenha.length > 128) {
      return res
        .status(400)
        .json({ erro: 'A nova senha precisa ter entre 6 e 128 caracteres.' });
    }

    const usuarioDb = await db.get(
      'SELECT id FROM usuarios WHERE email = ?',
      emailLimpo
    );

    if (!usuarioDb) {
      return res.status(400).json({ erro: 'Código inválido ou expirado.' });
    }

    const registroReset = await db.get(
      `
        SELECT id, codigo_hash, expira_em, tentativas
        FROM reset_senhas
        WHERE usuario_id = ? AND usado = 0
        ORDER BY id DESC
        LIMIT 1
      `,
      usuarioDb.id
    );

    if (
      !registroReset ||
      Number(registroReset.expira_em) < Date.now() ||
      Number(registroReset.tentativas || 0) >= MAX_TENTATIVAS_RESET
    ) {
      return res
        .status(400)
        .json({ erro: 'Código inválido ou expirado. Solicite um novo código.' });
    }

    const tentativaBuf = Buffer.from(hashCodigoReset(codigoLimpo), 'hex');
    const originalBuf = Buffer.from(registroReset.codigo_hash, 'hex');

    if (
      tentativaBuf.length !== originalBuf.length ||
      !crypto.timingSafeEqual(tentativaBuf, originalBuf)
    ) {
      const novasTentativas = Number(registroReset.tentativas || 0) + 1;
      const esgotou = novasTentativas >= MAX_TENTATIVAS_RESET;
      await db.run(
        'UPDATE reset_senhas SET tentativas = ?, usado = ? WHERE id = ?',
        novasTentativas,
        esgotou ? 1 : 0,
        registroReset.id
      );
      return res.status(400).json({
        erro: esgotou
          ? 'Muitas tentativas incorretas. Este código foi invalidado — solicite um novo código.'
          : 'Código inválido ou expirado. Verifique os 6 dígitos.',
      });
    }

    const novoHash = hashSenha(novaSenha);

    await db.transaction(async (tx) => {
      await tx.run(
        'UPDATE usuarios SET senha_hash = ?, token_version = token_version + 1 WHERE id = ?',
        novoHash,
        usuarioDb.id
      );
      await tx.run('DELETE FROM reset_senhas WHERE usuario_id = ?', usuarioDb.id);
    });

    return res.json({ ok: true, mensagem: 'Senha redefinida com sucesso! Faça login.' });
  })
);

// ============================================================================
// ROTAS DE FINANÇAS (Todas protegidas — só funcionam com Login!)
// ============================================================================

/**
 * Garante que a conta informada existe e pertence ao usuário logado (evita IDOR).
 */
async function resolverContaId(contaIdBruto, usuarioId) {
  if (contaIdBruto === undefined || contaIdBruto === null || contaIdBruto === '') {
    return null;
  }
  const id = Number(contaIdBruto);
  if (!Number.isInteger(id) || id <= 0) return null;

  const conta = await db.get(
    'SELECT id FROM contas WHERE id = ? AND usuario_id = ?',
    id,
    usuarioId
  );

  return conta ? conta.id : null;
}

const SELECT_LANCAMENTO_BASE = `
  SELECT
    l.id, l.titulo, l.valor, l.tipo, l.categoria, l.data, l.status,
    l.observacao, l.grupo_parcela, l.descontar_saldo, l.conta_id,
    l.origem_divida, l.criado_em,
    c.nome AS conta_nome,
    c.cor AS conta_cor
  FROM lancamentos l
  LEFT JOIN contas c ON c.id = l.conta_id AND c.usuario_id = l.usuario_id
`;

// 4. Listar lançamentos (todos ou de um mês específico) e calcular resumo
app.get(
  '/api/lancamentos',
  autenticar,
  asyncHandler(async (req, res) => {
    const { mes } = req.query; // Formato esperado: YYYY-MM

    let lancamentos;

    if (mes && /^\d{4}-\d{2}$/.test(mes)) {
      lancamentos = await db.all(
        `
          ${SELECT_LANCAMENTO_BASE}
          WHERE l.usuario_id = ? AND substr(l.data, 1, 7) = ?
          ORDER BY l.data DESC, l.id DESC
        `,
        req.usuario.id,
        mes
      );
    } else {
      lancamentos = await db.all(
        `
          ${SELECT_LANCAMENTO_BASE}
          WHERE l.usuario_id = ?
          ORDER BY l.data DESC, l.id DESC
        `,
        req.usuario.id
      );
    }

    // Calcula os totais: o que entrou, o que saiu (do saldo) e o que ainda vai sair
    const resumo = lancamentos.reduce(
      (acc, item) => {
        if (item.tipo === 'entrada') {
          if (item.status === 'pago') {
            acc.entradasRecebidas += item.valor;
          } else {
            acc.entradasPrevistas += item.valor;
          }
        } else {
          // Tanto "saida" quanto "divida" contam como negativo
          if (item.status === 'pago') {
            if (item.descontar_saldo !== 0) {
              acc.saidasPagas += item.valor;
            } else {
              acc.saidasPagasPorFora += item.valor;
            }
          } else {
            acc.saidasAPagar += item.valor;
          }

          if (item.tipo === 'divida' && item.status === 'pendente') {
            acc.dividasPendentes += item.valor;
          }
        }
        return acc;
      },
      {
        entradasRecebidas: 0,
        entradasPrevistas: 0,
        saidasPagas: 0,
        saidasPagasPorFora: 0,
        saidasAPagar: 0,
        dividasPendentes: 0,
      }
    );

    // Saldo Real = o que já entrou menos o que já saiu
    const saldoReal = resumo.entradasRecebidas - resumo.saidasPagas;
    // Saldo Previsto = considerando tudo que ainda vai entrar e tudo que ainda vai sair
    const saldoPrevisto =
      resumo.entradasRecebidas +
      resumo.entradasPrevistas -
      (resumo.saidasPagas + resumo.saidasAPagar);

    return res.json({
      lancamentos,
      resumo: {
        ...resumo,
        saldoReal,
        saldoPrevisto,
      },
    });
  })
);

// 5. Criar novo lançamento (entrada, saída ou dívida — com suporte a parcelamento, carteira e origem da dívida!)
app.post(
  '/api/lancamentos',
  autenticar,
  asyncHandler(async (req, res) => {
    const {
      titulo,
      valor,
      tipo,
      categoria,
      data,
      status,
      observacao,
      parcelas,
      modoValorParcela,
      contaId,
      origemDivida,
    } = req.body;

    const valorNumero = Number(valor);
    const tiposValidos = ['entrada', 'saida', 'divida'];
    const statusValidos = ['pago', 'pendente'];

    if (!titulo?.trim()) {
      return res.status(400).json({ erro: 'Informe uma descrição (título) para o lançamento.' });
    }
    if (!Number.isFinite(valorNumero) || valorNumero <= 0) {
      return res.status(400).json({ erro: 'Informe um valor maior que zero.' });
    }
    if (!tiposValidos.includes(tipo)) {
      return res.status(400).json({ erro: 'Tipo inválido. Use: entrada, saida ou divida.' });
    }
    if (!data || !/^\d{4}-\d{2}-\d{2}$/.test(data)) {
      return res.status(400).json({ erro: 'Informe uma data válida (AAAA-MM-DD).' });
    }

    const totalParcelas =
      tipo === 'divida' ? Math.max(1, Math.min(60, Math.floor(Number(parcelas) || 1))) : 1;

    const statusFinal = statusValidos.includes(status) ? status : 'pago';
    const categoriaFinal = categoria?.trim() || 'Geral';
    const observacaoFinal = observacao?.trim() || '';
    const contaIdFinal = await resolverContaId(contaId, req.usuario.id);
    const origemDividaFinal = tipo === 'divida' ? (origemDivida?.trim() || '') : '';

    const insertSql = `
      INSERT INTO lancamentos (
        usuario_id, titulo, valor, tipo, categoria, data, status,
        observacao, grupo_parcela, conta_id, origem_divida
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const selectByIdSql = `${SELECT_LANCAMENTO_BASE} WHERE l.id = ?`;

    // Se for dívida parcelada (2x ou mais), grava todas as parcelas juntas numa Transação SQL
    if (totalParcelas > 1) {
      const grupoId = crypto.randomUUID();
      const dividirTotal = modoValorParcela === 'total';
      const valorBase = dividirTotal
        ? Math.floor((valorNumero / totalParcelas) * 100) / 100
        : Math.round(valorNumero * 100) / 100;
      const diferencaCentavos = dividirTotal
        ? Math.round((valorNumero - valorBase * totalParcelas) * 100) / 100
        : 0;

      const criados = await db.transaction(async (tx) => {
        const lista = [];
        for (let i = 0; i < totalParcelas; i++) {
          const dataParcela = somarMesesSeguro(data, i);
          const tituloParcela = `${titulo.trim()} (${i + 1}/${totalParcelas})`;
          const valorParcela =
            i === totalParcelas - 1
              ? Math.round((valorBase + diferencaCentavos) * 100) / 100
              : valorBase;

          const novoId = await tx.insert(
            insertSql,
            req.usuario.id,
            tituloParcela,
            valorParcela,
            tipo,
            categoriaFinal,
            dataParcela,
            statusFinal,
            observacaoFinal,
            grupoId,
            contaIdFinal,
            origemDividaFinal
          );

          lista.push(await tx.get(selectByIdSql, novoId));
        }
        return lista;
      });

      return res.status(201).json({ lancamento: criados[0], lancamentos: criados });
    }

    const novoId = await db.insert(
      insertSql,
      req.usuario.id,
      titulo.trim(),
      valorNumero,
      tipo,
      categoriaFinal,
      data,
      statusFinal,
      observacaoFinal,
      null,
      contaIdFinal,
      origemDividaFinal
    );

    const criado = await db.get(selectByIdSql, novoId);
    return res.status(201).json({ lancamento: criado });
  })
);

// 6. Atualizar status (marcar como pago/adiantado com opção de descontar do saldo e carteira, ou voltar para pendente)
app.patch(
  '/api/lancamentos/:id/status',
  autenticar,
  asyncHandler(async (req, res) => {
    const id = validarIdPositivo(req.params.id);
    if (!id) {
      return res.status(400).json({ erro: 'ID de lançamento inválido.' });
    }
    const { status, descontarSaldo, valor, contaId } = req.body;

    if (!['pago', 'pendente'].includes(status)) {
      return res.status(400).json({ erro: 'Status inválido. Use "pago" ou "pendente".' });
    }

    const descontarValorDb =
      status === 'pendente' ? 1 : descontarSaldo === false ? 0 : 1;

    const valorNumero = valor !== undefined && valor !== null ? Number(valor) : null;
    if (valorNumero !== null && (!Number.isFinite(valorNumero) || valorNumero <= 0)) {
      return res.status(400).json({ erro: 'Informe um valor maior que zero.' });
    }

    const temContaNoBody = contaId !== undefined;
    const contaIdFinal =
      status === 'pendente' || descontarValorDb === 0
        ? null
        : await resolverContaId(contaId, req.usuario.id);

    // O "AND usuario_id = ?" garante que você só altera lançamentos da SUA conta
    let resultado;
    if (valorNumero !== null && (temContaNoBody || status === 'pendente')) {
      resultado = await db.run(
        'UPDATE lancamentos SET status = ?, descontar_saldo = ?, valor = ?, conta_id = ? WHERE id = ? AND usuario_id = ?',
        status,
        descontarValorDb,
        valorNumero,
        contaIdFinal,
        id,
        req.usuario.id
      );
    } else if (valorNumero !== null) {
      resultado = await db.run(
        'UPDATE lancamentos SET status = ?, descontar_saldo = ?, valor = ? WHERE id = ? AND usuario_id = ?',
        status,
        descontarValorDb,
        valorNumero,
        id,
        req.usuario.id
      );
    } else if (temContaNoBody || status === 'pendente') {
      resultado = await db.run(
        'UPDATE lancamentos SET status = ?, descontar_saldo = ?, conta_id = ? WHERE id = ? AND usuario_id = ?',
        status,
        descontarValorDb,
        contaIdFinal,
        id,
        req.usuario.id
      );
    } else {
      resultado = await db.run(
        'UPDATE lancamentos SET status = ?, descontar_saldo = ? WHERE id = ? AND usuario_id = ?',
        status,
        descontarValorDb,
        id,
        req.usuario.id
      );
    }

    if (resultado.changes === 0) {
      return res.status(404).json({ erro: 'Lançamento não encontrado.' });
    }

    const atualizado = await db.get(
      `${SELECT_LANCAMENTO_BASE} WHERE l.id = ? AND l.usuario_id = ?`,
      id,
      req.usuario.id
    );

    return res.json({ lancamento: atualizado });
  })
);

// 6b. Editar TODAS as parcelas de um grupo de dívida de uma vez (dentro de Transação SQL)
app.put(
  '/api/lancamentos/grupo/:grupoId',
  autenticar,
  asyncHandler(async (req, res) => {
    const { grupoId } = req.params;
    const {
      titulo,
      valorParcela,
      dataPrimeiraParcela,
      categoria,
      origemDivida,
      manterPagas,
    } = req.body;

    const valorNumero = Number(valorParcela);

    if (!titulo?.trim()) {
      return res.status(400).json({ erro: 'Informe uma descrição para a dívida.' });
    }
    if (!Number.isFinite(valorNumero) || valorNumero <= 0) {
      return res.status(400).json({ erro: 'Informe um valor de parcela maior que zero.' });
    }
    if (!dataPrimeiraParcela || !/^\d{4}-\d{2}-\d{2}$/.test(dataPrimeiraParcela)) {
      return res.status(400).json({ erro: 'Informe uma data válida para a 1ª parcela.' });
    }

    const parcelas = await db.all(
      `
        SELECT id, status, valor
        FROM lancamentos
        WHERE grupo_parcela = ? AND usuario_id = ?
        ORDER BY data ASC, id ASC
      `,
      grupoId,
      req.usuario.id
    );

    if (parcelas.length === 0) {
      return res.status(404).json({ erro: 'Grupo de parcelas não encontrado.' });
    }

    const tituloBase = titulo.trim();
    const categoriaFinal = categoria?.trim() || 'Parcelamento';
    const origemFinal = origemDivida?.trim() || '';
    const total = parcelas.length;
    const preservarValorPagas = Boolean(manterPagas);

    await db.transaction(async (tx) => {
      for (let i = 0; i < total; i++) {
        const parcela = parcelas[i];
        const tituloParcela = `${tituloBase} (${i + 1}/${total})`;
        const novaData = somarMesesSeguro(dataPrimeiraParcela, i);
        const novoValor =
          preservarValorPagas && parcela.status === 'pago'
            ? parcela.valor
            : valorNumero;

        await tx.run(
          `
            UPDATE lancamentos
            SET titulo = ?, valor = ?, data = ?, categoria = ?, origem_divida = ?
            WHERE id = ? AND usuario_id = ?
          `,
          tituloParcela,
          novoValor,
          novaData,
          categoriaFinal,
          origemFinal,
          parcela.id,
          req.usuario.id
        );
      }
    });

    return res.json({ ok: true, atualizadas: total });
  })
);

// 7. Editar um lançamento existente
app.put(
  '/api/lancamentos/:id',
  autenticar,
  asyncHandler(async (req, res) => {
    const id = validarIdPositivo(req.params.id);
    if (!id) {
      return res.status(400).json({ erro: 'ID de lançamento inválido.' });
    }
    const {
      titulo,
      valor,
      tipo,
      categoria,
      data,
      status,
      observacao,
      descontarSaldo,
      contaId,
      origemDivida,
    } = req.body;

    const valorNumero = Number(valor);
    const tiposValidos = ['entrada', 'saida', 'divida'];
    const statusValidos = ['pago', 'pendente'];

    if (!titulo?.trim()) {
      return res.status(400).json({ erro: 'Informe uma descrição para o lançamento.' });
    }
    if (!Number.isFinite(valorNumero) || valorNumero <= 0) {
      return res.status(400).json({ erro: 'Informe um valor maior que zero.' });
    }
    if (!tiposValidos.includes(tipo)) {
      return res.status(400).json({ erro: 'Tipo inválido.' });
    }
    if (!data || !/^\d{4}-\d{2}-\d{2}$/.test(data)) {
      return res.status(400).json({ erro: 'Informe uma data válida (AAAA-MM-DD).' });
    }

    const statusFinal = statusValidos.includes(status) ? status : 'pago';
    const categoriaFinal = categoria?.trim() || 'Geral';
    const observacaoFinal = observacao?.trim() || '';
    const descontarValorDb =
      statusFinal === 'pendente' || tipo === 'entrada'
        ? 1
        : descontarSaldo === false
          ? 0
          : 1;
    const contaIdFinal = await resolverContaId(contaId, req.usuario.id);
    const origemDividaFinal = tipo === 'divida' ? (origemDivida?.trim() || '') : '';

    const resultado = await db.run(
      `
        UPDATE lancamentos
        SET titulo = ?, valor = ?, tipo = ?, categoria = ?, data = ?, status = ?,
            observacao = ?, descontar_saldo = ?, conta_id = ?, origem_divida = ?
        WHERE id = ? AND usuario_id = ?
      `,
      titulo.trim(),
      valorNumero,
      tipo,
      categoriaFinal,
      data,
      statusFinal,
      observacaoFinal,
      descontarValorDb,
      contaIdFinal,
      origemDividaFinal,
      id,
      req.usuario.id
    );

    if (resultado.changes === 0) {
      return res.status(404).json({ erro: 'Lançamento não encontrado.' });
    }

    const atualizado = await db.get(
      `${SELECT_LANCAMENTO_BASE} WHERE l.id = ? AND l.usuario_id = ?`,
      id,
      req.usuario.id
    );

    return res.json({ lancamento: atualizado });
  })
);

// 8. Excluir todas as parcelas de um grupo de dívida de uma vez
app.delete(
  '/api/lancamentos/grupo/:grupoId',
  autenticar,
  asyncHandler(async (req, res) => {
    const { grupoId } = req.params;

    const resultado = await db.run(
      'DELETE FROM lancamentos WHERE grupo_parcela = ? AND usuario_id = ?',
      grupoId,
      req.usuario.id
    );

    if (resultado.changes === 0) {
      return res.status(404).json({ erro: 'Grupo de parcelas não encontrado.' });
    }

    return res.json({ ok: true, removidos: resultado.changes });
  })
);

// 9. Excluir um único lançamento (ou uma única parcela)
app.delete(
  '/api/lancamentos/:id',
  autenticar,
  asyncHandler(async (req, res) => {
    const id = validarIdPositivo(req.params.id);
    if (!id) {
      return res.status(400).json({ erro: 'ID de lançamento inválido.' });
    }

    const resultado = await db.run(
      'DELETE FROM lancamentos WHERE id = ? AND usuario_id = ?',
      id,
      req.usuario.id
    );

    if (resultado.changes === 0) {
      return res.status(404).json({ erro: 'Lançamento não encontrado.' });
    }

    return res.json({ ok: true });
  })
);

// ============================================================================
// ROTAS DE CARTEIRAS / CONTAS (Onde seu dinheiro está guardado)
// ============================================================================

// 10. Listar carteiras com saldo calculado via SQL (LEFT JOIN + GROUP BY)
app.get(
  '/api/contas',
  autenticar,
  asyncHandler(async (req, res) => {
    const contas = await db.all(
      `
        SELECT
          c.id,
          c.nome,
          c.etiqueta,
          c.rendimento,
          c.cor,
          c.saldo_ajuste,
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
        GROUP BY c.id, c.nome, c.etiqueta, c.rendimento, c.cor, c.saldo_ajuste
        ORDER BY c.id ASC
      `,
      req.usuario.id
    );

    const semContaRow = await db.get(
      `
        SELECT COALESCE(SUM(
          CASE
            WHEN tipo = 'entrada' AND status = 'pago' THEN valor
            WHEN tipo IN ('saida', 'divida') AND status = 'pago' AND descontar_saldo != 0 THEN -valor
            ELSE 0
          END
        ), 0) AS total
        FROM lancamentos
        WHERE usuario_id = ? AND conta_id IS NULL
      `,
      req.usuario.id
    );

    return res.json({
      contas,
      saldoSemConta: Number(semContaRow?.total || 0),
    });
  })
);

// 11. Criar nova carteira
app.post(
  '/api/contas',
  autenticar,
  asyncHandler(async (req, res) => {
    const { nome, etiqueta, rendimento, cor } = req.body;

    if (!nome?.trim()) {
      return res.status(400).json({ erro: 'Informe o nome da carteira (ex.: RecargaPay, Cofrinho).' });
    }

    const corFinal = /^#[0-9a-fA-F]{6}$/.test(cor || '') ? cor : '#3b82f6';
    const etiquetaFinal = etiqueta?.trim() || '';
    const rendimentoFinal = rendimento?.trim() || '';

    const novoId = await db.insert(
      'INSERT INTO contas (usuario_id, nome, etiqueta, rendimento, cor) VALUES (?, ?, ?, ?, ?)',
      req.usuario.id,
      nome.trim(),
      etiquetaFinal,
      rendimentoFinal,
      corFinal
    );

    const criada = await db.get(
      'SELECT id, nome, etiqueta, rendimento, cor, saldo_ajuste FROM contas WHERE id = ?',
      novoId
    );

    return res.status(201).json({ conta: { ...criada, saldo: 0 } });
  })
);

// 12. Editar carteira
app.put(
  '/api/contas/:id',
  autenticar,
  asyncHandler(async (req, res) => {
    const id = validarIdPositivo(req.params.id);
    if (!id) {
      return res.status(400).json({ erro: 'ID de carteira inválido.' });
    }
    const { nome, etiqueta, rendimento, cor } = req.body;

    if (!nome?.trim()) {
      return res.status(400).json({ erro: 'Informe o nome da carteira.' });
    }

    const corFinal = /^#[0-9a-fA-F]{6}$/.test(cor || '') ? cor : '#3b82f6';
    const etiquetaFinal = etiqueta?.trim() || '';
    const rendimentoFinal = rendimento?.trim() || '';

    const resultado = await db.run(
      'UPDATE contas SET nome = ?, etiqueta = ?, rendimento = ?, cor = ? WHERE id = ? AND usuario_id = ?',
      nome.trim(),
      etiquetaFinal,
      rendimentoFinal,
      corFinal,
      id,
      req.usuario.id
    );

    if (resultado.changes === 0) {
      return res.status(404).json({ erro: 'Carteira não encontrada.' });
    }

    const atualizada = await db.get(
      'SELECT id, nome, etiqueta, rendimento, cor, saldo_ajuste FROM contas WHERE id = ? AND usuario_id = ?',
      id,
      req.usuario.id
    );

    return res.json({ conta: atualizada });
  })
);

// 13. Transferir dinheiro entre carteiras (não altera o Saldo Total — apenas move entre lugares!)
app.post(
  '/api/contas/transferir',
  autenticar,
  asyncHandler(async (req, res) => {
    const origemId = Number(req.body.origemId);
    const destinoId = Number(req.body.destinoId);
    const valor = Number(req.body.valor);

    if (!Number.isInteger(origemId) || !Number.isInteger(destinoId) || origemId === destinoId) {
      return res.status(400).json({ erro: 'Escolha duas carteiras diferentes para transferir.' });
    }
    if (!Number.isFinite(valor) || valor <= 0) {
      return res.status(400).json({ erro: 'Informe um valor maior que zero para transferir.' });
    }

    const origem = await db.get(
      'SELECT id FROM contas WHERE id = ? AND usuario_id = ?',
      origemId,
      req.usuario.id
    );
    const destino = await db.get(
      'SELECT id FROM contas WHERE id = ? AND usuario_id = ?',
      destinoId,
      req.usuario.id
    );

    if (!origem || !destino) {
      return res.status(404).json({ erro: 'Carteira de origem ou destino não encontrada.' });
    }

    // Transação SQL: ou tira da origem E coloca no destino, ou nada muda!
    await db.transaction(async (tx) => {
      await tx.run(
        'UPDATE contas SET saldo_ajuste = saldo_ajuste - ? WHERE id = ? AND usuario_id = ?',
        valor,
        origemId,
        req.usuario.id
      );
      await tx.run(
        'UPDATE contas SET saldo_ajuste = saldo_ajuste + ? WHERE id = ? AND usuario_id = ?',
        valor,
        destinoId,
        req.usuario.id
      );
    });

    return res.json({ ok: true });
  })
);

// 14. Excluir carteira (mantém todos os lançamentos intactos!)
app.delete(
  '/api/contas/:id',
  autenticar,
  asyncHandler(async (req, res) => {
    const id = validarIdPositivo(req.params.id);
    if (!id) {
      return res.status(400).json({ erro: 'ID de carteira inválido.' });
    }

    const conta = await db.get(
      'SELECT id, saldo_ajuste FROM contas WHERE id = ? AND usuario_id = ?',
      id,
      req.usuario.id
    );

    if (!conta) {
      return res.status(404).json({ erro: 'Carteira não encontrada.' });
    }

    if (Math.abs(conta.saldo_ajuste) > 0.009) {
      return res.status(400).json({
        erro: 'Esta carteira possui transferências ativas. Transfira o valor de volta antes de excluí-la.',
      });
    }

    await db.transaction(async (tx) => {
      await tx.run(
        'UPDATE lancamentos SET conta_id = NULL WHERE conta_id = ? AND usuario_id = ?',
        id,
        req.usuario.id
      );
      await tx.run(
        'UPDATE metas SET conta_id = NULL WHERE conta_id = ? AND usuario_id = ?',
        id,
        req.usuario.id
      );
      await tx.run(
        'UPDATE despesas_fixas SET conta_id = NULL WHERE conta_id = ? AND usuario_id = ?',
        id,
        req.usuario.id
      );
      await tx.run(
        'DELETE FROM contas WHERE id = ? AND usuario_id = ?',
        id,
        req.usuario.id
      );
    });

    return res.json({ ok: true });
  })
);

// ============================================================================
// ROTAS DE SALÁRIO FIXO RECORRENTE ("Previsto para Entrar")
// ============================================================================

const NOMES_MESES_PT = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
];

function montarDataNoMes(ano, mes1a12, diaDesejado) {
  const ultimoDia = new Date(ano, mes1a12, 0).getDate();
  const diaFinal = Math.min(diaDesejado, ultimoDia);
  return `${ano}-${String(mes1a12).padStart(2, '0')}-${String(diaFinal).padStart(2, '0')}`;
}

/**
 * Calcula automaticamente o próximo salário previsto:
 * se o dia de pagamento deste mês já passou OU já existe um salário recebido neste mês,
 * aponta para o próximo mês (ex.: em novembro -> "Salário de Dezembro").
 */
async function calcularProximoSalario(config, usuarioId) {
  if (!config) return null;

  const hoje = new Date();
  let ano = hoje.getFullYear();
  let mes = hoje.getMonth() + 1; // 1..12
  const diaHoje = hoje.getDate();

  const sqlJaRecebeu = `
    SELECT id FROM lancamentos
    WHERE usuario_id = ?
      AND tipo = 'entrada'
      AND status = 'pago'
      AND categoria = 'Salário'
      AND substr(data, 1, 7) = ?
    LIMIT 1
  `;

  const mesAtualRef = `${ano}-${String(mes).padStart(2, '0')}`;
  const jaRecebeuMesAtual = Boolean(
    await db.get(sqlJaRecebeu, usuarioId, mesAtualRef)
  );

  if (diaHoje > config.dia_pagamento || jaRecebeuMesAtual) {
    mes += 1;
    if (mes > 12) {
      mes = 1;
      ano += 1;
    }
  }

  // Se o usuário já adiantou/registrou até o mês seguinte, pula mais um mês
  let tentativas = 0;
  while (tentativas < 12) {
    const mesRef = `${ano}-${String(mes).padStart(2, '0')}`;
    const jaRecebeu = Boolean(await db.get(sqlJaRecebeu, usuarioId, mesRef));
    if (!jaRecebeu) break;
    mes += 1;
    if (mes > 12) {
      mes = 1;
      ano += 1;
    }
    tentativas += 1;
  }

  const mesRef = `${ano}-${String(mes).padStart(2, '0')}`;
  const mesNome = NOMES_MESES_PT[mes - 1];
  const dataIso = montarDataNoMes(ano, mes, config.dia_pagamento);

  return {
    titulo: `Salário de ${mesNome}`,
    mesNome,
    ano,
    mesRef,
    dataIso,
    valor: config.valor,
    diaPagamento: config.dia_pagamento,
    contaId: config.conta_id || null,
    contaNome: config.conta_nome || null,
  };
}

// 15. Obter salário fixo configurado e o próximo mês previsto
app.get(
  '/api/salario',
  autenticar,
  asyncHandler(async (req, res) => {
    const config = await db.get(
      `
        SELECT s.valor, s.dia_pagamento, s.conta_id, c.nome AS conta_nome
        FROM salario_fixo s
        LEFT JOIN contas c ON c.id = s.conta_id AND c.usuario_id = s.usuario_id
        WHERE s.usuario_id = ?
      `,
      req.usuario.id
    );

    if (!config) {
      return res.json({ salario: null, proximo: null });
    }

    const proximo = await calcularProximoSalario(config, req.usuario.id);
    return res.json({
      salario: {
        valor: config.valor,
        diaPagamento: config.dia_pagamento,
        contaId: config.conta_id || null,
        contaNome: config.conta_nome || null,
      },
      proximo,
    });
  })
);

// 16. Criar ou atualizar salário fixo (UPSERT padrão SQL — funciona em SQLite e PostgreSQL!)
app.put(
  '/api/salario',
  autenticar,
  asyncHandler(async (req, res) => {
    const valor = Number(req.body.valor);
    const diaPagamento = Math.floor(Number(req.body.diaPagamento));
    const contaIdFinal = await resolverContaId(req.body.contaId, req.usuario.id);

    if (!Number.isFinite(valor) || valor <= 0) {
      return res.status(400).json({ erro: 'Informe um valor de salário maior que zero.' });
    }
    if (!Number.isInteger(diaPagamento) || diaPagamento < 1 || diaPagamento > 31) {
      return res.status(400).json({ erro: 'Informe um dia de pagamento entre 1 e 31.' });
    }

    await db.run(
      `
        INSERT INTO salario_fixo (usuario_id, valor, dia_pagamento, conta_id, atualizado_em)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(usuario_id) DO UPDATE SET
          valor = excluded.valor,
          dia_pagamento = excluded.dia_pagamento,
          conta_id = excluded.conta_id,
          atualizado_em = CURRENT_TIMESTAMP
      `,
      req.usuario.id,
      valor,
      diaPagamento,
      contaIdFinal
    );

    const config = await db.get(
      `
        SELECT s.valor, s.dia_pagamento, s.conta_id, c.nome AS conta_nome
        FROM salario_fixo s
        LEFT JOIN contas c ON c.id = s.conta_id AND c.usuario_id = s.usuario_id
        WHERE s.usuario_id = ?
      `,
      req.usuario.id
    );

    const proximo = await calcularProximoSalario(config, req.usuario.id);

    return res.json({
      salario: {
        valor: config.valor,
        diaPagamento: config.dia_pagamento,
        contaId: config.conta_id || null,
        contaNome: config.conta_nome || null,
      },
      proximo,
    });
  })
);

// 17. Remover salário fixo
app.delete(
  '/api/salario',
  autenticar,
  asyncHandler(async (req, res) => {
    await db.run('DELETE FROM salario_fixo WHERE usuario_id = ?', req.usuario.id);
    return res.json({ ok: true });
  })
);

// ============================================================================
// ROTAS DE METAS FINANCEIRAS (Objetivos de Economia)
// ============================================================================

const SELECT_META_BASE = `
  SELECT
    m.id, m.titulo, m.valor_alvo, m.valor_atual, m.prazo,
    m.cor, m.conta_id, m.observacao, m.criado_em,
    c.nome AS conta_nome,
    c.cor AS conta_cor
  FROM metas m
  LEFT JOIN contas c ON c.id = m.conta_id AND c.usuario_id = m.usuario_id
`;

// 18. Listar todas as metas do usuário logado
app.get(
  '/api/metas',
  autenticar,
  asyncHandler(async (req, res) => {
    const metas = await db.all(
      `
        ${SELECT_META_BASE}
        WHERE m.usuario_id = ?
        ORDER BY m.id DESC
      `,
      req.usuario.id
    );

    return res.json({ metas });
  })
);

// 19. Criar nova meta financeira
app.post(
  '/api/metas',
  autenticar,
  asyncHandler(async (req, res) => {
    const { titulo, valorAlvo, valorAtual, prazo, cor, contaId, observacao } = req.body;

    const alvoNum = Number(valorAlvo);
    const atualNum =
      valorAtual === undefined || valorAtual === null || valorAtual === ''
        ? 0
        : Number(valorAtual);

    if (!titulo?.trim()) {
      return res.status(400).json({ erro: 'Informe um nome para a meta (ex.: Reserva de emergência).' });
    }
    if (!Number.isFinite(alvoNum) || alvoNum <= 0) {
      return res.status(400).json({ erro: 'Informe um valor alvo maior que zero.' });
    }
    if (!Number.isFinite(atualNum) || atualNum < 0) {
      return res.status(400).json({ erro: 'O valor já guardado não pode ser negativo.' });
    }

    let prazoFinal = null;
    if (prazo && String(prazo).trim() !== '') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(prazo).trim())) {
        return res.status(400).json({ erro: 'Informe uma data de prazo válida (AAAA-MM-DD).' });
      }
      prazoFinal = String(prazo).trim();
    }

    const corFinal = /^#[0-9a-fA-F]{6}$/.test(cor || '') ? cor : '#22c55e';
    const contaIdFinal = await resolverContaId(contaId, req.usuario.id);
    const observacaoFinal = observacao?.trim() || '';

    const novoId = await db.insert(
      `
        INSERT INTO metas (
          usuario_id, titulo, valor_alvo, valor_atual, prazo, cor, conta_id, observacao
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      req.usuario.id,
      titulo.trim(),
      alvoNum,
      contaIdFinal ? 0 : atualNum,
      prazoFinal,
      corFinal,
      contaIdFinal,
      observacaoFinal
    );

    const criada = await db.get(`${SELECT_META_BASE} WHERE m.id = ?`, novoId);

    return res.status(201).json({ meta: criada });
  })
);

// 20. Editar uma meta existente
app.put(
  '/api/metas/:id',
  autenticar,
  asyncHandler(async (req, res) => {
    const id = validarIdPositivo(req.params.id);
    if (!id) {
      return res.status(400).json({ erro: 'ID de meta inválido.' });
    }
    const { titulo, valorAlvo, valorAtual, prazo, cor, contaId, observacao } = req.body;

    const alvoNum = Number(valorAlvo);
    const atualNum =
      valorAtual === undefined || valorAtual === null || valorAtual === ''
        ? 0
        : Number(valorAtual);

    if (!titulo?.trim()) {
      return res.status(400).json({ erro: 'Informe um nome para a meta.' });
    }
    if (!Number.isFinite(alvoNum) || alvoNum <= 0) {
      return res.status(400).json({ erro: 'Informe um valor alvo maior que zero.' });
    }
    if (!Number.isFinite(atualNum) || atualNum < 0) {
      return res.status(400).json({ erro: 'O valor já guardado não pode ser negativo.' });
    }

    let prazoFinal = null;
    if (prazo && String(prazo).trim() !== '') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(prazo).trim())) {
        return res.status(400).json({ erro: 'Informe uma data de prazo válida (AAAA-MM-DD).' });
      }
      prazoFinal = String(prazo).trim();
    }

    const corFinal = /^#[0-9a-fA-F]{6}$/.test(cor || '') ? cor : '#22c55e';
    const contaIdFinal = await resolverContaId(contaId, req.usuario.id);
    const observacaoFinal = observacao?.trim() || '';

    const resultado = await db.run(
      `
        UPDATE metas
        SET titulo = ?, valor_alvo = ?, valor_atual = ?, prazo = ?,
            cor = ?, conta_id = ?, observacao = ?
        WHERE id = ? AND usuario_id = ?
      `,
      titulo.trim(),
      alvoNum,
      atualNum,
      prazoFinal,
      corFinal,
      contaIdFinal,
      observacaoFinal,
      id,
      req.usuario.id
    );

    if (resultado.changes === 0) {
      return res.status(404).json({ erro: 'Meta não encontrada.' });
    }

    const atualizada = await db.get(
      `${SELECT_META_BASE} WHERE m.id = ? AND m.usuario_id = ?`,
      id,
      req.usuario.id
    );
    return res.json({ meta: atualizada });
  })
);

// 21. Registrar aporte ou retirada rápida em uma meta manual (SQL padrão ANSI compatível com SQLite e PostgreSQL)
app.patch(
  '/api/metas/:id/aportar',
  autenticar,
  asyncHandler(async (req, res) => {
    const id = validarIdPositivo(req.params.id);
    if (!id) {
      return res.status(400).json({ erro: 'ID de meta inválido.' });
    }
    const valor = Number(req.body.valor);
    const operacao = req.body.operacao === 'retirar' ? 'retirar' : 'aportar';

    if (!Number.isFinite(valor) || valor <= 0) {
      return res.status(400).json({ erro: 'Informe um valor maior que zero.' });
    }

    const metaAtual = await db.get(
      'SELECT id, conta_id FROM metas WHERE id = ? AND usuario_id = ?',
      id,
      req.usuario.id
    );

    if (!metaAtual) {
      return res.status(404).json({ erro: 'Meta não encontrada.' });
    }

    if (metaAtual.conta_id) {
      return res.status(400).json({
        erro: 'Esta meta acompanha uma carteira automaticamente. Faça uma transferência para essa carteira na aba Entradas.',
      });
    }

    const delta = operacao === 'retirar' ? -valor : valor;

    await db.run(
      `
        UPDATE metas
        SET valor_atual = ROUND((CASE WHEN valor_atual + ? < 0 THEN 0 ELSE valor_atual + ? END) * 100) / 100.0
        WHERE id = ? AND usuario_id = ?
      `,
      delta,
      delta,
      id,
      req.usuario.id
    );

    const atualizada = await db.get(
      `${SELECT_META_BASE} WHERE m.id = ? AND m.usuario_id = ?`,
      id,
      req.usuario.id
    );
    return res.json({ meta: atualizada });
  })
);

// 22. Excluir uma meta
app.delete(
  '/api/metas/:id',
  autenticar,
  asyncHandler(async (req, res) => {
    const id = validarIdPositivo(req.params.id);
    if (!id) {
      return res.status(400).json({ erro: 'ID de meta inválido.' });
    }

    const resultado = await db.run(
      'DELETE FROM metas WHERE id = ? AND usuario_id = ?',
      id,
      req.usuario.id
    );

    if (resultado.changes === 0) {
      return res.status(404).json({ erro: 'Meta não encontrada.' });
    }

    return res.json({ ok: true });
  })
);

// ============================================================================
// ROTAS DE DESPESAS FIXAS MENSAIS (Recorrentes na aba Saídas e Estatísticas)
// ============================================================================

const SELECT_DESPESA_FIXA_BASE = `
  SELECT
    d.id, d.titulo, d.valor, d.dia_vencimento, d.categoria,
    d.conta_id, d.ativa, d.criado_em,
    c.nome AS conta_nome,
    c.cor AS conta_cor
  FROM despesas_fixas d
  LEFT JOIN contas c ON c.id = d.conta_id AND c.usuario_id = d.usuario_id
`;

// 23. Listar despesas fixas mensais do usuário
app.get(
  '/api/despesas-fixas',
  autenticar,
  asyncHandler(async (req, res) => {
    const despesas = await db.all(
      `
        ${SELECT_DESPESA_FIXA_BASE}
        WHERE d.usuario_id = ?
        ORDER BY d.ativa DESC, d.dia_vencimento ASC, d.id ASC
      `,
      req.usuario.id
    );

    return res.json({ despesas });
  })
);

// 24. Criar nova despesa fixa mensal
app.post(
  '/api/despesas-fixas',
  autenticar,
  asyncHandler(async (req, res) => {
    const { titulo, valor, diaVencimento, categoria, contaId } = req.body;

    const valorNum = Number(valor);
    const diaNum = Math.floor(Number(diaVencimento));

    if (!titulo?.trim()) {
      return res.status(400).json({ erro: 'Informe o nome da despesa fixa (ex.: Internet, Academia).' });
    }
    if (!Number.isFinite(valorNum) || valorNum <= 0) {
      return res.status(400).json({ erro: 'Informe um valor mensal maior que zero.' });
    }
    if (!Number.isInteger(diaNum) || diaNum < 1 || diaNum > 31) {
      return res.status(400).json({ erro: 'Informe um dia de vencimento entre 1 e 31.' });
    }

    const categoriaFinal = categoria?.trim() || 'Moradia';
    const contaIdFinal = await resolverContaId(contaId, req.usuario.id);

    const novoId = await db.insert(
      `
        INSERT INTO despesas_fixas (
          usuario_id, titulo, valor, dia_vencimento, categoria, conta_id, ativa
        )
        VALUES (?, ?, ?, ?, ?, ?, 1)
      `,
      req.usuario.id,
      titulo.trim(),
      valorNum,
      diaNum,
      categoriaFinal,
      contaIdFinal
    );

    const criada = await db.get(`${SELECT_DESPESA_FIXA_BASE} WHERE d.id = ?`, novoId);

    return res.status(201).json({ despesa: criada });
  })
);

// 25. Editar despesa fixa mensal
app.put(
  '/api/despesas-fixas/:id',
  autenticar,
  asyncHandler(async (req, res) => {
    const id = validarIdPositivo(req.params.id);
    if (!id) {
      return res.status(400).json({ erro: 'ID de despesa fixa inválido.' });
    }
    const { titulo, valor, diaVencimento, categoria, contaId, ativa } = req.body;

    const valorNum = Number(valor);
    const diaNum = Math.floor(Number(diaVencimento));

    if (!titulo?.trim()) {
      return res.status(400).json({ erro: 'Informe o nome da despesa fixa.' });
    }
    if (!Number.isFinite(valorNum) || valorNum <= 0) {
      return res.status(400).json({ erro: 'Informe um valor mensal maior que zero.' });
    }
    if (!Number.isInteger(diaNum) || diaNum < 1 || diaNum > 31) {
      return res.status(400).json({ erro: 'Informe um dia de vencimento entre 1 e 31.' });
    }

    const categoriaFinal = categoria?.trim() || 'Moradia';
    const contaIdFinal = await resolverContaId(contaId, req.usuario.id);
    const ativaFinal = ativa === false || ativa === 0 ? 0 : 1;

    const resultado = await db.run(
      `
        UPDATE despesas_fixas
        SET titulo = ?, valor = ?, dia_vencimento = ?, categoria = ?, conta_id = ?, ativa = ?
        WHERE id = ? AND usuario_id = ?
      `,
      titulo.trim(),
      valorNum,
      diaNum,
      categoriaFinal,
      contaIdFinal,
      ativaFinal,
      id,
      req.usuario.id
    );

    if (resultado.changes === 0) {
      return res.status(404).json({ erro: 'Despesa fixa não encontrada.' });
    }

    const atualizada = await db.get(
      `${SELECT_DESPESA_FIXA_BASE} WHERE d.id = ? AND d.usuario_id = ?`,
      id,
      req.usuario.id
    );
    return res.json({ despesa: atualizada });
  })
);

// 26. Pausar ou reativar uma despesa fixa mensal
app.patch(
  '/api/despesas-fixas/:id/ativa',
  autenticar,
  asyncHandler(async (req, res) => {
    const id = validarIdPositivo(req.params.id);
    if (!id) {
      return res.status(400).json({ erro: 'ID de despesa fixa inválido.' });
    }
    const ativaFinal = req.body.ativa ? 1 : 0;

    const resultado = await db.run(
      'UPDATE despesas_fixas SET ativa = ? WHERE id = ? AND usuario_id = ?',
      ativaFinal,
      id,
      req.usuario.id
    );

    if (resultado.changes === 0) {
      return res.status(404).json({ erro: 'Despesa fixa não encontrada.' });
    }

    const atualizada = await db.get(
      `${SELECT_DESPESA_FIXA_BASE} WHERE d.id = ? AND d.usuario_id = ?`,
      id,
      req.usuario.id
    );
    return res.json({ despesa: atualizada });
  })
);

// 27. Excluir uma despesa fixa mensal
app.delete(
  '/api/despesas-fixas/:id',
  autenticar,
  asyncHandler(async (req, res) => {
    const id = validarIdPositivo(req.params.id);
    if (!id) {
      return res.status(400).json({ erro: 'ID de despesa fixa inválido.' });
    }

    const resultado = await db.run(
      'DELETE FROM despesas_fixas WHERE id = ? AND usuario_id = ?',
      id,
      req.usuario.id
    );

    if (resultado.changes === 0) {
      return res.status(404).json({ erro: 'Despesa fixa não encontrada.' });
    }

    return res.json({ ok: true });
  })
);

// ============================================================================
// ROTAS DE NOTIFICAÇÕES POR E-MAIL (Preferências, Teste e Disparo Diário Cron)
// ============================================================================

function obterAppUrlPublica() {
  return (process.env.FRONTEND_URL || process.env.RENDER_EXTERNAL_URL || '').trim();
}

function compararSegredoSeguro(recebido, esperado) {
  if (!recebido || !esperado) return false;
  const h1 = crypto.createHash('sha256').update(String(recebido)).digest();
  const h2 = crypto.createHash('sha256').update(String(esperado)).digest();
  return crypto.timingSafeEqual(h1, h2);
}

// 28. Buscar preferências de notificação por e-mail + próxima data do resumo mensal
app.get(
  '/api/notificacoes/config',
  autenticar,
  asyncHandler(async (req, res) => {
    const config = await obterConfigNotificacaoUsuario(db, req.usuario.id);
    const salario = await db.get(
      'SELECT dia_pagamento FROM salario_fixo WHERE usuario_id = ?',
      req.usuario.id
    );
    const hoje = obterDataBrasilia();
    const diaPagamento = salario ? Number(salario.dia_pagamento) : null;

    const proximoResumo = calcularProximoDisparoResumo({
      hojeIso: hoje.dataIso,
      diaPagamento,
      diasAntes: config.diasAntesSalario,
    });

    const ultimosEnvios = await db.all(
      `
        SELECT tipo, chave_referencia, enviado_em
        FROM notificacoes_enviadas
        WHERE usuario_id = ?
        ORDER BY id DESC
        LIMIT 5
      `,
      req.usuario.id
    );

    return res.json({
      config,
      emailConfigurado: emailConfigurado(),
      diaSalario: diaPagamento,
      proximoResumo,
      ultimosEnvios,
    });
  })
);

// 29. Salvar preferências de notificação por e-mail
app.put(
  '/api/notificacoes/config',
  autenticar,
  asyncHandler(async (req, res) => {
    const ativo = req.body.ativo ? 1 : 0;
    const lembreteDia = req.body.lembreteDia ? 1 : 0;
    const lembreteVespera = req.body.lembreteVespera ? 1 : 0;
    const resumoMensal = req.body.resumoMensal ? 1 : 0;
    const diasAntesNum = Number(req.body.diasAntesSalario ?? 1);

    if (!Number.isInteger(diasAntesNum) || diasAntesNum < 0 || diasAntesNum > 5) {
      return res
        .status(400)
        .json({ erro: 'A antecedência do resumo mensal deve ficar entre 0 e 5 dias.' });
    }

    await db.run(
      `
        INSERT INTO notificacoes_config (
          usuario_id, ativo, lembrete_dia, lembrete_vespera, resumo_mensal, dias_antes_salario, atualizado_em
        )
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(usuario_id) DO UPDATE SET
          ativo = excluded.ativo,
          lembrete_dia = excluded.lembrete_dia,
          lembrete_vespera = excluded.lembrete_vespera,
          resumo_mensal = excluded.resumo_mensal,
          dias_antes_salario = excluded.dias_antes_salario,
          atualizado_em = CURRENT_TIMESTAMP
      `,
      req.usuario.id,
      ativo,
      lembreteDia,
      lembreteVespera,
      resumoMensal,
      diasAntesNum
    );

    const config = await obterConfigNotificacaoUsuario(db, req.usuario.id);
    const salario = await db.get(
      'SELECT dia_pagamento FROM salario_fixo WHERE usuario_id = ?',
      req.usuario.id
    );
    const hoje = obterDataBrasilia();
    const diaPagamento = salario ? Number(salario.dia_pagamento) : null;
    const proximoResumo = calcularProximoDisparoResumo({
      hojeIso: hoje.dataIso,
      diaPagamento,
      diasAntes: config.diasAntesSalario,
    });

    return res.json({ config, proximoResumo });
  })
);

// 30. Enviar e-mail de teste na hora para o próprio usuário logado
app.post(
  '/api/notificacoes/testar',
  autenticar,
  authRateLimiter,
  asyncHandler(async (req, res) => {
    const tipo = req.body?.tipo === 'vencimento' ? 'vencimento' : 'resumo';
    const usuarioDb = await db.get(
      'SELECT id, nome, email FROM usuarios WHERE id = ?',
      req.usuario.id
    );

    if (!usuarioDb) {
      return res.status(404).json({ erro: 'Usuário não encontrado.' });
    }

    const hoje = obterDataBrasilia();
    const appUrl = obterAppUrlPublica();

    if (tipo === 'vencimento') {
      let dataAlvo = hoje.dataIso;
      let { itens, total } = await coletarContasDoDia(db, usuarioDb.id, dataAlvo);
      let usandoExemplo = false;

      // Se não houver nada vencendo exatamente hoje, busca a próxima conta pendente do usuário
      if (itens.length === 0) {
        const proxima = await db.get(
          `
            SELECT data FROM lancamentos
            WHERE usuario_id = ?
              AND status = 'pendente'
              AND tipo IN ('divida', 'saida')
              AND data >= ?
            ORDER BY data ASC
            LIMIT 1
          `,
          usuarioDb.id,
          hoje.dataIso
        );

        if (proxima?.data) {
          dataAlvo = proxima.data;
          ({ itens, total } = await coletarContasDoDia(db, usuarioDb.id, dataAlvo));
        }
      }

      if (itens.length === 0) {
        usandoExemplo = true;
        itens = [
          {
            titulo: 'Parcela exemplo (cartão)',
            valor: 250,
            data: hoje.dataIso,
            categoria: 'Cartão de crédito',
            origem: 'Cartão exemplo',
            fonte: 'divida',
          },
        ];
        total = 250;
      }

      try {
        const envio = await enviarLembreteVencimento({
          para: usuarioDb.email,
          nome: usuarioDb.nome,
          dataIso: dataAlvo,
          ehAmanha: false,
          itens,
          total,
          appUrl,
          ehTeste: true,
        });

        const avisoExemplo = usandoExemplo
          ? ' (usamos um exemplo porque você não tem contas pendentes futuras cadastradas)'
          : '';

        return res.json({
          ok: true,
          modo: envio.modo,
          mensagem:
            envio.modo === 'dev'
              ? `Modo local (sem Brevo): preview do lembrete exibido no terminal do servidor${avisoExemplo}.`
              : `Lembrete de teste enviado para ${usuarioDb.email}${avisoExemplo}! Confira sua caixa de entrada.`,
        });
      } catch (err) {
        console.error('Erro ao enviar lembrete de teste:', err);
        return res.status(503).json({
          erro: 'O envio de e-mail ainda não está configurado no servidor (Brevo). Configure BREVO_API_KEY e EMAIL_REMETENTE no Render.',
        });
      }
    }

    // Teste de resumo mensal
    let resumo = await coletarResumoDoMes(db, usuarioDb.id, hoje.mesRef);
    let usandoExemplo = false;

    if (resumo.itens.length === 0) {
      usandoExemplo = true;
      resumo = {
        ...resumo,
        itens: [
          {
            titulo: 'Conta de exemplo 1',
            valor: 320,
            data: `${hoje.mesRef}-10`,
            categoria: 'Cartão de crédito',
            origem: 'Cartão exemplo',
            fonte: 'divida',
          },
          {
            titulo: 'Internet (exemplo)',
            valor: 110,
            data: `${hoje.mesRef}-15`,
            categoria: 'Moradia',
            origem: '',
            fonte: 'despesa_fixa',
          },
        ],
        totalMes: 430,
      };
    }

    try {
      const envio = await enviarResumoMensal({
        para: usuarioDb.email,
        nome: usuarioDb.nome,
        nomeMes: resumo.nomeMes,
        diaSalario: resumo.diaSalario,
        salarioValor: resumo.salarioValor,
        itens: resumo.itens,
        totalMes: resumo.totalMes,
        appUrl,
        ehTeste: true,
      });

      const avisoExemplo = usandoExemplo
        ? ' (usamos dados de exemplo porque este mês não tem contas pendentes)'
        : '';

      return res.json({
        ok: true,
        modo: envio.modo,
        mensagem:
          envio.modo === 'dev'
            ? `Modo local (sem Brevo): preview do resumo mensal exibido no terminal do servidor${avisoExemplo}.`
            : `Resumo mensal de teste enviado para ${usuarioDb.email}${avisoExemplo}! Confira sua caixa de entrada.`,
      });
    } catch (err) {
      console.error('Erro ao enviar resumo de teste:', err);
      return res.status(503).json({
        erro: 'O envio de e-mail ainda não está configurado no servidor (Brevo). Configure BREVO_API_KEY e EMAIL_REMETENTE no Render.',
      });
    }
  })
);

// 31. Rota protegida de Cron diário (acionada às 08h BRT pelo GitHub Actions)
let rotinaNotificacoesEmAndamento = false;

app.post(
  '/api/cron/notificacoes',
  authRateLimiter,
  asyncHandler(async (req, res) => {
    const segredoEsperado = (process.env.CRON_SECRET || '').trim();
    if (segredoEsperado.length < 16) {
      return res.status(503).json({
        erro: 'Rotina automática não configurada (defina CRON_SECRET com pelo menos 16 caracteres).',
      });
    }

    const headerAuth = String(req.headers.authorization || '');
    const bearerToken = headerAuth.startsWith('Bearer ') ? headerAuth.slice(7).trim() : '';
    const segredoRecebido = String(req.headers['x-cron-secret'] || bearerToken || '').trim();

    if (!compararSegredoSeguro(segredoRecebido, segredoEsperado)) {
      return res.status(401).json({ erro: 'Chave de agendamento inválida.' });
    }

    if (rotinaNotificacoesEmAndamento) {
      return res.status(409).json({
        erro: 'A rotina de notificações já está em execução. Aguarde concluir.',
      });
    }

    rotinaNotificacoesEmAndamento = true;
    try {
      const resumoExecucao = await executarRotinaNotificacoes({
        db,
        appUrl: obterAppUrlPublica(),
      });
      return res.json({ ok: true, ...resumoExecucao });
    } finally {
      rotinaNotificacoesEmAndamento = false;
    }
  })
);

// ============================================================================
// ROTAS DO AGENTE DE IA FINANCEIRO (Google Gemini + Confirmação em 1 clique)
// ============================================================================

app.get(
  '/api/agente/status',
  autenticar,
  asyncHandler(async (_req, res) => {
    return res.json(obterStatusAgente());
  })
);

app.get(
  '/api/agente/historico',
  autenticar,
  asyncHandler(async (req, res) => {
    const mensagens = await carregarHistoricoAgente(req.usuario.id, { db, limite: 50 });
    return res.json({ mensagens });
  })
);

app.post(
  '/api/agente/mensagem',
  autenticar,
  agenteRateLimiter,
  asyncHandler(async (req, res) => {
    const mensagem = typeof req.body?.mensagem === 'string' ? req.body.mensagem.trim() : '';
    if (!mensagem) {
      return res.status(400).json({ erro: 'Digite uma mensagem para o assistente.' });
    }
    if (mensagem.length > 1500) {
      return res.status(400).json({ erro: 'A mensagem pode ter no máximo 1500 caracteres.' });
    }

    try {
      const resultado = await processarMensagemAgente({
        usuarioId: req.usuario.id,
        mensagem,
        db,
      });
      return res.json(resultado);
    } catch (err) {
      if (err?.status && err.status >= 400 && err.status < 600) {
        return res.status(err.status).json({ erro: err.message });
      }
      throw err;
    }
  })
);

app.post(
  '/api/agente/acoes/:id/confirmar',
  autenticar,
  asyncHandler(async (req, res) => {
    const id = validarIdPositivo(req.params.id);
    if (!id) {
      return res.status(400).json({ erro: 'ID de ação inválido.' });
    }

    try {
      const { acao, resultado } = await confirmarAcaoPendente(id, req.usuario.id, { db });
      return res.json({ ok: true, acao, resultado });
    } catch (err) {
      if (err?.status && err.status >= 400 && err.status < 600) {
        return res.status(err.status).json({ erro: err.message });
      }
      throw err;
    }
  })
);

app.post(
  '/api/agente/acoes/:id/cancelar',
  autenticar,
  asyncHandler(async (req, res) => {
    const id = validarIdPositivo(req.params.id);
    if (!id) {
      return res.status(400).json({ erro: 'ID de ação inválido.' });
    }

    try {
      const { acao } = await cancelarAcaoPendente(id, req.usuario.id, { db });
      return res.json({ ok: true, acao });
    } catch (err) {
      if (err?.status && err.status >= 400 && err.status < 600) {
        return res.status(err.status).json({ erro: err.message });
      }
      throw err;
    }
  })
);

app.delete(
  '/api/agente/historico',
  autenticar,
  asyncHandler(async (req, res) => {
    const resultado = await limparHistoricoAgente(req.usuario.id, { db });
    return res.json(resultado);
  })
);

// Serve o Frontend React compilado (frontend/dist) se existir, permitindo rodar tudo em 1 único servidor
const frontendDist = path.join(__dirname, '..', '..', 'frontend', 'dist');
if (fs.existsSync(frontendDist)) {
  app.use(
    express.static(frontendDist, {
      setHeaders: (res, filePath) => {
        if (
          filePath.endsWith('index.html') ||
          filePath.endsWith('sw.js') ||
          filePath.endsWith('manifest.json')
        ) {
          res.setHeader('Cache-Control', 'no-store');
        }
      },
    })
  );
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
}

// Tratador global de erros: evita vazar detalhes internos do banco/código para o navegador
app.use((err, _req, res, _next) => {
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ erro: 'Formato JSON inválido na requisição.' });
  }
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ erro: 'Requisição grande demais.' });
  }
  if (err?.status === 403) {
    return res.status(403).json({ erro: err.message || 'Acesso bloqueado.' });
  }

  console.error('Erro inesperado na API:', err);
  return res.status(500).json({ erro: 'Erro interno do servidor. Tente novamente.' });
});

initDb()
  .then(() => {
    app.listen(PORT, HOST, () => {
      console.log(
        `Servidor rodando em http://${HOST}:${PORT} (${IS_PROD ? 'produção' : 'desenvolvimento'} • banco: ${dbType})`
      );
    });
  })
  .catch((err) => {
    console.error('Falha ao inicializar o banco de dados:', err);
    process.exit(1);
  });
