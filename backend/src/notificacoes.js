import { enviarLembreteVencimento, enviarResumoMensal } from './email.js';

const NOMES_MESES = [
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

export const CONFIG_NOTIFICACAO_PADRAO = {
  ativo: true,
  lembreteDia: true,
  lembreteVespera: false,
  resumoMensal: true,
  diasAntesSalario: 1,
};

/**
 * Retorna a data atual no fuso oficial de Brasília (America/Sao_Paulo),
 * garantindo que servidores em UTC (como Render) disparem sempre no dia certo do Brasil.
 */
export function obterDataBrasilia(dataBase = new Date()) {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(dataBase);

  const mapa = Object.fromEntries(partes.map((p) => [p.type, p.value]));
  const ano = Number(mapa.year);
  const mes = Number(mapa.month);
  const dia = Number(mapa.day);
  const mesRef = `${mapa.year}-${mapa.month}`;
  const dataIso = `${mesRef}-${mapa.day}`;

  return { ano, mes, dia, dataIso, mesRef };
}

/**
 * Soma ou subtrai dias de uma data ISO YYYY-MM-DD sem risco de bug de fuso/horário de verão.
 */
export function somarDiasIso(dataIso, dias) {
  const [ano, mes, dia] = dataIso.split('-').map(Number);
  const dt = new Date(Date.UTC(ano, mes - 1, dia, 12, 0, 0));
  dt.setUTCDate(dt.getUTCDate() + dias);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Ajusta dias como 29/30/31 para o último dia real do mês (ex.: dia 31 em fevereiro -> 28).
 */
export function diaEfetivoNoMes(ano, mes, diaAlvo) {
  const ultimoDia = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return Math.max(1, Math.min(Number(diaAlvo) || 1, ultimoDia));
}

export function formatarNomeMes(mesRef) {
  const [anoStr, mesStr] = String(mesRef).split('-');
  const idx = Number(mesStr) - 1;
  const nome = NOMES_MESES[idx] || mesRef;
  return `${nome} de ${anoStr}`;
}

function avancarMes(ano, mes, delta) {
  const total = ano * 12 + (mes - 1) + delta;
  return {
    ano: Math.floor(total / 12),
    mes: (total % 12) + 1,
  };
}

function montarMesRef(ano, mes) {
  return `${ano}-${String(mes).padStart(2, '0')}`;
}

function montarDataIso(ano, mes, dia) {
  return `${montarMesRef(ano, mes)}-${String(dia).padStart(2, '0')}`;
}

/**
 * Calcula a data exata de disparo do resumo mensal para um determinado mês de referência.
 *
 * Regras intuitivas:
 * - Sem salário cadastrado: dispara sempre no dia 1 do próprio mês.
 * - Salário entre os dias 1 e 24: dispara `diasAntes` dias antes do salário cair naquele mês
 *   (ex.: salário dia 5, 1 dia antes -> dispara dia 04 do mês; salário dia 1, 1 dia antes -> último dia do mês anterior).
 * - Salário entre os dias 25 e 31 (fim do mês para pagar o mês seguinte): dispara `diasAntes`
 *   dias antes do salário no mês anterior ao mês resumido (ex.: salário dia 30 -> dia 29/11 resume Dezembro).
 */
export function calcularDataDisparoParaMesResumo({
  anoResumo,
  mesResumo,
  diaPagamento = null,
  diasAntes = 1,
}) {
  const diasAntesSeguro = Math.max(0, Math.min(5, Number(diasAntes) || 0));

  if (!diaPagamento) {
    return montarDataIso(anoResumo, mesResumo, 1);
  }

  const diaPagNum = Math.max(1, Math.min(31, Number(diaPagamento)));

  if (diaPagNum >= 25) {
    const anterior = avancarMes(anoResumo, mesResumo, -1);
    const diaReal = diaEfetivoNoMes(anterior.ano, anterior.mes, diaPagNum);
    return somarDiasIso(montarDataIso(anterior.ano, anterior.mes, diaReal), -diasAntesSeguro);
  }

  const diaReal = diaEfetivoNoMes(anoResumo, mesResumo, diaPagNum);
  return somarDiasIso(montarDataIso(anoResumo, mesResumo, diaReal), -diasAntesSeguro);
}

/**
 * Verifica se `hojeIso` é o dia de disparar o resumo mensal de algum mês (mês atual ou próximo).
 * Retorna `{ mesRef, nomeMes }` se hoje for o dia certo, ou `null` caso contrário.
 */
export function detectarResumoMensalParaHoje({ hojeIso, diaPagamento = null, diasAntes = 1 }) {
  const [anoAtual, mesAtual] = hojeIso.split('-').map(Number);
  const candidatos = [
    { ano: anoAtual, mes: mesAtual },
    avancarMes(anoAtual, mesAtual, 1),
  ];

  for (const cand of candidatos) {
    const dataDisparo = calcularDataDisparoParaMesResumo({
      anoResumo: cand.ano,
      mesResumo: cand.mes,
      diaPagamento,
      diasAntes,
    });

    if (dataDisparo === hojeIso) {
      const mesRef = montarMesRef(cand.ano, cand.mes);
      return {
        mesRef,
        nomeMes: formatarNomeMes(mesRef),
        dataDisparoIso: dataDisparo,
      };
    }
  }

  return null;
}

/**
 * Calcula qual será a próxima data em que o resumo mensal vai ser disparado (para exibir em "Minha conta").
 */
export function calcularProximoDisparoResumo({ hojeIso, diaPagamento = null, diasAntes = 1 }) {
  const [anoAtual, mesAtual] = hojeIso.split('-').map(Number);

  for (let offset = 0; offset <= 2; offset += 1) {
    const cand = avancarMes(anoAtual, mesAtual, offset);
    const dataDisparo = calcularDataDisparoParaMesResumo({
      anoResumo: cand.ano,
      mesResumo: cand.mes,
      diaPagamento,
      diasAntes,
    });

    if (dataDisparo >= hojeIso) {
      const mesRef = montarMesRef(cand.ano, cand.mes);
      return {
        dataDisparoIso: dataDisparo,
        mesRef,
        nomeMes: formatarNomeMes(mesRef),
      };
    }
  }

  return null;
}

function normalizarTituloComparacao(titulo) {
  return String(titulo || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/**
 * Busca todas as contas pendentes (dívidas/saídas pendentes + despesas fixas ativas)
 * que vencem em uma data específica YYYY-MM-DD.
 */
export async function coletarContasDoDia(db, usuarioId, dataIso) {
  const [ano, mes, dia] = dataIso.split('-').map(Number);
  const mesRef = montarMesRef(ano, mes);

  const lancamentosDia = await db.all(
    `
      SELECT id, titulo, valor, tipo, categoria, data, origem_divida
      FROM lancamentos
      WHERE usuario_id = ?
        AND status = 'pendente'
        AND tipo IN ('divida', 'saida')
        AND data = ?
      ORDER BY valor DESC, id ASC
    `,
    usuarioId,
    dataIso
  );

  const despesasFixas = await db.all(
    `
      SELECT id, titulo, valor, dia_vencimento, categoria
      FROM despesas_fixas
      WHERE usuario_id = ? AND ativa = 1
      ORDER BY valor DESC, id ASC
    `,
    usuarioId
  );

  const despesasDoDia = despesasFixas.filter(
    (d) => diaEfetivoNoMes(ano, mes, d.dia_vencimento) === dia
  );

  const itens = lancamentosDia.map((l) => ({
    titulo: l.titulo,
    valor: Number(l.valor),
    data: l.data,
    categoria: l.categoria,
    origem: l.origem_divida || '',
    fonte: l.tipo,
  }));

  if (despesasDoDia.length > 0) {
    // Só consulta títulos do mês quando realmente há despesa fixa vencendo hoje
    const lancamentosDoMes = await db.all(
      `
        SELECT titulo
        FROM lancamentos
        WHERE usuario_id = ?
          AND tipo IN ('divida', 'saida')
          AND data LIKE ?
      `,
      usuarioId,
      `${mesRef}-%`
    );
    const titulosJaLancados = new Set(
      lancamentosDoMes.map((l) => normalizarTituloComparacao(l.titulo))
    );

    for (const d of despesasDoDia) {
      if (titulosJaLancados.has(normalizarTituloComparacao(d.titulo))) continue;

      itens.push({
        titulo: d.titulo,
        valor: Number(d.valor),
        data: dataIso,
        categoria: d.categoria,
        origem: '',
        fonte: 'despesa_fixa',
      });
    }
  }

  const total = itens.reduce((acc, item) => acc + item.valor, 0);
  return { itens, total };
}

/**
 * Busca todas as contas previstas (dívidas/saídas pendentes + despesas fixas ativas)
 * de um mês específico YYYY-MM, ordenadas cronologicamente por data.
 */
export async function coletarResumoDoMes(db, usuarioId, mesRef) {
  const [ano, mes] = mesRef.split('-').map(Number);

  const lancamentosPendentes = await db.all(
    `
      SELECT id, titulo, valor, tipo, categoria, data, origem_divida
      FROM lancamentos
      WHERE usuario_id = ?
        AND status = 'pendente'
        AND tipo IN ('divida', 'saida')
        AND data LIKE ?
      ORDER BY data ASC, valor DESC, id ASC
    `,
    usuarioId,
    `${mesRef}-%`
  );

  const despesasFixas = await db.all(
    `
      SELECT id, titulo, valor, dia_vencimento, categoria
      FROM despesas_fixas
      WHERE usuario_id = ? AND ativa = 1
      ORDER BY dia_vencimento ASC, valor DESC
    `,
    usuarioId
  );

  const salario = await db.get(
    'SELECT valor, dia_pagamento FROM salario_fixo WHERE usuario_id = ?',
    usuarioId
  );

  const itens = lancamentosPendentes.map((l) => ({
    titulo: l.titulo,
    valor: Number(l.valor),
    data: l.data,
    categoria: l.categoria,
    origem: l.origem_divida || '',
    fonte: l.tipo,
  }));

  if (despesasFixas.length > 0) {
    const todosLancamentosSaidaMes = await db.all(
      `
        SELECT titulo
        FROM lancamentos
        WHERE usuario_id = ?
          AND tipo IN ('divida', 'saida')
          AND data LIKE ?
      `,
      usuarioId,
      `${mesRef}-%`
    );
    const titulosJaLancados = new Set(
      todosLancamentosSaidaMes.map((l) => normalizarTituloComparacao(l.titulo))
    );

    for (const d of despesasFixas) {
      if (titulosJaLancados.has(normalizarTituloComparacao(d.titulo))) continue;
      const diaReal = diaEfetivoNoMes(ano, mes, d.dia_vencimento);
      itens.push({
        titulo: d.titulo,
        valor: Number(d.valor),
        data: montarDataIso(ano, mes, diaReal),
        categoria: d.categoria,
        origem: '',
        fonte: 'despesa_fixa',
      });
    }
  }

  itens.sort((a, b) => a.data.localeCompare(b.data) || b.valor - a.valor);
  const totalMes = itens.reduce((acc, item) => acc + item.valor, 0);

  return {
    mesRef,
    nomeMes: formatarNomeMes(mesRef),
    diaSalario: salario ? Number(salario.dia_pagamento) : null,
    salarioValor: salario ? Number(salario.valor) : null,
    itens,
    totalMes,
  };
}

export async function obterConfigNotificacaoUsuario(db, usuarioId) {
  const row = await db.get(
    `
      SELECT ativo, lembrete_dia, lembrete_vespera, resumo_mensal, dias_antes_salario
      FROM notificacoes_config
      WHERE usuario_id = ?
    `,
    usuarioId
  );

  if (!row) {
    return { ...CONFIG_NOTIFICACAO_PADRAO };
  }

  return {
    ativo: Boolean(row.ativo),
    lembreteDia: Boolean(row.lembrete_dia),
    lembreteVespera: Boolean(row.lembrete_vespera),
    resumoMensal: Boolean(row.resumo_mensal),
    diasAntesSalario: Number(row.dias_antes_salario ?? 1),
  };
}

async function jaFoiEnviado(db, usuarioId, tipo, chaveReferencia) {
  const registro = await db.get(
    `
      SELECT id FROM notificacoes_enviadas
      WHERE usuario_id = ? AND tipo = ? AND chave_referencia = ?
    `,
    usuarioId,
    tipo,
    chaveReferencia
  );
  return Boolean(registro);
}

async function registrarEnvio(db, usuarioId, tipo, chaveReferencia) {
  await db.run(
    `
      INSERT INTO notificacoes_enviadas (usuario_id, tipo, chave_referencia)
      VALUES (?, ?, ?)
    `,
    usuarioId,
    tipo,
    chaveReferencia
  );
}

/**
 * Rotina principal acionada diariamente (ex.: às 08h BRT via GitHub Actions).
 * Avalia todos os usuários ativos e dispara sem duplicidade:
 *  1) Lembrete das contas que vencem hoje
 *  2) Lembrete das contas que vencem amanhã (se o usuário ativou)
 *  3) Resumo mensal perto do dia do salário cadastrado (ou dia 1)
 */
export async function executarRotinaNotificacoes({
  db,
  dataBase = new Date(),
  appUrl = '',
  enviarLembreteFn = enviarLembreteVencimento,
  enviarResumoFn = enviarResumoMensal,
}) {
  const hoje = obterDataBrasilia(dataBase);
  const amanhaIso = somarDiasIso(hoje.dataIso, 1);

  const usuarios = await db.all(`
    SELECT
      u.id,
      u.nome,
      u.email,
      COALESCE(nc.ativo, 1) AS ativo,
      COALESCE(nc.lembrete_dia, 1) AS lembrete_dia,
      COALESCE(nc.lembrete_vespera, 0) AS lembrete_vespera,
      COALESCE(nc.resumo_mensal, 1) AS resumo_mensal,
      COALESCE(nc.dias_antes_salario, 1) AS dias_antes_salario,
      sf.dia_pagamento AS dia_pagamento
    FROM usuarios u
    LEFT JOIN notificacoes_config nc ON nc.usuario_id = u.id
    LEFT JOIN salario_fixo sf ON sf.usuario_id = u.id
    ORDER BY u.id ASC
  `);

  const resultado = {
    dataBrasilia: hoje.dataIso,
    usuariosAvaliados: usuarios.length,
    enviados: {
      vencimentoHoje: 0,
      vencimentoAmanha: 0,
      resumoMensal: 0,
    },
    erros: 0,
  };

  for (const u of usuarios) {
    if (!Number(u.ativo)) continue;

    // 1. Lembrete de contas que vencem HOJE
    if (Number(u.lembrete_dia)) {
      try {
        const enviado = await jaFoiEnviado(db, u.id, 'vencimento_hoje', hoje.dataIso);
        if (!enviado) {
          const { itens, total } = await coletarContasDoDia(db, u.id, hoje.dataIso);
          if (itens.length > 0) {
            await enviarLembreteFn({
              para: u.email,
              nome: u.nome,
              dataIso: hoje.dataIso,
              ehAmanha: false,
              itens,
              total,
              appUrl,
            });
            await registrarEnvio(db, u.id, 'vencimento_hoje', hoje.dataIso);
            resultado.enviados.vencimentoHoje += 1;
          }
        }
      } catch (err) {
        resultado.erros += 1;
        console.error(`[Notificações] Erro vencimento_hoje usuário ${u.id}:`, err.message);
      }
    }

    // 2. Lembrete de contas que vencem AMANHÃ (opcional)
    if (Number(u.lembrete_vespera)) {
      try {
        const enviado = await jaFoiEnviado(db, u.id, 'vencimento_amanha', amanhaIso);
        if (!enviado) {
          const { itens, total } = await coletarContasDoDia(db, u.id, amanhaIso);
          if (itens.length > 0) {
            await enviarLembreteFn({
              para: u.email,
              nome: u.nome,
              dataIso: amanhaIso,
              ehAmanha: true,
              itens,
              total,
              appUrl,
            });
            await registrarEnvio(db, u.id, 'vencimento_amanha', amanhaIso);
            resultado.enviados.vencimentoAmanha += 1;
          }
        }
      } catch (err) {
        resultado.erros += 1;
        console.error(`[Notificações] Erro vencimento_amanha usuário ${u.id}:`, err.message);
      }
    }

    // 3. Resumo mensal perto do salário (ou dia 1)
    if (Number(u.resumo_mensal)) {
      try {
        const alvoResumo = detectarResumoMensalParaHoje({
          hojeIso: hoje.dataIso,
          diaPagamento: u.dia_pagamento ? Number(u.dia_pagamento) : null,
          diasAntes: Number(u.dias_antes_salario ?? 1),
        });

        if (alvoResumo) {
          const enviado = await jaFoiEnviado(db, u.id, 'resumo_mensal', alvoResumo.mesRef);
          if (!enviado) {
            const resumo = await coletarResumoDoMes(db, u.id, alvoResumo.mesRef);
            if (resumo.itens.length > 0) {
              await enviarResumoFn({
                para: u.email,
                nome: u.nome,
                nomeMes: resumo.nomeMes,
                diaSalario: resumo.diaSalario,
                salarioValor: resumo.salarioValor,
                itens: resumo.itens,
                totalMes: resumo.totalMes,
                appUrl,
              });
              await registrarEnvio(db, u.id, 'resumo_mensal', alvoResumo.mesRef);
              resultado.enviados.resumoMensal += 1;
            }
          }
        }
      } catch (err) {
        resultado.erros += 1;
        console.error(`[Notificações] Erro resumo_mensal usuário ${u.id}:`, err.message);
      }
    }
  }

  return resultado;
}
