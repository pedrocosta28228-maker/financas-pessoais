/**
 * Barra lateral de navegação (Sidebar) com modo recolhido/expandido
 * e notificação de novas dívidas (some ao abrir a aba Dívidas).
 */
const ITENS_MENU = [
  {
    id: 'visao_geral',
    label: 'Visão Geral',
    icone: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </svg>
    ),
  },
  {
    id: 'entradas',
    label: 'Entradas',
    icone: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 19V5" />
        <path d="m5 12 7-7 7 7" />
      </svg>
    ),
  },
  {
    id: 'dividas',
    label: 'Dívidas',
    icone: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="2" y="5" width="20" height="14" rx="2" />
        <path d="M2 10h20" />
      </svg>
    ),
  },
  {
    id: 'saidas',
    label: 'Saídas',
    icone: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 5v14" />
        <path d="m19 12-7 7-7-7" />
      </svg>
    ),
  },
  {
    id: 'estatisticas',
    label: 'Estatísticas',
    icone: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M3 3v18h18" />
        <path d="m7 14 4-4 4 3 5-6" />
      </svg>
    ),
  },
  {
    id: 'metas',
    label: 'Metas',
    icone: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="9" />
        <circle cx="12" cy="12" r="5" />
        <circle cx="12" cy="12" r="1.5" />
      </svg>
    ),
  },
];

export default function Sidebar({
  secaoAtiva,
  onTrocarSecao,
  novasDividas,
  recolhida,
  onAlternarRecolhida,
}) {
  return (
    <aside className={recolhida ? 'sidebar collapsed' : 'sidebar'}>
      <div className="sidebar-top">
        {!recolhida && (
          <div className="sidebar-brand">
            <div className="logo-badge small">R$</div>
            <div className="sidebar-brand-text">
              <h1>Minhas Finanças</h1>
            </div>
          </div>
        )}

        <button
          type="button"
          className="sidebar-toggle"
          onClick={onAlternarRecolhida}
          title={recolhida ? 'Expandir barra lateral' : 'Recolher barra lateral'}
          aria-label={recolhida ? 'Expandir barra lateral' : 'Recolher barra lateral'}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            {recolhida ? (
              <path d="m9 18 6-6-6-6" />
            ) : (
              <path d="m15 18-6-6 6-6" />
            )}
          </svg>
        </button>
      </div>

      <nav className="sidebar-nav" aria-label="Menu principal">
        {ITENS_MENU.map((item) => {
          const ativo = secaoAtiva === item.id;
          const mostrarNotificacao = item.id === 'dividas' && novasDividas > 0;

          return (
            <button
              key={item.id}
              type="button"
              className={ativo ? 'nav-item active' : 'nav-item'}
              onClick={() => onTrocarSecao(item.id)}
              title={recolhida ? item.label : undefined}
            >
              <span className="nav-icon">
                {item.icone}
                {recolhida && mostrarNotificacao && (
                  <span className="nav-dot" aria-hidden="true" />
                )}
              </span>

              {!recolhida && <span className="nav-label">{item.label}</span>}

              {!recolhida && mostrarNotificacao && (
                <span className="nav-badge">{novasDividas}</span>
              )}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
