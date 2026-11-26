import crypto from 'node:crypto';
import { db as dbPadrao } from './db.js';
import { obterDataBrasilia } from './notificacoes.js';

const MAX_TITULO = 120;
const MAX_CATEGORIA = 60;
const MAX_OBSERVACAO = 300;
const MAX_ORIGEM = 80;
const MAX_VALOR_FINANCEIRO = 100_000_000;
const PRAZO_EXPIRACAO_ACAO_MS = 24 * 60 * 60 * 1000;

function criarErroHttp(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function parseTimestampMs(valor) {
  if (!valor) return null;
  if (valor instanceof Date) {
    const ms = valor.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  const texto = String(valor).trim();
  if (!texto) return null;
  // SQLite datetime('now', 'localtime') gera "YYYY-MM-DD HH:MM:SS"
  const normalizado = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(texto)
    ? texto.replace(' ', 'T')
    : texto;
  const ms = Date.parse(normalizado);
  return Number.isFinite(ms) ? ms : null;
}

function validarValorPositivoSeguro(valorBruto, mensagemVazio = 'Informe um valor maior que zero.') {
  const numero = Number(valorBruto);
  if (!Number.isFinite(numero) || numero <= 0) {
    throw criarErroHttp(400, mensagemVazio);
  }
  const arredondado = Math.round(numero * 100) / 100;
  if (arredondado < 0.01) {
    throw criarErroHttp(400, 'Informe um valor mínimo de R$ 0,01.');
  }
  if (arredondado > MAX_VALOR_FINANCEIRO) {
    throw criarErroHttp(400, 'Valor excede o limite máximo permitido.');
  }
  return arredondado;
}

function validarTextoCurto(valor, maxLen, nomeCampo) {
  const limpo = String(valor || '').trim();
  if (limpo.length > maxLen) {
    throw criarErroHttp(400, `${nomeCampo} pode ter no máximo ${maxLen} caracteres.`);
  }
  return limpo;
}

function formatarMoedaBr(valor) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(Number(valor) || 0);
}

function formatarDataBr(dataIso) {
  if (!dataIso || !/^\d{4}-\d{2}-\d{2}$/.test(dataIso)) return dataIso || '';
  const [ano, mes, dia] = dataIso.split('-');
  return `${dia}/${mes}/${ano}`;
}

function somarMesesSeguro(dataIso, mesesParaSomar) {
  const [anoOrig, mesOrig, diaOrig] = dataIso.split('-').map(Number);
  const totalMeses = anoOrig * 12 + (mesOrig - 1) + mesesParaSomar;
  const novoAno = Math.floor(totalMeses / 12);
  const novoMes = (totalMeses % 12) + 1;
  const ultimoDiaDoMes = new Date(novoAno, novoMes, 0).getDate();
  const diaFinal = Math.min(diaOrig, ultimoDiaDoMes);
  return `${novoAno}-${String(novoMes).padStart(2, '0')}-${String(diaFinal).padStart(2, '0')}`;
}

function moverMesIso(mesIso, delta) {
  const [ano, mes] = mesIso.split('-').map(Number);
  const total = ano * 12 + (mes - 1) + delta;
  const novoAno = Math.floor(total / 12);
  const novoMes = (total % 12) + 1;
  return `${novoAno}-${String(novoMes).padStart(2, '0')}`;
}

async function resolverContaDoUsuario(contaId, usuarioId, db) {
  if (contaId === null || contaId === undefined || contaId === '') return null;
  const id = Number(contaId);
  if (!Number.isInteger(id) || id <= 0) return null;
  const conta = await db.get(
    'SELECT id, nome FROM contas WHERE id = ? AND usuario_id = ?',
    id,
    usuarioId
  );
  return conta || null;
}

function serializarAcao(row) {
  if (!row) return null;
  let payload = {};
  let resultado = null;
  try {
    payload = JSON.parse(row.payload_json || '{}');
  } catch {
    payload = {};
  }
  if (row.resultado_json) {
    try {
      resultado = JSON.parse(row.resultado_json);
    } catch {
      resultado = null;
    }
  }
  return {
    id: Number(row.id),
    mensagemId: row.mensagem_id ? Number(row.mensagem_id) : null,
    tipoAcao: row.tipo_acao,
    resumo: row.resumo,
    payload,
    status: row.status,
    resultado,
    criadoEm: row.criado_em || null,
    resolvidoEm: row.resolvido_em || null,
  };
}

/**
 * Declarações de ferramentas expostas ao Google Gemini (Function Calling).
 * REGRA DE SEGURANÇA: nunca expor ferramentas de exclusão de lançamentos nem de transferências.
 */
export const DECLARACOES_FERRAMENTAS = [
  // --- 7 FERRAMENTAS DE LEITURA ---
  {
    name: 'obter_resumo_financeiro',
    description:
      'Retorna o resumo financeiro do usuário (entradas recebidas, previstas, saídas pagas, a pagar, dívidas pendentes, saldo real, saldo previsto, salário fixo e total de despesas fixas ativas). Passe "mes" (YYYY-MM) para filtrar um mês específico ou omita para o acumulado geral.',
    parameters: {
      type: 'OBJECT',
      properties: {
        mes: {
          type: 'STRING',
          description: 'Mês no formato YYYY-MM (opcional). Ex.: 2026-11',
        },
      },
    },
  },
  {
    name: 'listar_carteiras',
    description:
      'Lista todas as carteiras/contas do usuário com id, nome, etiqueta, rendimento e saldo atual calculado. Use sempre antes de propor um lançamento com carteira específica para obter o conta_id correto.',
    parameters: {
      type: 'OBJECT',
      properties: {},
    },
  },
  {
    name: 'listar_lancamentos',
    description:
      'Lista lançamentos do usuário com filtros opcionais (mês YYYY-MM, tipo, status, texto de busca e limite até 50). Use para consultar gastos específicos ou encontrar o id de um lançamento pendente antes de marcar como pago.',
    parameters: {
      type: 'OBJECT',
      properties: {
        mes: { type: 'STRING', description: 'Mês no formato YYYY-MM (opcional)' },
        tipo: {
          type: 'STRING',
          description: 'Filtrar por tipo: entrada, saida ou divida (opcional)',
        },
        status: {
          type: 'STRING',
          description: 'Filtrar por status: pago ou pendente (opcional)',
        },
        busca: {
          type: 'STRING',
          description: 'Texto para buscar no título, categoria ou origem da dívida (opcional)',
        },
        limite: {
          type: 'INTEGER',
          description: 'Quantidade máxima de itens (padrão 25, máximo 50)',
        },
      },
    },
  },
  {
    name: 'resumo_dividas_e_cartoes',
    description:
      'Agrupa dívidas pendentes por cartão/pessoa (origem_divida) e lista os próximos vencimentos.',
    parameters: {
      type: 'OBJECT',
      properties: {
        mes: { type: 'STRING', description: 'Mês no formato YYYY-MM (opcional)' },
      },
    },
  },
  {
    name: 'listar_despesas_fixas',
    description: 'Lista todas as despesas fixas mensais (ativas e pausadas) com valor e dia de vencimento.',
    parameters: {
      type: 'OBJECT',
      properties: {},
    },
  },
  {
    name: 'listar_metas',
    description: 'Lista as metas financeiras do usuário com valor atual, valor alvo, progresso percentual e prazo.',
    parameters: {
      type: 'OBJECT',
      properties: {},
    },
  },
  {
    name: 'projetar_proximos_meses',
    description:
      'Projeta o fluxo mensal (salário fixo, despesas fixas ativas, parcelas/lançamentos pendentes e saldo projetado) para os próximos N meses (1 a 12). Útil para simular se novas compras ou parcelas cabem no orçamento.',
    parameters: {
      type: 'OBJECT',
      properties: {
        meses: {
          type: 'INTEGER',
          description: 'Quantidade de meses para projetar (padrão 6, mínimo 1, máximo 12)',
        },
      },
    },
  },

  // --- 4 FERRAMENTAS DE PROPOSTA DE AÇÃO (NUNCA GRAVAM DIRETO — EXIGEM CONFIRMAÇÃO EM 1 CLIQUE) ---
  {
    name: 'propor_criar_lancamento',
    description:
      'Propõe a criação de um novo lançamento (entrada, saída ou dívida simples/parcelada) para confirmação em 1 clique pelo usuário. Nunca grava diretamente no banco.',
    parameters: {
      type: 'OBJECT',
      properties: {
        titulo: { type: 'STRING', description: 'Descrição curta do lançamento (ex.: Mercado, Aluguel)' },
        valor: { type: 'NUMBER', description: 'Valor numérico maior que zero' },
        tipo: {
          type: 'STRING',
          enum: ['entrada', 'saida', 'divida'],
          description: 'Obrigatório: entrada, saida ou divida',
        },
        categoria: { type: 'STRING', description: 'Categoria (padrão Geral)' },
        data: { type: 'STRING', description: 'Data no formato YYYY-MM-DD (padrão hoje)' },
        status: {
          type: 'STRING',
          enum: ['pago', 'pendente'],
          description: 'pago ou pendente (padrão pago para entrada/saida, pendente para divida)',
        },
        conta_id: { type: 'INTEGER', description: 'ID numérico da carteira obtido em listar_carteiras (opcional)' },
        parcelas: { type: 'INTEGER', description: 'Número de parcelas (1 a 60), usado quando tipo = divida' },
        modo_valor_parcela: {
          type: 'STRING',
          enum: ['total', 'parcela'],
          description:
            'Obrigatório quando parcelas > 1: use "total" se o valor informado for o total da compra (ex.: 1200 em 6x) ou "parcela" se for o valor de cada parcela (ex.: 6x de 200).',
        },
        origem_divida: { type: 'STRING', description: 'Nome do cartão ou pessoa (usado quando tipo = divida)' },
        observacao: { type: 'STRING', description: 'Observação opcional' },
      },
      required: ['titulo', 'valor', 'tipo'],
    },
  },
  {
    name: 'propor_marcar_pago',
    description:
      'Propõe marcar um lançamento pendente como pago para confirmação em 1 clique. Consulte listar_lancamentos antes para obter o lancamento_id.',
    parameters: {
      type: 'OBJECT',
      properties: {
        lancamento_id: { type: 'INTEGER', description: 'ID do lançamento pendente' },
        conta_id: { type: 'INTEGER', description: 'ID da carteira de onde descontar (opcional)' },
        descontar_saldo: {
          type: 'BOOLEAN',
          description: 'Se true (padrão), desconta do saldo; se false, marca como pago por fora',
        },
      },
      required: ['lancamento_id'],
    },
  },
  {
    name: 'propor_criar_meta',
    description: 'Propõe criar uma nova meta financeira para confirmação em 1 clique pelo usuário.',
    parameters: {
      type: 'OBJECT',
      properties: {
        titulo: { type: 'STRING', description: 'Nome da meta (ex.: Reserva de emergência)' },
        valor_alvo: { type: 'NUMBER', description: 'Valor objetivo da meta (> 0)' },
        valor_atual: { type: 'NUMBER', description: 'Valor já guardado inicialmente (padrão 0)' },
        prazo: { type: 'STRING', description: 'Data prazo YYYY-MM-DD (opcional)' },
        conta_id: { type: 'INTEGER', description: 'ID da carteira vinculada (opcional)' },
        observacao: { type: 'STRING', description: 'Observação opcional' },
      },
      required: ['titulo', 'valor_alvo'],
    },
  },
  {
    name: 'propor_criar_despesa_fixa',
    description: 'Propõe cadastrar uma nova despesa fixa mensal recorrente para confirmação em 1 clique.',
    parameters: {
      type: 'OBJECT',
      properties: {
        titulo: { type: 'STRING', description: 'Nome da despesa fixa (ex.: Internet, Academia)' },
        valor: { type: 'NUMBER', description: 'Valor mensal (> 0)' },
        dia_vencimento: { type: 'INTEGER', description: 'Dia do vencimento no mês (1 a 31)' },
        categoria: { type: 'STRING', description: 'Categoria (padrão Moradia)' },
        conta_id: { type: 'INTEGER', description: 'ID da carteira vinculada (opcional)' },
      },
      required: ['titulo', 'valor', 'dia_vencimento'],
    },
  },
];

export const FERRAMENTAS_PROPOSTA = new Set([
  'propor_criar_lancamento',
  'propor_marcar_pago',
  'propor_criar_meta',
  'propor_criar_despesa_fixa',
]);

async function calcularSaldosCarteiras(usuarioId, db) {
  const contas = await db.all(
    'SELECT id, nome, etiqueta, rendimento, saldo_ajuste FROM contas WHERE usuario_id = ? ORDER BY id ASC',
    usuarioId
  );
  const lancamentos = await db.all(
    'SELECT conta_id, valor, tipo, status, descontar_saldo FROM lancamentos WHERE usuario_id = ? AND conta_id IS NOT NULL AND status = ?',
    usuarioId,
    'pago'
  );

  const movPorConta = new Map();
  for (const l of lancamentos) {
    const cid = Number(l.conta_id);
    const atual = movPorConta.get(cid) || 0;
    const val = Number(l.valor) || 0;
    if (l.tipo === 'entrada') {
      movPorConta.set(cid, atual + val);
    } else if (l.descontar_saldo !== 0) {
      movPorConta.set(cid, atual - val);
    }
  }

  return contas.map((c) => {
    const saldo =
      Math.round(((Number(c.saldo_ajuste) || 0) + (movPorConta.get(Number(c.id)) || 0)) * 100) /
      100;
    return {
      id: Number(c.id),
      nome: c.nome,
      etiqueta: c.etiqueta || '',
      rendimento: c.rendimento || '',
      saldo,
    };
  });
}

/**
 * Executa uma das 7 ferramentas de leitura, sempre filtrando por usuarioId.
 */
export async function executarFerramentaLeitura(
  nome,
  args = {},
  usuarioId,
  { db = dbPadrao, hojeIso = obterDataBrasilia().dataIso } = {}
) {
  switch (nome) {
    case 'obter_resumo_financeiro': {
      const mes = typeof args.mes === 'string' && /^\d{4}-\d{2}$/.test(args.mes) ? args.mes : null;
      const lancamentos = mes
        ? await db.all(
            'SELECT valor, tipo, status, descontar_saldo FROM lancamentos WHERE usuario_id = ? AND substr(data, 1, 7) = ?',
            usuarioId,
            mes
          )
        : await db.all(
            'SELECT valor, tipo, status, descontar_saldo FROM lancamentos WHERE usuario_id = ?',
            usuarioId
          );

      const resumo = lancamentos.reduce(
        (acc, item) => {
          const val = Number(item.valor) || 0;
          if (item.tipo === 'entrada') {
            if (item.status === 'pago') acc.entradasRecebidas += val;
            else acc.entradasPrevistas += val;
          } else {
            if (item.status === 'pago') {
              if (item.descontar_saldo !== 0) acc.saidasPagas += val;
              else acc.saidasPagasPorFora += val;
            } else {
              acc.saidasAPagar += val;
            }
            if (item.tipo === 'divida' && item.status === 'pendente') {
              acc.dividasPendentes += val;
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

      const salario = await db.get(
        'SELECT valor, dia_pagamento FROM salario_fixo WHERE usuario_id = ?',
        usuarioId
      );
      const fixas = await db.all(
        'SELECT valor FROM despesas_fixas WHERE usuario_id = ? AND ativa = 1',
        usuarioId
      );
      const despesasFixasAtivasTotal = fixas.reduce((s, f) => s + (Number(f.valor) || 0), 0);

      const saldoReal = Math.round((resumo.entradasRecebidas - resumo.saidasPagas) * 100) / 100;
      const saldoPrevisto =
        Math.round(
          (resumo.entradasRecebidas +
            resumo.entradasPrevistas -
            (resumo.saidasPagas + resumo.saidasAPagar)) *
            100
        ) / 100;

      return {
        escopo: mes || 'geral',
        ...resumo,
        saldoReal,
        saldoPrevisto,
        salarioFixo: salario ? { valor: Number(salario.valor), diaPagamento: salario.dia_pagamento } : null,
        despesasFixasAtivasTotal: Math.round(despesasFixasAtivasTotal * 100) / 100,
      };
    }

    case 'listar_carteiras': {
      const carteiras = await calcularSaldosCarteiras(usuarioId, db);
      const saldoTotal = Math.round(carteiras.reduce((s, c) => s + c.saldo, 0) * 100) / 100;
      return { carteiras, saldoTotal };
    }

    case 'listar_lancamentos': {
      const condicoes = ['l.usuario_id = ?'];
      const params = [usuarioId];

      if (typeof args.mes === 'string' && /^\d{4}-\d{2}$/.test(args.mes)) {
        condicoes.push('substr(l.data, 1, 7) = ?');
        params.push(args.mes);
      }
      if (['entrada', 'saida', 'divida'].includes(args.tipo)) {
        condicoes.push('l.tipo = ?');
        params.push(args.tipo);
      }
      if (['pago', 'pendente'].includes(args.status)) {
        condicoes.push('l.status = ?');
        params.push(args.status);
      }

      const limite = Math.max(1, Math.min(50, Math.floor(Number(args.limite) || 25)));
      const buscaLimpa = typeof args.busca === 'string' ? args.busca.trim().toLowerCase() : '';
      if (buscaLimpa) {
        const padrao = `%${buscaLimpa}%`;
        condicoes.push(
          "(LOWER(l.titulo) LIKE ? OR LOWER(l.categoria) LIKE ? OR LOWER(l.origem_divida) LIKE ? OR LOWER(COALESCE(c.nome, '')) LIKE ?)"
        );
        params.push(padrao, padrao, padrao, padrao);
      }

      const rows = await db.all(
        `
          SELECT l.id, l.titulo, l.valor, l.tipo, l.categoria, l.data, l.status,
                 l.origem_divida, l.conta_id, c.nome AS conta_nome
          FROM lancamentos l
          LEFT JOIN contas c ON c.id = l.conta_id AND c.usuario_id = l.usuario_id
          WHERE ${condicoes.join(' AND ')}
          ORDER BY l.data DESC, l.id DESC
          LIMIT ?
        `,
        ...params,
        limite
      );

      return {
        totalEncontrado: rows.length,
        itens: rows.map((r) => ({
          id: Number(r.id),
          titulo: r.titulo,
          valor: Number(r.valor),
          tipo: r.tipo,
          categoria: r.categoria,
          data: r.data,
          status: r.status,
          origemDivida: r.origem_divida || '',
          contaId: r.conta_id ? Number(r.conta_id) : null,
          contaNome: r.conta_nome || null,
        })),
      };
    }

    case 'resumo_dividas_e_cartoes': {
      const mes = typeof args.mes === 'string' && /^\d{4}-\d{2}$/.test(args.mes) ? args.mes : null;
      const rows = mes
        ? await db.all(
            "SELECT id, titulo, valor, data, origem_divida FROM lancamentos WHERE usuario_id = ? AND tipo = 'divida' AND status = 'pendente' AND substr(data, 1, 7) = ? ORDER BY data ASC, id ASC",
            usuarioId,
            mes
          )
        : await db.all(
            "SELECT id, titulo, valor, data, origem_divida FROM lancamentos WHERE usuario_id = ? AND tipo = 'divida' AND status = 'pendente' ORDER BY data ASC, id ASC",
            usuarioId
          );

      const porOrigemMap = new Map();
      let totalPendente = 0;
      for (const r of rows) {
        const val = Number(r.valor) || 0;
        totalPendente += val;
        const origem = (r.origem_divida || '').trim() || 'Sem cartão/origem';
        const atual = porOrigemMap.get(origem) || { origem, total: 0, quantidade: 0 };
        atual.total = Math.round((atual.total + val) * 100) / 100;
        atual.quantidade += 1;
        porOrigemMap.set(origem, atual);
      }

      const porOrigem = Array.from(porOrigemMap.values()).sort((a, b) => b.total - a.total);
      return {
        escopo: mes || 'geral',
        totalPendente: Math.round(totalPendente * 100) / 100,
        quantidadeParcelas: rows.length,
        porOrigem,
        proximosVencimentos: rows.slice(0, 15).map((r) => ({
          id: Number(r.id),
          titulo: r.titulo,
          valor: Number(r.valor),
          data: r.data,
          origem: r.origem_divida || 'Sem cartão/origem',
        })),
      };
    }

    case 'listar_despesas_fixas': {
      const rows = await db.all(
        'SELECT id, titulo, valor, dia_vencimento, categoria, ativa FROM despesas_fixas WHERE usuario_id = ? ORDER BY ativa DESC, dia_vencimento ASC',
        usuarioId
      );
      const totalAtivas = rows
        .filter((r) => Number(r.ativa) === 1)
        .reduce((s, r) => s + (Number(r.valor) || 0), 0);
      return {
        totalAtivas: Math.round(totalAtivas * 100) / 100,
        despesas: rows.map((r) => ({
          id: Number(r.id),
          titulo: r.titulo,
          valor: Number(r.valor),
          diaVencimento: Number(r.dia_vencimento),
          categoria: r.categoria,
          ativa: Number(r.ativa) === 1,
        })),
      };
    }

    case 'listar_metas': {
      const rows = await db.all(
        'SELECT id, titulo, valor_alvo, valor_atual, prazo, conta_id, observacao FROM metas WHERE usuario_id = ? ORDER BY id DESC',
        usuarioId
      );
      const temVinculada = rows.some((m) => m.conta_id !== null && m.conta_id !== undefined);
      const saldoPorConta = new Map();
      if (temVinculada) {
        const carteiras = await calcularSaldosCarteiras(usuarioId, db);
        for (const c of carteiras) saldoPorConta.set(c.id, c);
      }

      return {
        metas: rows.map((m) => {
          const alvo = Number(m.valor_alvo) || 0;
          const contaVinculada =
            m.conta_id !== null && m.conta_id !== undefined
              ? saldoPorConta.get(Number(m.conta_id)) || null
              : null;
          const atual = contaVinculada
            ? Math.max(0, Number(contaVinculada.saldo) || 0)
            : Number(m.valor_atual) || 0;
          const progressoPct = alvo > 0 ? Math.min(100, Math.round((atual / alvo) * 1000) / 10) : 0;
          return {
            id: Number(m.id),
            titulo: m.titulo,
            valorAtual: Math.round(atual * 100) / 100,
            valorAlvo: alvo,
            faltante: Math.max(0, Math.round((alvo - atual) * 100) / 100),
            progressoPct,
            prazo: m.prazo || null,
            contaId: contaVinculada ? contaVinculada.id : null,
            contaNome: contaVinculada ? contaVinculada.nome : null,
            observacao: m.observacao || '',
          };
        }),
      };
    }

    case 'projetar_proximos_meses': {
      const qtdMeses = Math.max(1, Math.min(12, Math.floor(Number(args.meses) || 6)));
      const mesInicial = hojeIso.slice(0, 7);
      const diaHoje = Number(hojeIso.slice(8, 10)) || 1;

      const salario = await db.get(
        'SELECT valor, dia_pagamento FROM salario_fixo WHERE usuario_id = ?',
        usuarioId
      );
      const salarioMensal = salario ? Number(salario.valor) || 0 : 0;
      const diaSalario = salario ? Number(salario.dia_pagamento) || 1 : 1;

      const fixas = await db.all(
        'SELECT titulo, valor, dia_vencimento FROM despesas_fixas WHERE usuario_id = ? AND ativa = 1',
        usuarioId
      );

      const todosLancamentos = await db.all(
        'SELECT titulo, valor, tipo, categoria, status, descontar_saldo, substr(data, 1, 7) AS mes FROM lancamentos WHERE usuario_id = ?',
        usuarioId
      );

      let saldoAcumulado = 0;
      const entradasPorMes = new Map();
      const saidasPorMes = new Map();
      const dividasPorMes = new Map();
      const mesesComSalarioPago = new Set();
      const titulosPorMes = new Map();

      for (const l of todosLancamentos) {
        const val = Number(l.valor) || 0;
        if (!titulosPorMes.has(l.mes)) titulosPorMes.set(l.mes, new Set());
        titulosPorMes.get(l.mes).add(String(l.titulo || '').trim().toLowerCase());

        if (l.status === 'pago') {
          if (l.tipo === 'entrada') {
            saldoAcumulado += val;
            if (String(l.categoria || '').trim().toLowerCase() === 'salário') {
              mesesComSalarioPago.add(l.mes);
            }
          } else if (l.descontar_saldo !== 0) {
            saldoAcumulado -= val;
          }
        } else {
          if (l.tipo === 'entrada') {
            entradasPorMes.set(l.mes, (entradasPorMes.get(l.mes) || 0) + val);
          } else if (l.tipo === 'divida') {
            dividasPorMes.set(l.mes, (dividasPorMes.get(l.mes) || 0) + val);
          } else {
            saidasPorMes.set(l.mes, (saidasPorMes.get(l.mes) || 0) + val);
          }
        }
      }

      saldoAcumulado = Math.round(saldoAcumulado * 100) / 100;
      const saldoInicial = saldoAcumulado;
      const fixasMensaisTotal =
        Math.round(fixas.reduce((s, f) => s + (Number(f.valor) || 0), 0) * 100) / 100;

      const meses = [];
      for (let i = 0; i < qtdMeses; i++) {
        const mes = moverMesIso(mesInicial, i);
        const ehMesAtual = i === 0;
        const titulosMes = titulosPorMes.get(mes) || new Set();

        const incluirSalario =
          salarioMensal > 0 &&
          !mesesComSalarioPago.has(mes) &&
          (!ehMesAtual || diaSalario >= diaHoje);
        const salarioMes = incluirSalario ? salarioMensal : 0;

        let despesasFixasMes = 0;
        for (const f of fixas) {
          const chaveTitulo = String(f.titulo || '').trim().toLowerCase();
          if (titulosMes.has(chaveTitulo)) continue;
          if (ehMesAtual && Number(f.dia_vencimento) < diaHoje) continue;
          despesasFixasMes += Number(f.valor) || 0;
        }
        despesasFixasMes = Math.round(despesasFixasMes * 100) / 100;

        const entradasPrevistas =
          Math.round((salarioMes + (entradasPorMes.get(mes) || 0)) * 100) / 100;
        const dividasMes = Math.round((dividasPorMes.get(mes) || 0) * 100) / 100;
        const outrasSaidas = Math.round((saidasPorMes.get(mes) || 0) * 100) / 100;
        const totalCompromissos =
          Math.round((despesasFixasMes + dividasMes + outrasSaidas) * 100) / 100;
        const sobraPrevista = Math.round((entradasPrevistas - totalCompromissos) * 100) / 100;
        saldoAcumulado = Math.round((saldoAcumulado + sobraPrevista) * 100) / 100;

        meses.push({
          mes,
          entradasPrevistas,
          despesasFixas: despesasFixasMes,
          dividasPendentes: dividasMes,
          outrasSaidasPendentes: outrasSaidas,
          totalCompromissos,
          sobraPrevista,
          saldoAcumulado,
        });
      }

      return {
        saldoInicial,
        salarioMensal,
        despesasFixasMensais: fixasMensaisTotal,
        meses,
      };
    }

    default:
      throw criarErroHttp(400, `Ferramenta desconhecida: ${nome}`);
  }
}

/**
 * Cria uma proposta de ação pendente no banco (NUNCA altera tabelas financeiras reais).
 */
export async function criarPropostaAcao(
  nome,
  args = {},
  usuarioId,
  { db = dbPadrao, hojeIso = obterDataBrasilia().dataIso } = {}
) {
  let tipoAcao;
  let payload;
  let resumo;

  if (nome === 'propor_criar_lancamento') {
    const titulo = validarTextoCurto(args.titulo, MAX_TITULO, 'O título');
    const valorArredondado = validarValorPositivoSeguro(args.valor);
    const tipo = String(args.tipo || '').trim();
    if (!titulo) throw criarErroHttp(400, 'Informe um título para o lançamento.');
    if (!['entrada', 'saida', 'divida'].includes(tipo)) {
      throw criarErroHttp(400, 'Tipo inválido. Use entrada, saida ou divida.');
    }

    const data =
      typeof args.data === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(args.data)
        ? args.data
        : hojeIso;
    const statusPadrao = tipo === 'divida' ? 'pendente' : 'pago';
    const status = ['pago', 'pendente'].includes(args.status) ? args.status : statusPadrao;
    const categoria = validarTextoCurto(args.categoria, MAX_CATEGORIA, 'A categoria') || 'Geral';
    const observacao = validarTextoCurto(args.observacao, MAX_OBSERVACAO, 'A observação');
    const origemDivida =
      tipo === 'divida' ? validarTextoCurto(args.origem_divida, MAX_ORIGEM, 'A origem da dívida') : '';
    const parcelas =
      tipo === 'divida' ? Math.max(1, Math.min(60, Math.floor(Number(args.parcelas) || 1))) : 1;
    if (parcelas > 1 && !['total', 'parcela'].includes(args.modo_valor_parcela)) {
      throw criarErroHttp(
        400,
        'Para compras parceladas, informe modo_valor_parcela ("total" ou "parcela").'
      );
    }
    const modoValorParcela = parcelas > 1 ? args.modo_valor_parcela : 'total';

    const conta = await resolverContaDoUsuario(args.conta_id, usuarioId, db);
    const contaId = conta ? Number(conta.id) : null;

    tipoAcao = 'criar_lancamento';
    payload = {
      titulo,
      valor: valorArredondado,
      tipo,
      categoria,
      data,
      status,
      observacao,
      parcelas,
      modo_valor_parcela: modoValorParcela,
      conta_id: contaId,
      conta_nome: conta ? conta.nome : null,
      origem_divida: origemDivida,
    };

    const tipoLabel =
      tipo === 'entrada' ? 'Entrada' : tipo === 'divida' ? 'Dívida' : 'Saída';
    const statusLabel = status === 'pago' ? 'Pago' : 'Pendente';

    let textoValor;
    if (parcelas > 1) {
      if (modoValorParcela === 'total') {
        const valorParcela = Math.floor((payload.valor / parcelas) * 100) / 100;
        textoValor = `${parcelas}x de ${formatarMoedaBr(valorParcela)} (Total: ${formatarMoedaBr(payload.valor)})`;
      } else {
        const totalCalc = Math.round(payload.valor * parcelas * 100) / 100;
        textoValor = `${parcelas}x de ${formatarMoedaBr(payload.valor)} (Total: ${formatarMoedaBr(totalCalc)})`;
      }
    } else {
      textoValor = formatarMoedaBr(payload.valor);
    }

    const extras = [];
    if (conta) extras.push(`Carteira: ${conta.nome}`);
    if (origemDivida) extras.push(`Cartão/Origem: ${origemDivida}`);
    extras.push(`Data: ${formatarDataBr(data)}`);

    resumo = `${titulo} — ${textoValor} · ${tipoLabel} · ${statusLabel} (${extras.join(' · ')})`;
  } else if (nome === 'propor_marcar_pago') {
    const lancamentoId = Number(args.lancamento_id);
    if (!Number.isInteger(lancamentoId) || lancamentoId <= 0) {
      throw criarErroHttp(400, 'ID do lançamento inválido.');
    }

    const lancamento = await db.get(
      'SELECT id, titulo, valor, tipo, status, data FROM lancamentos WHERE id = ? AND usuario_id = ?',
      lancamentoId,
      usuarioId
    );
    if (!lancamento) {
      throw criarErroHttp(404, 'Lançamento não encontrado para este usuário.');
    }
    if (lancamento.status === 'pago') {
      throw criarErroHttp(409, 'Este lançamento já está marcado como pago.');
    }

    const descontarSaldo = args.descontar_saldo === false ? false : true;
    const conta = descontarSaldo
      ? await resolverContaDoUsuario(args.conta_id, usuarioId, db)
      : null;

    tipoAcao = 'marcar_pago';
    payload = {
      lancamento_id: Number(lancamento.id),
      titulo: lancamento.titulo,
      valor: Number(lancamento.valor),
      descontar_saldo: descontarSaldo,
      conta_id: conta ? Number(conta.id) : null,
      conta_nome: conta ? conta.nome : null,
    };

    const detalheConta = conta
      ? ` · Carteira: ${conta.nome}`
      : descontarSaldo
        ? ''
        : ' · Pago por fora do saldo';
    resumo = `Marcar como pago: ${lancamento.titulo} (${formatarMoedaBr(lancamento.valor)} · venc. ${formatarDataBr(lancamento.data)}${detalheConta})`;
  } else if (nome === 'propor_criar_meta') {
    const titulo = validarTextoCurto(args.titulo, MAX_TITULO, 'O título da meta');
    const valorAlvo = validarValorPositivoSeguro(
      args.valor_alvo,
      'Informe um valor alvo maior que zero.'
    );
    const valorAtual = args.valor_atual !== undefined ? Number(args.valor_atual) : 0;
    if (!titulo) throw criarErroHttp(400, 'Informe um título para a meta.');
    if (!Number.isFinite(valorAtual) || valorAtual < 0 || valorAtual > MAX_VALOR_FINANCEIRO) {
      throw criarErroHttp(400, 'O valor atual da meta é inválido.');
    }
    const prazo =
      typeof args.prazo === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(args.prazo)
        ? args.prazo
        : null;
    const observacao = validarTextoCurto(args.observacao, MAX_OBSERVACAO, 'A observação');
    const conta = await resolverContaDoUsuario(args.conta_id, usuarioId, db);

    tipoAcao = 'criar_meta';
    payload = {
      titulo,
      valor_alvo: valorAlvo,
      valor_atual: Math.round(valorAtual * 100) / 100,
      prazo,
      conta_id: conta ? Number(conta.id) : null,
      conta_nome: conta ? conta.nome : null,
      observacao,
    };

    resumo = `Nova meta: ${titulo} — Alvo ${formatarMoedaBr(payload.valor_alvo)}${prazo ? ` · Prazo ${formatarDataBr(prazo)}` : ''}`;
  } else if (nome === 'propor_criar_despesa_fixa') {
    const titulo = validarTextoCurto(args.titulo, MAX_TITULO, 'O título da despesa fixa');
    const valor = validarValorPositivoSeguro(args.valor, 'Informe um valor mensal maior que zero.');
    const diaVencimento = Math.floor(Number(args.dia_vencimento));
    if (!titulo) throw criarErroHttp(400, 'Informe um título para a despesa fixa.');
    if (!Number.isInteger(diaVencimento) || diaVencimento < 1 || diaVencimento > 31) {
      throw criarErroHttp(400, 'Informe um dia de vencimento entre 1 e 31.');
    }
    const categoria = validarTextoCurto(args.categoria, MAX_CATEGORIA, 'A categoria') || 'Moradia';
    const conta = await resolverContaDoUsuario(args.conta_id, usuarioId, db);

    tipoAcao = 'criar_despesa_fixa';
    payload = {
      titulo,
      valor,
      dia_vencimento: diaVencimento,
      categoria,
      conta_id: conta ? Number(conta.id) : null,
      conta_nome: conta ? conta.nome : null,
    };

    resumo = `Nova despesa fixa: ${titulo} — ${formatarMoedaBr(payload.valor)}/mês · Todo dia ${diaVencimento} (${categoria})`;
  } else {
    throw criarErroHttp(400, `Ferramenta de proposta desconhecida: ${nome}`);
  }

  const novoId = await db.insert(
    `INSERT INTO agente_acoes_pendentes (usuario_id, tipo_acao, resumo, payload_json, status)
     VALUES (?, ?, ?, ?, 'pendente')`,
    usuarioId,
    tipoAcao,
    resumo,
    JSON.stringify(payload)
  );

  const row = await db.get('SELECT * FROM agente_acoes_pendentes WHERE id = ?', novoId);
  const acao = serializarAcao(row);

  return {
    acao,
    resumoParaModelo: {
      propostaCriada: true,
      acaoId: acao.id,
      status: 'aguardando_confirmacao_usuario',
      resumo: acao.resumo,
    },
  };
}

/**
 * Confirma e executa uma ação pendente dentro de transação SQL.
 * Protege contra IDOR (usuario_id), expiração (> 24h) e duplo clique (UPDATE condicional status = 'pendente').
 */
export async function confirmarAcaoPendente(
  acaoId,
  usuarioId,
  { db = dbPadrao, agoraMs = Date.now() } = {}
) {
  const id = Number(acaoId);
  if (!Number.isInteger(id) || id <= 0) {
    throw criarErroHttp(400, 'ID de ação inválido.');
  }

  const retorno = await db.transaction(async (tx) => {
    const existente = await tx.get(
      'SELECT * FROM agente_acoes_pendentes WHERE id = ? AND usuario_id = ?',
      id,
      usuarioId
    );
    if (!existente) {
      throw criarErroHttp(404, 'Ação não encontrada.');
    }
    if (existente.status !== 'pendente') {
      throw criarErroHttp(409, `Esta ação já foi ${existente.status}.`);
    }

    const criadoMs = parseTimestampMs(existente.criado_em);
    if (criadoMs !== null && agoraMs - criadoMs > PRAZO_EXPIRACAO_ACAO_MS) {
      await tx.run(
        "UPDATE agente_acoes_pendentes SET status = 'cancelada', resolvido_em = ? WHERE id = ? AND usuario_id = ? AND status = 'pendente'",
        new Date(agoraMs).toISOString(),
        id,
        usuarioId
      );
      return { expirada: true };
    }

    const agoraIso = new Date(agoraMs).toISOString();
    const lock = await tx.run(
      "UPDATE agente_acoes_pendentes SET status = 'confirmada', resolvido_em = ? WHERE id = ? AND usuario_id = ? AND status = 'pendente'",
      agoraIso,
      id,
      usuarioId
    );
    if (lock.changes === 0) {
      throw criarErroHttp(409, 'Esta ação já foi processada.');
    }

    const payload = JSON.parse(existente.payload_json || '{}');
    let resultado = {};

    if (existente.tipo_acao === 'criar_lancamento') {
      const contaValida = await resolverContaDoUsuario(payload.conta_id, usuarioId, tx);
      const contaIdFinal = contaValida ? Number(contaValida.id) : null;
      const totalParcelas =
        payload.tipo === 'divida'
          ? Math.max(1, Math.min(60, Math.floor(Number(payload.parcelas) || 1)))
          : 1;

      const insertSql = `
        INSERT INTO lancamentos (
          usuario_id, titulo, valor, tipo, categoria, data, status,
          observacao, grupo_parcela, conta_id, origem_divida
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      if (totalParcelas > 1) {
        const grupoId = crypto.randomUUID();
        const dividirTotal = payload.modo_valor_parcela === 'total';
        const valorNumero = Number(payload.valor);
        const valorBase = dividirTotal
          ? Math.floor((valorNumero / totalParcelas) * 100) / 100
          : Math.round(valorNumero * 100) / 100;
        const diferencaCentavos = dividirTotal
          ? Math.round((valorNumero - valorBase * totalParcelas) * 100) / 100
          : 0;

        const idsCriados = [];
        for (let i = 0; i < totalParcelas; i++) {
          const dataParcela = somarMesesSeguro(payload.data, i);
          const tituloParcela = `${payload.titulo} (${i + 1}/${totalParcelas})`;
          const valorParcela =
            i === totalParcelas - 1
              ? Math.round((valorBase + diferencaCentavos) * 100) / 100
              : valorBase;

          const novoLancId = await tx.insert(
            insertSql,
            usuarioId,
            tituloParcela,
            valorParcela,
            payload.tipo,
            payload.categoria || 'Geral',
            dataParcela,
            payload.status || 'pendente',
            payload.observacao || '',
            grupoId,
            contaIdFinal,
            payload.origem_divida || ''
          );
          idsCriados.push(novoLancId);
        }

        resultado = {
          tipo: 'criar_lancamento',
          parcelasCriadas: idsCriados.length,
          grupoParcela: grupoId,
          ids: idsCriados,
        };
      } else {
        const novoLancId = await tx.insert(
          insertSql,
          usuarioId,
          payload.titulo,
          Number(payload.valor),
          payload.tipo,
          payload.categoria || 'Geral',
          payload.data,
          payload.status || 'pago',
          payload.observacao || '',
          null,
          contaIdFinal,
          payload.origem_divida || ''
        );
        resultado = { tipo: 'criar_lancamento', lancamentoId: novoLancId };
      }
    } else if (existente.tipo_acao === 'marcar_pago') {
      const descontarDb = payload.descontar_saldo === false ? 0 : 1;
      const contaValida =
        descontarDb === 1 ? await resolverContaDoUsuario(payload.conta_id, usuarioId, tx) : null;
      const contaIdFinal = contaValida ? Number(contaValida.id) : null;

      let upd;
      if (descontarDb === 0 || (payload.conta_id !== undefined && payload.conta_id !== null)) {
        upd = await tx.run(
          "UPDATE lancamentos SET status = 'pago', descontar_saldo = ?, conta_id = ? WHERE id = ? AND usuario_id = ?",
          descontarDb,
          contaIdFinal,
          payload.lancamento_id,
          usuarioId
        );
      } else {
        upd = await tx.run(
          "UPDATE lancamentos SET status = 'pago', descontar_saldo = ? WHERE id = ? AND usuario_id = ?",
          descontarDb,
          payload.lancamento_id,
          usuarioId
        );
      }

      if (upd.changes === 0) {
        throw criarErroHttp(404, 'O lançamento não existe mais.');
      }
      resultado = { tipo: 'marcar_pago', lancamentoId: payload.lancamento_id };
    } else if (existente.tipo_acao === 'criar_meta') {
      const contaValida = await resolverContaDoUsuario(payload.conta_id, usuarioId, tx);
      const novaMetaId = await tx.insert(
        `INSERT INTO metas (usuario_id, titulo, valor_alvo, valor_atual, prazo, conta_id, observacao)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        usuarioId,
        payload.titulo,
        Number(payload.valor_alvo),
        Number(payload.valor_atual) || 0,
        payload.prazo || null,
        contaValida ? Number(contaValida.id) : null,
        payload.observacao || ''
      );
      resultado = { tipo: 'criar_meta', metaId: novaMetaId };
    } else if (existente.tipo_acao === 'criar_despesa_fixa') {
      const contaValida = await resolverContaDoUsuario(payload.conta_id, usuarioId, tx);
      const novaFixaId = await tx.insert(
        `INSERT INTO despesas_fixas (usuario_id, titulo, valor, dia_vencimento, categoria, conta_id, ativa)
         VALUES (?, ?, ?, ?, ?, ?, 1)`,
        usuarioId,
        payload.titulo,
        Number(payload.valor),
        Number(payload.dia_vencimento),
        payload.categoria || 'Moradia',
        contaValida ? Number(contaValida.id) : null
      );
      resultado = { tipo: 'criar_despesa_fixa', despesaFixaId: novaFixaId };
    } else {
      throw criarErroHttp(400, 'Tipo de ação não suportado.');
    }

    await tx.run(
      'UPDATE agente_acoes_pendentes SET resultado_json = ? WHERE id = ?',
      JSON.stringify(resultado),
      id
    );

    const atualizada = await tx.get('SELECT * FROM agente_acoes_pendentes WHERE id = ?', id);
    return { expirada: false, acao: serializarAcao(atualizada), resultado };
  });

  if (retorno.expirada) {
    throw criarErroHttp(
      410,
      'Esta proposta expirou (mais de 24h). Peça ao assistente para preparar novamente.'
    );
  }

  return { acao: retorno.acao, resultado: retorno.resultado };
}

/**
 * Cancela uma ação pendente do usuário.
 */
export async function cancelarAcaoPendente(acaoId, usuarioId, { db = dbPadrao } = {}) {
  const id = Number(acaoId);
  if (!Number.isInteger(id) || id <= 0) {
    throw criarErroHttp(400, 'ID de ação inválido.');
  }

  const existente = await db.get(
    'SELECT * FROM agente_acoes_pendentes WHERE id = ? AND usuario_id = ?',
    id,
    usuarioId
  );
  if (!existente) {
    throw criarErroHttp(404, 'Ação não encontrada.');
  }
  if (existente.status !== 'pendente') {
    throw criarErroHttp(409, `Esta ação já foi ${existente.status}.`);
  }

  const upd = await db.run(
    "UPDATE agente_acoes_pendentes SET status = 'cancelada', resolvido_em = ? WHERE id = ? AND usuario_id = ? AND status = 'pendente'",
    new Date().toISOString(),
    id,
    usuarioId
  );
  if (upd.changes === 0) {
    throw criarErroHttp(409, 'Esta ação já foi processada.');
  }

  const atualizada = await db.get('SELECT * FROM agente_acoes_pendentes WHERE id = ?', id);
  return { acao: serializarAcao(atualizada) };
}

export { serializarAcao };
