function formatarMoeda(valor) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(valor || 0);
}

/**
 * Balanço visual único e limpo:
 * compara o VERDE (quanto você tem hoje) em relação ao AMARELO (ainda vai sair)
 * e ao VERMELHO (já saiu).
 */
export default function Charts({ resumo, modoGeral }) {
  const tenhoHoje = Math.max(0, resumo.saldoReal);
  const aindaVaiSair = Math.max(0, resumo.saidasAPagar);
  const jaSaiu = Math.max(0, resumo.saidasPagas);

  const fatias = [
    {
      id: 'tenho',
      label: 'O que você tem hoje',
      descricao: 'Saldo disponível na mão',
      valor: tenhoHoje,
      cor: '#22c55e',
    },
    {
      id: 'pendente',
      label: 'Ainda vai sair',
      descricao: 'Dívidas e contas pendentes',
      valor: aindaVaiSair,
      cor: '#f59e0b',
    },
    {
      id: 'pagas',
      label: 'Já saiu (Pago)',
      descricao: 'Saídas já quitadas',
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
        <div>
          <h2>Visão visual do seu dinheiro</h2>
          <span className="chart-subtitle">
            {modoGeral
              ? 'Proporção entre o que você tem hoje (verde), o que ainda vai sair (amarelo) e o que já saiu (vermelho)'
              : 'Proporção neste mês entre saldo disponível, a pagar e já pago'}
          </span>
        </div>
      </div>

      <div className="balance-body">
        {/* Esquerda: Gráfico de Rosca (Verde x Amarelo x Vermelho) */}
        <div className="donut-wrapper large">
          <svg viewBox="0 0 180 180" className="donut-svg">
            <circle
              cx="90"
              cy="90"
              r={raio}
              fill="none"
              stroke="#1f2937"
              strokeWidth="22"
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
                    strokeWidth="22"
                    strokeDasharray={`${tamanho} ${circunferencia}`}
                    strokeDashoffset={offset}
                    transform="rotate(-90 90 90)"
                    className="donut-segment"
                  />
                );
              })}
          </svg>

          <div className="donut-center">
            <span className="donut-center-label">Você tem hoje</span>
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
                    <div>
                      <div className="legend-label">{fatia.label}</div>
                      <div className="legend-desc">{fatia.descricao}</div>
                    </div>
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
