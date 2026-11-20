import { useMemo, useState } from 'react';
import { encontrarLancamentoDespesaNoMes } from './DespesasFixasSection.jsx';
import InfoTip from './InfoTip.jsx';

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

const CORES_CATEGORIA = {
  'Cartão de crédito': '#a855f7',
  Parcelamento: '#ef4444',
  Empréstimo: '#f97316',
  Financiamento: '#ec4899',
  'Boleto atrasado': '#e11d48',
  Moradia: '#3b82f6',
  Contas: '#06b6d4',
  Assinaturas: '#8b5cf6',
  Alimentação: '#f59e0b',
  Transporte: '#14b8a6',
  Saúde: '#10b981',
  Educação: '#6366f1',
  Lazer: '#d946ef',
  Geral: '#64748b',
  Outros: '#94a3b8',
};

const PALETA_FALLBACK = [
  '#3b82f6',
  '#a855f7',
  '#ef4444',
  '#14b8a6',
  '#f97316',
  '#ec4899',
  '#6366f1',
  '#06b6d4',
];

function corDaCategoria(nome, indice) {
  return CORES_CATEGORIA[nome] || PALETA_FALLBACK[indice % PALETA_FALLBACK.length];
}

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
  despesasFixas = [],
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

    // Despesas fixas ativas entram nos meses futuros (e no mês atual se ainda não venceu nem foi lançada)
    const despesasFixasAtivas = despesasFixas.filter((d) => d.ativa !== 0);
    const totalFixasMensal = despesasFixasAtivas.reduce((acc, d) => acc + d.valor, 0);

    // Monta a projeção para os próximos 12 meses (a partir do mês atual)
    const meses = [];
    let saldoAcumulado = resumoGeral.saldoReal;
    let dividaRestante = resumoGeral.dividasPendentes;

    for (let i = 0; i < 12; i++) {
      const m = somarMesIso(anoHoje, mesHoje, i);
      const dividasMes = dividasPorMes[m.iso] || 0;
      const outrasSaidasMes = outrasSaidasPorMes[m.iso] || 0;

      let fixasPrevistasMes = 0;
      for (const df of despesasFixasAtivas) {
        const jaLancada = Boolean(
          encontrarLancamentoDespesaNoMes(df, m.iso, lancamentosTodos)
        );
        if (jaLancada) continue;
        if (m.iso > mesAtualStr || (m.iso === mesAtualStr && diaHoje <= df.dia_vencimento)) {
          fixasPrevistasMes += df.valor;
        }
      }

      const saidasPrevistasMes = dividasMes + outrasSaidasMes + fixasPrevistasMes;

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
      dividaRestante = Math.max(0, Math.round((dividaRestante - dividasMes) * 100) / 100);

      meses.push({
        ...m,
        salarioPrevistoMes,
        entradasPrevistasMes,
        dividasMes,
        fixasPrevistasMes,
        saidasPrevistasMes,
        sobraMes,
        saldoAcumulado,
        dividaRestante,
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
      totalFixasMensal,
      saldoEm12Meses: meses[meses.length - 1]?.saldoAcumulado ?? resumoGeral.saldoReal,
      categorias,
      maxCategoria: Math.max(...categorias.map((c) => c.valor), 1),
    };
  }, [lancamentosTodos, resumoGeral, salarioConfig, despesasFixas]);

  const mesFoco = analise.meses[mesSelecionadoIdx] || analise.meses[0];

  // Geometria do Gráfico de Linha duplo (Saldo Acumulado x Dívida Restante)
  const svgW = 760;
  const svgH = 235;
  const padX = 52;
  const padTop = 20;
  const padBottom = 34;
  const plotW = svgW - padX * 2;
  const plotH = svgH - padTop - padBottom;

  const valoresTodos = analise.meses.flatMap((m) => [
    m.saldoAcumulado,
    m.dividaRestante,
  ]);
  const minLinha = Math.min(...valoresTodos, 0);
  const maxLinha = Math.max(...valoresTodos, 100);
  const rangeLinha = Math.max(maxLinha - minLinha, 1);

  const mapY = (v) => padTop + plotH - ((v - minLinha) / rangeLinha) * plotH;

  const pontosLinha = analise.meses.map((m, idx) => {
    const x = padX + (idx / (analise.meses.length - 1)) * plotW;
    return {
      x,
      ySaldo: mapY(m.saldoAcumulado),
      yDivida: mapY(m.dividaRestante),
      ...m,
      idx,
    };
  });

  const pathSaldo = pontosLinha
    .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.ySaldo.toFixed(1)}`)
    .join(' ');
  const pathDivida = pontosLinha
    .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.yDivida.toFixed(1)}`)
    .join(' ');
  const baseY = padTop + plotH;
  const pathAreaSaldo = `${pathSaldo} L ${pontosLinha[pontosLinha.length - 1].x.toFixed(1)} ${baseY} L ${pontosLinha[0].x.toFixed(1)} ${baseY} Z`;
  const pathAreaDivida = `${pathDivida} L ${pontosLinha[pontosLinha.length - 1].x.toFixed(1)} ${baseY} L ${pontosLinha[0].x.toFixed(1)} ${baseY} Z`;

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
          <div className="card-label-row">
            <span className="card-label">Já entrou</span>
            <InfoTip texto="Total histórico de todas as entradas já recebidas até hoje." />
          </div>
          <strong className="card-value positive">
            {formatarMoeda(resumoGeral.entradasRecebidas)}
          </strong>
          {resumoGeral.saidasPagas > 0 && (
            <span className="card-sub">
              Saídas pagas: {formatarMoeda(resumoGeral.saidasPagas)}
            </span>
          )}
        </div>

        <div className="card">
          <div className="card-label-row">
            <span className="card-label">Fim das dívidas</span>
            <InfoTip texto="Mês de vencimento da última parcela de dívida pendente cadastrada." />
          </div>
          <strong
            className={`card-value ${analise.mesQuitacao ? 'negative' : 'positive'}`}
          >
            {analise.mesQuitacao ? analise.mesQuitacao.texto : 'Sem dívidas!'}
          </strong>
          {analise.mesQuitacao && (
            <span className="card-sub">
              {analise.mesQuitacao.mesesRestantes === 0
                ? 'Última parcela vence neste mês'
                : `Faltam ${analise.mesQuitacao.mesesRestantes} ${
                    analise.mesQuitacao.mesesRestantes === 1 ? 'mês' : 'meses'
                  }`}
            </span>
          )}
        </div>

        <div className="card">
          <div className="card-label-row">
            <span className="card-label">Projeção (12 meses)</span>
            <InfoTip texto="Saldo acumulado estimado daqui a 12 meses somando seu salário fixo e descontando dívidas e despesas fixas." />
          </div>
          <strong
            className={`card-value ${analise.saldoEm12Meses >= 0 ? 'positive' : 'negative'}`}
          >
            {formatarMoeda(analise.saldoEm12Meses)}
          </strong>
          {salarioConfig && (
            <span className="card-sub">
              {analise.totalFixasMensal > 0
                ? `Salário ${formatarMoeda(salarioConfig.valor)} − fixas ${formatarMoeda(analise.totalFixasMensal)}/mês`
                : `Salário ${formatarMoeda(salarioConfig.valor)}/mês`}
            </span>
          )}
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
              <span>{mesFoco.fixasPrevistasMes > 0 ? 'Fixas + dívidas' : 'Dívidas / A sair'}</span>
              <strong className="negative">
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
              <span>Dívida restante</span>
              <strong className="negative">
                {formatarMoeda(mesFoco.dividaRestante)}
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

      {/* Gráfico 1: Evolução do Saldo Acumulado x Dívida Restante (12 meses) */}
      <section className="panel chart-panel">
        <div className="chart-header">
          <div className="title-with-tip">
            <h2>Saldo × Dívidas (12 meses)</h2>
            <InfoTip
              alinhamento="left"
              texto="Acompanhe seu saldo acumulado subindo enquanto o total restante de dívidas cai mês a mês."
            />
          </div>

          <div className="inline-legend">
            <span>
              <i className="legend-dot" style={{ backgroundColor: '#22c55e' }} />
              Saldo acumulado
            </span>
            <span>
              <i className="legend-dot" style={{ backgroundColor: '#ef4444' }} />
              Dívida restante
            </span>
          </div>
        </div>

        <div className="svg-scroll">
          <svg
            viewBox={`0 0 ${svgW} ${svgH}`}
            className="line-chart-svg"
            role="img"
            aria-label="Gráfico comparando evolução do saldo e dívida restante nos próximos 12 meses"
          >
            <defs>
              <linearGradient id="saldoAreaGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#22c55e" stopOpacity="0.28" />
                <stop offset="100%" stopColor="#22c55e" stopOpacity="0.02" />
              </linearGradient>
              <linearGradient id="dividaAreaGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#ef4444" stopOpacity="0.22" />
                <stop offset="100%" stopColor="#ef4444" stopOpacity="0.01" />
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
                    stroke="var(--chart-grid)"
                    strokeDasharray="4 4"
                  />
                  <text x={padX - 8} y={y + 4} textAnchor="end" className="svg-axis-label">
                    {formatarMoedaCurta(val)}
                  </text>
                </g>
              );
            })}

            {/* Linha guia vertical no mês selecionado */}
            {pontosLinha[mesSelecionadoIdx] && (
              <line
                x1={pontosLinha[mesSelecionadoIdx].x}
                y1={padTop}
                x2={pontosLinha[mesSelecionadoIdx].x}
                y2={baseY}
                stroke="#3b82f6"
                strokeOpacity="0.45"
                strokeDasharray="3 3"
              />
            )}

            {/* Área e linha da Dívida Restante (vermelho caindo) */}
            <path d={pathAreaDivida} fill="url(#dividaAreaGrad)" />
            <path
              d={pathDivida}
              fill="none"
              stroke="#ef4444"
              strokeWidth="2.8"
              strokeDasharray="6 4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {/* Área e linha do Saldo Acumulado (verde subindo) */}
            <path d={pathAreaSaldo} fill="url(#saldoAreaGrad)" />
            <path
              d={pathSaldo}
              fill="none"
              stroke="#22c55e"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {/* Pontos interativos por mês (Saldo + Dívida) */}
            {pontosLinha.map((p) => {
              const ativo = p.idx === mesSelecionadoIdx;
              return (
                <g
                  key={p.iso}
                  className="svg-point-group"
                  onMouseEnter={() => setMesSelecionadoIdx(p.idx)}
                  onClick={() => setMesSelecionadoIdx(p.idx)}
                >
                  {/* Área invisível mais larga pra facilitar o hover/clique */}
                  <rect
                    x={p.x - 24}
                    y={padTop}
                    width={48}
                    height={plotH + padBottom}
                    fill="transparent"
                  />
                  <circle
                    cx={p.x}
                    cy={p.yDivida}
                    r={ativo ? 6 : 3.5}
                    fill="#ef4444"
                    stroke="var(--chart-point-stroke)"
                    strokeWidth="2"
                  />
                  <circle
                    cx={p.x}
                    cy={p.ySaldo}
                    r={ativo ? 6.5 : 4}
                    fill={p.saldoAcumulado >= 0 ? '#16a34a' : '#dc2626'}
                    stroke="var(--chart-point-stroke)"
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
          <div className="title-with-tip">
            <h2>Entradas × A pagar (por mês)</h2>
            <InfoTip
              alinhamento="left"
              texto="Comparação mensal entre o valor previsto para entrar e as parcelas/contas a pagar."
            />
          </div>

          <div className="inline-legend">
            <span>
              <i className="legend-dot" style={{ backgroundColor: '#22c55e' }} />
              Previsto entrar
            </span>
            <span>
              <i className="legend-dot" style={{ backgroundColor: '#ef4444' }} />
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
        <div className="panel-header">
          <div className="title-with-tip">
            <h2>Por categoria</h2>
            <InfoTip
              alinhamento="left"
              texto="Total acumulado de gastos e dívidas agrupados por categoria."
            />
          </div>
        </div>
        {analise.categorias.length === 0 ? (
          <p className="empty-state">
            Nenhuma saída ou dívida registrada ainda.
          </p>
        ) : (
          <div className="stats-bars">
            {(() => {
              const totalCategorias = analise.categorias.reduce(
                (acc, c) => acc + c.valor,
                0
              );
              return analise.categorias.map((cat, idx) => {
                const pctBarra = Math.max(5, (cat.valor / analise.maxCategoria) * 100);
                const pctTotal =
                  totalCategorias > 0
                    ? Math.round((cat.valor / totalCategorias) * 100)
                    : 0;
                const cor = corDaCategoria(cat.categoria, idx);

                return (
                  <div key={cat.categoria} className="stat-bar-row">
                    <div className="stat-bar-top">
                      <span className="stat-cat-label">
                        <i
                          className="legend-dot"
                          style={{ backgroundColor: cor }}
                        />
                        {cat.categoria}
                      </span>
                      <span className="stat-cat-value">
                        <strong>{formatarMoeda(cat.valor)}</strong>
                        <span className="stat-cat-pct">{pctTotal}%</span>
                      </span>
                    </div>
                    <div className="stat-bar-track">
                      <div
                        className="stat-bar-fill"
                        style={{ width: `${pctBarra}%`, background: cor }}
                      />
                    </div>
                  </div>
                );
              });
            })()}
          </div>
        )}
      </section>
    </div>
  );
}
