import { useState } from 'react';

function formatarMoeda(valor) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(valor || 0);
}

const CORES_CATEGORIA = [
  '#f59e0b',
  '#ef4444',
  '#3b82f6',
  '#a855f7',
  '#ec4899',
  '#14b8a6',
  '#6366f1',
];

/**
 * Componente de gráficos do painel financeiro:
 * 1) Gráfico de Rosca (Pizza moderna): Distribuição do dinheiro (Livre x Pago x Ainda vai sair)
 * 2) Gráfico de Barras: Comparativo geral (Entrou x Saiu x Vai Sair) ou Gastos por Categoria
 */
export default function Charts({ resumo, lancamentos, modoGeral }) {
  const [abaBarras, setAbaBarras] = useState('comparativo'); // 'comparativo' ou 'categorias'

  const livrePrevisto = Math.max(0, resumo.saldoPrevisto);
  const saidasPagas = Math.max(0, resumo.saidasPagas);
  const aindaVaiSair = Math.max(0, resumo.saidasAPagar);

  const fatias = [
    {
      id: 'livre',
      label: 'Livre (Após pagar tudo)',
      valor: livrePrevisto,
      cor: '#22c55e',
    },
    {
      id: 'pagas',
      label: 'Saídas pagas',
      valor: saidasPagas,
      cor: '#ef4444',
    },
    {
      id: 'pendente',
      label: 'Ainda vai sair (A pagar)',
      valor: aindaVaiSair,
      cor: '#f59e0b',
    },
  ];

  const totalPizza = fatias.reduce((acc, f) => acc + f.valor, 0);

  // Geometria do círculo SVG para o gráfico de rosca
  const raio = 68;
  const circunferencia = 2 * Math.PI * raio;
  let acumulado = 0;

  // Dados das barras comparativas
  const barrasComparativo = [
    {
      label: 'Quanto tenho hoje (Saldo)',
      valor: Math.max(0, resumo.saldoReal),
      valorReal: resumo.saldoReal,
      cor: resumo.saldoReal >= 0 ? '#22c55e' : '#ef4444',
    },
    {
      label: 'Entradas recebidas',
      valor: Math.max(0, resumo.entradasRecebidas),
      valorReal: resumo.entradasRecebidas,
      cor: '#3b82f6',
    },
    {
      label: 'Saídas já pagas',
      valor: saidasPagas,
      valorReal: saidasPagas,
      cor: '#ef4444',
    },
    {
      label: 'Ainda vai sair (Dívidas e contas)',
      valor: aindaVaiSair,
      valorReal: aindaVaiSair,
      cor: '#f59e0b',
    },
  ];
  const maxComparativo = Math.max(...barrasComparativo.map((b) => b.valor), 1);

  // Agrupa saídas e dívidas por categoria para o gráfico "Por Categoria"
  const mapaCategorias = {};
  for (const item of lancamentos) {
    if (item.tipo === 'saida' || item.tipo === 'divida') {
      mapaCategorias[item.categoria] = (mapaCategorias[item.categoria] || 0) + item.valor;
    }
  }
  const barrasCategorias = Object.entries(mapaCategorias)
    .map(([categoria, valor], idx) => ({
      label: categoria,
      valor,
      cor: CORES_CATEGORIA[idx % CORES_CATEGORIA.length],
    }))
    .sort((a, b) => b.valor - a.valor)
    .slice(0, 6);
  const maxCategoria = Math.max(...barrasCategorias.map((b) => b.valor), 1);

  return (
    <section className="charts-grid">
      {/* Gráfico 1: Rosca (Pizza moderna) */}
      <div className="panel chart-card">
        <div className="chart-header">
          <div>
            <h2>Raio-X do seu dinheiro</h2>
            <span className="chart-subtitle">
              {modoGeral
                ? 'Distribuição geral: livre, pago e a pagar'
                : 'Distribuição neste mês: livre, pago e a pagar'}
            </span>
          </div>
        </div>

        <div className="donut-layout">
          <div className="donut-wrapper">
            <svg viewBox="0 0 180 180" className="donut-svg">
              {/* Trilha de fundo */}
              <circle
                cx="90"
                cy="90"
                r={raio}
                fill="none"
                stroke="#1f2937"
                strokeWidth="20"
              />

              {/* Fatias proporcionais */}
              {totalPizza > 0 &&
                fatias.map((fatia) => {
                  if (fatia.valor <= 0) return null;
                  const fracao = fatia.valor / totalPizza;
                  const tamanho = fracao * circunferencia;
                  const offset = -acumulado;
                  acumulado += tamanho;

                  return (
                    <circle
                      key={fatia.id}
                      cx="90"
                      cy="90"
                      r={raio}
                      fill="none"
                      stroke={fatia.cor}
                      strokeWidth="20"
                      strokeDasharray={`${tamanho} ${circunferencia}`}
                      strokeDashoffset={offset}
                      transform="rotate(-90 90 90)"
                      className="donut-segment"
                    />
                  );
                })}
            </svg>

            <div className="donut-center">
              <span className="donut-center-label">
                {resumo.saldoPrevisto >= 0 ? 'Saldo previsto' : 'Faltará'}
              </span>
              <strong
                className={`donut-center-value ${
                  resumo.saldoPrevisto >= 0 ? 'positive' : 'negative'
                }`}
              >
                {formatarMoeda(resumo.saldoPrevisto)}
              </strong>
            </div>
          </div>

          <div className="donut-legend">
            {fatias.map((fatia) => {
              const pct =
                totalPizza > 0 ? Math.round((fatia.valor / totalPizza) * 100) : 0;
              return (
                <div key={fatia.id} className="legend-row">
                  <div className="legend-left">
                    <span
                      className="legend-dot"
                      style={{ backgroundColor: fatia.cor }}
                    />
                    <span className="legend-label">{fatia.label}</span>
                  </div>
                  <div className="legend-right">
                    <strong>{formatarMoeda(fatia.valor)}</strong>
                    <span className="legend-pct">{pct}%</span>
                  </div>
                </div>
              );
            })}

            {resumo.saldoPrevisto < 0 && (
              <div className="donut-warning">
                Atenção: suas saídas + dívidas passam das entradas em{' '}
                <strong>{formatarMoeda(Math.abs(resumo.saldoPrevisto))}</strong>.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Gráfico 2: Barras horizontais (Comparativo vs Por Categoria) */}
      <div className="panel chart-card">
        <div className="chart-header">
          <div>
            <h2>Comparativo visual</h2>
            <span className="chart-subtitle">
              {abaBarras === 'comparativo'
                ? 'Entradas, saldo, saídas pagas e o que ainda vai sair'
                : 'Onde estão suas saídas e dívidas'}
            </span>
          </div>

          <div className="mini-tabs">
            <button
              type="button"
              className={abaBarras === 'comparativo' ? 'mini-tab active' : 'mini-tab'}
              onClick={() => setAbaBarras('comparativo')}
            >
              Resumo
            </button>
            <button
              type="button"
              className={abaBarras === 'categorias' ? 'mini-tab active' : 'mini-tab'}
              onClick={() => setAbaBarras('categorias')}
            >
              Categorias
            </button>
          </div>
        </div>

        {abaBarras === 'comparativo' ? (
          <div className="bars-list">
            {barrasComparativo.map((bar) => {
              const largura =
                bar.valor > 0 ? Math.max(4, (bar.valor / maxComparativo) * 100) : 0;
              return (
                <div key={bar.label} className="bar-item">
                  <div className="bar-top">
                    <span className="bar-label">{bar.label}</span>
                    <strong className="bar-value">{formatarMoeda(bar.valorReal)}</strong>
                  </div>
                  <div className="bar-track">
                    <div
                      className="bar-fill"
                      style={{ width: `${largura}%`, backgroundColor: bar.cor }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        ) : barrasCategorias.length === 0 ? (
          <p className="empty-state">
            Nenhuma saída ou dívida cadastrada neste período ainda.
          </p>
        ) : (
          <div className="bars-list">
            {barrasCategorias.map((bar) => {
              const largura = Math.max(6, (bar.valor / maxCategoria) * 100);
              return (
                <div key={bar.label} className="bar-item">
                  <div className="bar-top">
                    <span className="bar-label">{bar.label}</span>
                    <strong className="bar-value">{formatarMoeda(bar.valor)}</strong>
                  </div>
                  <div className="bar-track">
                    <div
                      className="bar-fill"
                      style={{ width: `${largura}%`, backgroundColor: bar.cor }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
