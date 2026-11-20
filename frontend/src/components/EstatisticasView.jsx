import { useMemo, useState } from 'react';

const NOMES_MESES_CURTOS = [
  'Jan',
  'Fev',
  'Mar',
  'Abr',
  'Mai',
  'Jun',
  'Jul',
  'Ago',
  'Set',
  'Out',
  'Nov',
  'Dez',
];

const NOMES_MESES_COMPLETOS = [
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

function formatarMoeda(valor) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(valor || 0);
}

function formatarMoedaCurta(valor) {
  const abs = Math.abs(valor || 0);
  const sinal = valor < 0 ? '-' : '';
  if (abs >= 1000) {
    return `${sinal}R$ ${(abs / 1000).toFixed(1).replace('.', ',')}k`;
  }
  return `${sinal}R$ ${Math.round(abs)}`;
}

function somarMesIso(anoBase, mesBase1a12, delta) {
  const total = anoBase * 12 + (mesBase1a12 - 1) + delta;
  const ano = Math.floor(total / 12);
  const mes = (total % 12) + 1;
  return {
    iso: `${ano}-${String(mes).padStart(2, '0')}`,
    curto: `${NOMES_MESES_CURTOS[mes - 1]}/${String(ano).slice(2)}`,
    completo: `${NOMES_MESES_COMPLETOS[mes - 1]} de ${ano}`,
  };
}

/**
 * Aba de Estatísticas e Projeção Futura (próximos 12 meses):
 * - Destaca em qual mês você termina de pagar todas as dívidas cadastradas
 * - Gráfico 1 (Linha): Evolução do saldo acumulado ao longo dos próximos 12 meses
 * - Gráfico 2 (Colunas): Salário previsto (verde) x Dívidas e contas (amarelo) caindo mês a mês
 * - Ranking de gastos e dívidas por categoria
 */
export default function EstatisticasView({
  lancamentosTodos,
  resumoGeral,
  salarioConfig,
  onConfigurarSalario,
}) {
  const [mesSelecionadoIdx, setMesSelecionadoIdx] = useState(0);

  const analise = useMemo(() => {
    const hoje = new Date();
    const anoHoje = hoje.getFullYear();
    const mesHoje = hoje.getMonth() + 1;
    const diaHoje = hoje.getDate();
    const mesAtualStr = `${anoHoje}-${String(mesHoje).padStart(2, '0')}`;

    // Mapa de compromissos pendentes (dívidas e saídas) e entradas pendentes por mês
    const dividasPorMes = {};
    const outrasSaidasPorMes = {};
    const entradasPendentesPorMes = {};
    const salarioRecebidoPorMes = {};

    let ultimaDataDividaPendente = null;

    for (const item of lancamentosTodos) {
      const mesRef = item.data.slice(0, 7);

      if (item.tipo === 'entrada') {
        if (item.status === 'pendente') {
          entradasPendentesPorMes[mesRef] =
            (entradasPendentesPorMes[mesRef] || 0) + item.valor;
        } else if (item.categoria === 'Salário') {
          salarioRecebidoPorMes[mesRef] = true;
        }
      } else if (item.status === 'pendente') {
        if (item.tipo === 'divida') {
          dividasPorMes[mesRef] = (dividasPorMes[mesRef] || 0) + item.valor;
          if (!ultimaDataDividaPendente || item.data > ultimaDataDividaPendente) {
            ultimaDataDividaPendente = item.data;
          }
        } else {
          outrasSaidasPorMes[mesRef] =
            (outrasSaidasPorMes[mesRef] || 0) + item.valor;
        }
      }
    }

    // Monta a projeção para os próximos 12 meses (a partir do mês atual)
    const meses = [];
    let saldoAcumulado = resumoGeral.saldoReal;

    for (let i = 0; i < 12; i++) {
      const m = somarMesIso(anoHoje, mesHoje, i);
      const dividasMes = dividasPorMes[m.iso] || 0;
      const outrasSaidasMes = outrasSaidasPorMes[m.iso] || 0;
      const saidasPrevistasMes = dividasMes + outrasSaidasMes;

      // Salário previsto entra nos meses futuros (e no mês atual só se ainda não recebeu e ainda não passou o dia)
      let salarioPrevistoMes = 0;
      if (salarioConfig) {
        if (m.iso > mesAtualStr) {
          salarioPrevistoMes = salarioRecebidoPorMes[m.iso]
            ? 0
            : salarioConfig.valor;
        } else if (
          m.iso === mesAtualStr &&
          !salarioRecebidoPorMes[m.iso] &&
          diaHoje <= salarioConfig.diaPagamento
        ) {
          salarioPrevistoMes = salarioConfig.valor;
        }
      }

      const entradasPrevistasMes =
        salarioPrevistoMes + (entradasPendentesPorMes[m.iso] || 0);
      const sobraMes = entradasPrevistasMes - saidasPrevistasMes;
      saldoAcumulado += sobraMes;

      meses.push({
        ...m,
        salarioPrevistoMes,
        entradasPrevistasMes,
        dividasMes,
        saidasPrevistasMes,
        sobraMes,
        saldoAcumulado,
      });
    }

    // Mês em que termina de pagar todas as dívidas pendentes
    let mesQuitacao = null;
    if (ultimaDataDividaPendente) {
      const [anoUlt, mesUlt] = ultimaDataDividaPendente.split('-').map(Number);
      const diffMeses = (anoUlt - anoHoje) * 12 + (mesUlt - mesHoje);
      mesQuitacao = {
        texto: `${NOMES_MESES_COMPLETOS[mesUlt - 1]} de ${anoUlt}`,
        mesesRestantes: Math.max(0, diffMeses),
      };
    }

    // Categorias (saídas + dívidas)
    const mapaCategorias = {};
    for (const item of lancamentosTodos) {
      if (item.tipo === 'saida' || item.tipo === 'divida') {
        mapaCategorias[item.categoria] =
          (mapaCategorias[item.categoria] || 0) + item.valor;
      }
    }
    const categorias = Object.entries(mapaCategorias)
      .map(([categoria, valor]) => ({ categoria, valor }))
      .sort((a, b) => b.valor - a.valor);

    return {
      meses,
      mesQuitacao,
      saldoEm12Meses: meses[meses.length - 1]?.saldoAcumulado ?? resumoGeral.saldoReal,
      categorias,
      maxCategoria: Math.max(...categorias.map((c) => c.valor), 1),
    };
  }, [lancamentosTodos, resumoGeral, salarioConfig]);

  const mesFoco = analise.meses[mesSelecionadoIdx] || analise.meses[0];

  // Geometria do Gráfico de Linha (Projeção de Saldo Acumulado)
  const svgW = 760;
  const svgH = 220;
  const padX = 48;
  const padTop = 20;
  const padBottom = 34;
  const plotW = svgW - padX * 2;
  const plotH = svgH - padTop - padBottom;

  const valoresLinha = analise.meses.map((m) => m.saldoAcumulado);
  const minLinha = Math.min(...valoresLinha, 0);
  const maxLinha = Math.max(...valoresLinha, 100);
  const rangeLinha = Math.max(maxLinha - minLinha, 1);

  const pontosLinha = analise.meses.map((m, idx) => {
    const x = padX + (idx / (analise.meses.length - 1)) * plotW;
    const y = padTop + plotH - ((m.saldoAcumulado - minLinha) / rangeLinha) * plotH;
    return { x, y, ...m, idx };
  });

  const pathLinha = pontosLinha
    .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(' ');
  const baseY = padTop + plotH;
  const pathArea = `${pathLinha} L ${pontosLinha[pontosLinha.length - 1].x.toFixed(1)} ${baseY} L ${pontosLinha[0].x.toFixed(1)} ${baseY} Z`;

  // Geometria do Gráfico de Colunas Agrupadas (Salário/Entradas x Dívidas/Saídas)
  const maxBarra = Math.max(
    ...analise.meses.map((m) => Math.max(m.entradasPrevistasMes, m.saidasPrevistasMes)),
    100
  );

  return (
    <div className="stats-view">
      {/* Cards de resumo histórico e futuro */}
      <section className="summary-grid">
        <div className="card">
          <span className="card-label">Total Que Já Entrou Até Hoje</span>
          <strong className="card-value positive">
            {formatarMoeda(resumoGeral.entradasRecebidas)}
          </strong>
          <span className="card-sub">
            {resumoGeral.saidasPagas > 0
              ? `Saídas pagas do saldo: ${formatarMoeda(resumoGeral.saidasPagas)}`
              : 'Histórico acumulado de todas as entradas recebidas'}
          </span>
        </div>

        <div className="card">
          <span className="card-label">Fim das Dívidas Atuais</span>
          <strong
            className={`card-value ${analise.mesQuitacao ? 'warning' : 'positive'}`}
          >
            {analise.mesQuitacao ? analise.mesQuitacao.texto : 'Sem dívidas!'}
          </strong>
          <span className="card-sub">
            {analise.mesQuitacao
              ? analise.mesQuitacao.mesesRestantes === 0
                ? 'Última parcela vence neste mês!'
                : `Faltam ${analise.mesQuitacao.mesesRestantes} ${
                    analise.mesQuitacao.mesesRestantes === 1 ? 'mês' : 'meses'
                  } para quitar tudo`
              : 'Nenhuma parcela de dívida pendente'}
          </span>
        </div>

        <div className="card">
          <span className="card-label">Projeção em 12 Meses</span>
          <strong
            className={`card-value ${analise.saldoEm12Meses >= 0 ? 'positive' : 'negative'}`}
          >
            {formatarMoeda(analise.saldoEm12Meses)}
          </strong>
          <span className="card-sub">
            {salarioConfig
              ? `Considerando salário de ${formatarMoeda(salarioConfig.valor)}/mês − dívidas`
              : 'Cadastre seu salário fixo para projetar seus ganhos'}
          </span>
        </div>
      </section>

      {!salarioConfig && (
        <div className="stats-banner">
          <span>
            Cadastre seu <strong>salário fixo</strong> para ver a curva real de quanto você vai juntar mês a mês pagando suas dívidas!
          </span>
          <button
            type="button"
            className="btn-small-primary"
            onClick={onConfigurarSalario}
          >
            + Adicionar salário fixo
          </button>
        </div>
      )}

      {/* Barra de inspeção do mês selecionado nos gráficos */}
      {mesFoco && (
        <section className="panel focus-month-bar">
          <div>
            <span className="focus-label">Mês selecionado nos gráficos</span>
            <strong>{mesFoco.completo}</strong>
          </div>
          <div className="focus-metrics">
            <div>
              <span>Previsto entrar</span>
              <strong className="positive">
                + {formatarMoeda(mesFoco.entradasPrevistasMes)}
              </strong>
            </div>
            <div>
              <span>Dívidas / A sair</span>
              <strong className="warning">
                - {formatarMoeda(mesFoco.saidasPrevistasMes)}
              </strong>
            </div>
            <div>
              <span>Sobra no mês</span>
              <strong className={mesFoco.sobraMes >= 0 ? 'positive' : 'negative'}>
                {mesFoco.sobraMes >= 0 ? '+' : ''}{' '}
                {formatarMoeda(mesFoco.sobraMes)}
              </strong>
            </div>
            <div>
              <span>Saldo acumulado</span>
              <strong
                className={mesFoco.saldoAcumulado >= 0 ? 'positive' : 'negative'}
              >
                {formatarMoeda(mesFoco.saldoAcumulado)}
              </strong>
            </div>
          </div>
        </section>
      )}

      {/* Gráfico 1: Evolução do Saldo Acumulado (12 meses) */}
      <section className="panel chart-panel">
        <div className="chart-header">
          <div>
            <h2>Evolução do seu dinheiro (próximos 12 meses)</h2>
            <span className="chart-subtitle">
              Passe o mouse ou clique em um mês para ver exatamente quanto terá guardado
            </span>
          </div>
        </div>

        <div className="svg-scroll">
          <svg
            viewBox={`0 0 ${svgW} ${svgH}`}
            className="line-chart-svg"
            role="img"
            aria-label="Gráfico de evolução do saldo nos próximos 12 meses"
          >
            <defs>
              <linearGradient id="saldoAreaGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#22c55e" stopOpacity="0.32" />
                <stop offset="100%" stopColor="#22c55e" stopOpacity="0.02" />
              </linearGradient>
            </defs>

            {/* Linhas de grade horizontais */}
            {[0, 0.5, 1].map((t) => {
              const y = padTop + plotH * t;
              const val = maxLinha - rangeLinha * t;
              return (
                <g key={t}>
                  <line
                    x1={padX}
                    y1={y}
                    x2={svgW - padX}
                    y2={y}
                    stroke="#263244"
                    strokeDasharray="4 4"
                  />
                  <text x={padX - 8} y={y + 4} textAnchor="end" className="svg-axis-label">
                    {formatarMoedaCurta(val)}
                  </text>
                </g>
              );
            })}

            {/* Área preenchida e linha */}
            <path d={pathArea} fill="url(#saldoAreaGrad)" />
            <path
              d={pathLinha}
              fill="none"
              stroke="#22c55e"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {/* Pontos clicáveis por mês */}
            {pontosLinha.map((p) => {
              const ativo = p.idx === mesSelecionadoIdx;
              return (
                <g
                  key={p.iso}
                  className="svg-point-group"
                  onMouseEnter={() => setMesSelecionadoIdx(p.idx)}
                  onClick={() => setMesSelecionadoIdx(p.idx)}
                >
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={ativo ? 6.5 : 4}
                    fill={p.saldoAcumulado >= 0 ? '#22c55e' : '#ef4444'}
                    stroke="#0b1120"
                    strokeWidth="2"
                  />
                  <text
                    x={p.x}
                    y={svgH - 10}
                    textAnchor="middle"
                    className={ativo ? 'svg-axis-label active' : 'svg-axis-label'}
                  >
                    {p.curto}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      </section>

      {/* Gráfico 2: Salário Previsto (Verde) x Dívidas caindo mês a mês (Amarelo) */}
      <section className="panel chart-panel">
        <div className="chart-header">
          <div>
            <h2>Salário previsto × Dívidas mês a mês</h2>
            <span className="chart-subtitle">
              Veja as dívidas diminuindo ao longo dos meses comparadas com o seu salário
            </span>
          </div>

          <div className="inline-legend">
            <span>
              <i className="legend-dot" style={{ backgroundColor: '#22c55e' }} />
              Previsto entrar
            </span>
            <span>
              <i className="legend-dot" style={{ backgroundColor: '#f59e0b' }} />
              Dívidas / A pagar
            </span>
          </div>
        </div>

        <div className="columns-chart">
          {analise.meses.map((m, idx) => {
            const hEntrada =
              m.entradasPrevistasMes > 0
                ? Math.max(4, (m.entradasPrevistasMes / maxBarra) * 100)
                : 0;
            const hSaida =
              m.saidasPrevistasMes > 0
                ? Math.max(4, (m.saidasPrevistasMes / maxBarra) * 100)
                : 0;
            const ativo = idx === mesSelecionadoIdx;

            return (
              <button
                key={m.iso}
                type="button"
                className={ativo ? 'col-group active' : 'col-group'}
                onMouseEnter={() => setMesSelecionadoIdx(idx)}
                onClick={() => setMesSelecionadoIdx(idx)}
              >
                <div className="col-bars">
                  <div
                    className="col-bar entrada"
                    style={{ height: `${hEntrada}%` }}
                    title={`Entrar: ${formatarMoeda(m.entradasPrevistasMes)}`}
                  />
                  <div
                    className="col-bar divida"
                    style={{ height: `${hSaida}%` }}
                    title={`Sair: ${formatarMoeda(m.saidasPrevistasMes)}`}
                  />
                </div>
                <span className="col-label">{m.curto}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Ranking por Categoria */}
      <section className="panel">
        <h2>Gastos e dívidas por categoria (total)</h2>
        {analise.categorias.length === 0 ? (
          <p className="empty-state">
            Nenhuma saída ou dívida registrada ainda.
          </p>
        ) : (
          <div className="stats-bars">
            {analise.categorias.map((cat) => {
              const pct = Math.max(5, (cat.valor / analise.maxCategoria) * 100);
              return (
                <div key={cat.categoria} className="stat-bar-row">
                  <div className="stat-bar-top">
                    <span>{cat.categoria}</span>
                    <strong>{formatarMoeda(cat.valor)}</strong>
                  </div>
                  <div className="stat-bar-track">
                    <div
                      className="stat-bar-fill"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
