import InfoTip from './InfoTip.jsx';

function formatarMoeda(valor) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(valor || 0);
}

/**
 * Balanço visual único e limpo na Visão Geral:
 * compara Disponível (verde), A pagar (amarelo) e Já pago (vermelho).
 */
export default function Charts({ resumo, modoGeral }) {
  const tenhoHoje = Math.max(0, resumo.saldoReal);
  const aindaVaiSair = Math.max(0, resumo.saidasAPagar);
  const jaSaiu = Math.max(0, resumo.saidasPagas);

  const fatias = [
    {
      id: 'tenho',
      label: 'Disponível',
      valor: tenhoHoje,
      cor: '#16a34a',
    },
    {
      id: 'pendente',
      label: 'A pagar',
      valor: aindaVaiSair,
      cor: '#f59e0b',
    },
    {
      id: 'pagas',
      label: 'Já pago',
      valor: jaSaiu,
      cor: '#ef4444',
    },
  ];

  const totalBase = fatias.reduce((acc, f) => acc + f.valor, 0);

  // Geometria do gráfico de rosca SVG
  const raio = 70;
  const circunferencia = 2 * Math.PI * raio;
  let acumulado = 0;

  return (
    <section className="panel balance-chart">
      <div className="balance-header">
        <div className="title-with-tip">
          <h2>Resumo do dinheiro</h2>
          <InfoTip
            alinhamento="left"
            texto={
              modoGeral
                ? 'Proporção entre o dinheiro disponível hoje (verde), contas/dívidas a pagar (amarelo) e o que já foi pago (vermelho).'
                : 'Proporção neste mês entre saldo disponível, o que falta pagar e o que já foi pago.'
            }
          />
        </div>
      </div>

      <div className="balance-body">
        {/* Esquerda: Gráfico de Rosca */}
        <div className="donut-wrapper large">
          <svg viewBox="0 0 180 180" className="donut-svg">
            <circle
              cx="90"
              cy="90"
              r={raio}
              fill="none"
              stroke="var(--donut-track)"
              strokeWidth="20"
            />

            {totalBase > 0 &&
              fatias.map((fatia) => {
                if (fatia.valor <= 0) return null;
                const fracao = fatia.valor / totalBase;
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
            <span className="donut-center-label">Disponível</span>
            <strong
              className={`donut-center-value ${
                resumo.saldoReal >= 0 ? 'positive' : 'negative'
              }`}
            >
              {formatarMoeda(resumo.saldoReal)}
            </strong>
          </div>
        </div>

        {/* Direita: Barra proporcional + 3 blocos limpos */}
        <div className="balance-details">
          <div className="stacked-bar" aria-label="Proporção visual">
            {totalBase > 0 ? (
              fatias.map((fatia) => {
                if (fatia.valor <= 0) return null;
                const pct = (fatia.valor / totalBase) * 100;
                return (
                  <div
                    key={fatia.id}
                    className="stacked-segment"
                    style={{ width: `${pct}%`, backgroundColor: fatia.cor }}
                    title={`${fatia.label}: ${formatarMoeda(fatia.valor)} (${Math.round(pct)}%)`}
                  />
                );
              })
            ) : (
              <div className="stacked-empty" />
            )}
          </div>

          <div className="balance-legend">
            {fatias.map((fatia) => {
              const pct =
                totalBase > 0 ? Math.round((fatia.valor / totalBase) * 100) : 0;
              return (
                <div key={fatia.id} className="balance-legend-item">
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
          </div>
        </div>
      </div>
    </section>
  );
}
