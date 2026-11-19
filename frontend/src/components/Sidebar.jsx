/**
 * Barra lateral de navegação (Sidebar).
 * Separa o app em abas organizadas mantendo a Visão Geral limpa.
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
  usuario,
  secaoAtiva,
  onTrocarSecao,
  contadores,
  onSair,
}) {
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="logo-badge small">R$</div>
        <div className="sidebar-brand-text">
          <h1>Minhas Finanças</h1>
          <span className="greeting">Olá, {usuario.nome}</span>
        </div>
      </div>

      <nav className="sidebar-nav" aria-label="Menu principal">
        {ITENS_MENU.map((item) => {
          const ativo = secaoAtiva === item.id;
          const badgeNumero =
            item.id === 'dividas' && contadores.dividasPendentes > 0
              ? contadores.dividasPendentes
              : null;

          return (
            <button
              key={item.id}
              type="button"
              className={ativo ? 'nav-item active' : 'nav-item'}
              onClick={() => onTrocarSecao(item.id)}
            >
              <span className="nav-icon">{item.icone}</span>
              <span className="nav-label">{item.label}</span>
              {badgeNumero !== null && (
                <span className="nav-badge">{badgeNumero}</span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        <button type="button" className="btn-logout" onClick={onSair}>
          Sair da conta
        </button>
      </div>
    </aside>
  );
}
