import { useState } from 'react';

const DADOS_EXEMPLO = {
  total: {
    subtitulo: 'Exemplo acumulado',
    entrou: 'R$ 4.300,00',
    dividas: 'R$ 2.580,50',
    sobrou: 'R$ 1.719,50',
    pctLivre: 40,
    pctDividas: 60,
  },
  mes: {
    subtitulo: 'Exemplo de um mês',
    entrou: 'R$ 2.400,00',
    dividas: 'R$ 840,00',
    sobrou: 'R$ 1.560,00',
    pctLivre: 65,
    pctDividas: 35,
  },
};

const PASSOS = [
  {
    numero: '01',
    titulo: 'Anote o que entra',
    descricao:
      'Salário fixo, renda extra e carteiras — saiba exatamente onde cada valor está guardado.',
    icone: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="5" width="20" height="14" rx="2.5" />
        <path d="M16 12h.01" />
      </svg>
    ),
  },
  {
    numero: '02',
    titulo: 'Liste as dívidas',
    descricao:
      'Parcelamentos no cartão, despesas fixas mensais e calendário de vencimentos em um só lugar.',
    icone: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
      </svg>
    ),
  },
  {
    numero: '03',
    titulo: 'Veja o que sobra',
    descricao:
      'Gráficos limpos, projeção de 12 meses e metas para você planejar o seu futuro com clareza.',
    icone: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21.21 15.89A10 10 0 1 1 8 2.83" />
        <path d="M22 12A10 10 0 0 0 12 2v10z" />
      </svg>
    ),
  },
];

/**
 * Página inicial pública (Landing Page) do Minhas Finanças.
 * Apresenta o produto com uma prévia interativa antes do visitante entrar ou criar conta.
 */
export default function LandingPage({
  tema,
  onAlternarTema,
  onAbrirLogin,
  onAbrirCadastro,
}) {
  const [modoPreview, setModoPreview] = useState('total'); // 'total' | 'mes'
  const exemplo = DADOS_EXEMPLO[modoPreview];

  // Geometria do gráfico de rosca da prévia
  const raio = 42;
  const circunferencia = 2 * Math.PI * raio;
  const arcoLivre = (exemplo.pctLivre / 100) * circunferencia;
  const arcoDividas = (exemplo.pctDividas / 100) * circunferencia;

  function irParaComoFunciona() {
    document
      .getElementById('como-funciona')
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <div className="landing-page">
      {/* Cabeçalho superior */}
      <header className="landing-header">
        <div className="landing-container landing-header-inner">
          <div className="landing-brand">
            <div className="landing-logo">R$</div>
            <strong>Minhas Finanças</strong>
          </div>

          <div className="landing-header-actions">
            <button
              type="button"
              className="btn-theme-icon"
              onClick={onAlternarTema}
              title={tema === 'dark' ? 'Mudar para modo claro' : 'Mudar para modo escuro'}
              aria-label={tema === 'dark' ? 'Mudar para modo claro' : 'Mudar para modo escuro'}
            >
              {tema === 'dark' ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 2v2" />
                  <path d="M12 20v2" />
                  <path d="m4.93 4.93 1.41 1.41" />
                  <path d="m17.66 17.66 1.41 1.41" />
                  <path d="M2 12h2" />
                  <path d="M20 12h2" />
                  <path d="m6.34 17.66-1.41 1.41" />
                  <path d="m19.07 4.93-1.41 1.41" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
                </svg>
              )}
            </button>

            <button
              type="button"
              className="btn-outline"
              onClick={onAbrirLogin}
            >
              Entrar
            </button>

            <button
              type="button"
              className="btn-add"
              onClick={onAbrirCadastro}
            >
              + Fazer minha conta
            </button>
          </div>
        </div>
      </header>

      <main className="landing-container landing-main">
        {/* Hero: texto à esquerda + prévia interativa à direita */}
        <section className="landing-hero">
          <div className="landing-hero-copy">
            <span className="landing-pill">
              <i className="landing-pill-dot" />
              100% gratuito e privado
            </span>

            <h1>
              Saiba exatamente{' '}
              <span className="landing-gradient-text">quanto sobra</span> no fim
              do mês.
            </h1>

            <p className="landing-subtitle">
              Coloque o que entra, organize suas dívidas parceladas e veja na
              hora o seu saldo real — com gráficos, calendário e metas.
            </p>

            <div className="landing-hero-actions">
              <button
                type="button"
                className="btn-landing-cta"
                onClick={onAbrirCadastro}
              >
                Começar agora <span aria-hidden="true">→</span>
              </button>

              <button
                type="button"
                className="btn-landing-secondary"
                onClick={irParaComoFunciona}
              >
                Como funciona
              </button>
            </div>
          </div>

          {/* Card de prévia interativa do painel */}
          <div className="landing-preview-wrap">
            <div className="landing-preview-glow" aria-hidden="true" />
            <div className="landing-preview-card">
              <div className="preview-top">
                <div>
                  <strong>Visão Geral</strong>
                  <span>{exemplo.subtitulo}</span>
                </div>

                <div className="preview-toggle" role="tablist" aria-label="Modo de exemplo">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={modoPreview === 'total'}
                    className={modoPreview === 'total' ? 'active' : ''}
                    onClick={() => setModoPreview('total')}
                  >
                    Total
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={modoPreview === 'mes'}
                    className={modoPreview === 'mes' ? 'active' : ''}
                    onClick={() => setModoPreview('mes')}
                  >
                    Por mês
                  </button>
                </div>
              </div>

              <div className="preview-metrics">
                <div className="preview-metric">
                  <span>Entrou</span>
                  <strong className="positive">{exemplo.entrou}</strong>
                </div>
                <div className="preview-metric">
                  <span>Dívidas</span>
                  <strong className="negative">{exemplo.dividas}</strong>
                </div>
                <div className="preview-metric">
                  <span>Sobrou</span>
                  <strong className="warning">{exemplo.sobrou}</strong>
                </div>
              </div>

              <div className="preview-chart-box">
                <div className="preview-donut">
                  <svg viewBox="0 0 110 110">
                    <circle
                      cx="55"
                      cy="55"
                      r={raio}
                      fill="none"
                      stroke="var(--donut-track)"
                      strokeWidth="12"
                    />
                    <circle
                      cx="55"
                      cy="55"
                      r={raio}
                      fill="none"
                      stroke="#16a34a"
                      strokeWidth="12"
                      strokeDasharray={`${arcoLivre} ${circunferencia}`}
                      strokeDashoffset="0"
                      transform="rotate(-90 55 55)"
                      className="donut-segment"
                    />
                    <circle
                      cx="55"
                      cy="55"
                      r={raio}
                      fill="none"
                      stroke="#dc2626"
                      strokeWidth="12"
                      strokeDasharray={`${arcoDividas} ${circunferencia}`}
                      strokeDashoffset={-arcoLivre}
                      transform="rotate(-90 55 55)"
                      className="donut-segment"
                    />
                  </svg>
                  <div className="preview-donut-center">
                    <span>Livre</span>
                    <strong className="positive">{exemplo.pctLivre}%</strong>
                  </div>
                </div>

                <div className="preview-bars-col">
                  <div className="preview-stacked-bar">
                    <div
                      className="stacked-segment"
                      style={{
                        width: `${exemplo.pctLivre}%`,
                        backgroundColor: '#16a34a',
                      }}
                    />
                    <div
                      className="stacked-segment"
                      style={{
                        width: `${exemplo.pctDividas}%`,
                        backgroundColor: '#dc2626',
                      }}
                    />
                  </div>

                  <div className="preview-legend">
                    <div className="preview-legend-row">
                      <span>
                        <i className="legend-dot" style={{ backgroundColor: '#16a34a' }} />
                        Fica com você
                      </span>
                      <strong>{exemplo.pctLivre}%</strong>
                    </div>
                    <div className="preview-legend-row">
                      <span>
                        <i className="legend-dot" style={{ backgroundColor: '#dc2626' }} />
                        Vai para dívidas
                      </span>
                      <strong>{exemplo.pctDividas}%</strong>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 3 Passos (Como funciona) */}
        <section id="como-funciona" className="landing-steps">
          {PASSOS.map((passo) => (
            <article key={passo.numero} className="landing-step-card">
              <div className="landing-step-top">
                <span className="landing-step-icon">{passo.icone}</span>
                <span className="landing-step-num">{passo.numero}</span>
              </div>
              <h2>{passo.titulo}</h2>
              <p>{passo.descricao}</p>
            </article>
          ))}
        </section>
      </main>
    </div>
  );
}
