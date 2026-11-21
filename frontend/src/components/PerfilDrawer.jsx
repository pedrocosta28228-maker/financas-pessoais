import { useEffect } from 'react';

export function obterIniciais(nome = '') {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return '?';
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return `${partes[0][0]}${partes[partes.length - 1][0]}`.toUpperCase();
}

/**
 * Gaveta lateral de Perfil (abre pela direita ao clicar no nome/avatar no topo).
 * Reúne um resumo rápido, acesso a "Minha conta", "Ajuda" e "Sair da conta".
 */
export default function PerfilDrawer({
  aberto,
  usuario,
  qtdContas,
  qtdMetas,
  qtdLancamentos,
  secaoAtiva,
  onFechar,
  onAbrirMinhaConta,
  onAbrirAjuda,
  onSair,
}) {
  useEffect(() => {
    if (!aberto) return;
    function onKeyDown(e) {
      if (e.key === 'Escape') onFechar();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [aberto, onFechar]);

  if (!aberto) return null;

  const corAvatar = usuario.avatarCor || '#0052d4';
  const iniciais = obterIniciais(usuario.nome);

  return (
    <div className="drawer-backdrop" onClick={onFechar}>
      <aside
        className="profile-drawer"
        onClick={(e) => e.stopPropagation()}
        aria-label="Menu do perfil"
      >
        <div className="drawer-top-bar">
          <button
            type="button"
            className="modal-close"
            onClick={onFechar}
            aria-label="Fechar perfil"
          >
            ×
          </button>
        </div>

        {/* Cabeçalho do usuário */}
        <div className="drawer-user-header">
          <div
            className="avatar-circle large"
            style={{
              backgroundColor: corAvatar,
              boxShadow: `0 0 0 3px var(--surface), 0 0 0 5px ${corAvatar}55`,
            }}
          >
            {iniciais}
          </div>
          <div className="drawer-user-info">
            <strong>{usuario.nome}</strong>
            <span>{usuario.email}</span>
          </div>
        </div>

        {/* 3 mini-cards com a identidade do Minhas Finanças */}
        <div className="drawer-stats">
          <div className="drawer-stat-card">
            <span className="drawer-stat-icon blue">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="2" y="5" width="20" height="14" rx="2.5" />
                <path d="M16 12h.01" />
              </svg>
            </span>
            <div>
              <strong>{qtdContas}</strong>
              <span>{qtdContas === 1 ? 'Carteira' : 'Carteiras'}</span>
            </div>
          </div>

          <div className="drawer-stat-card">
            <span className="drawer-stat-icon green">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="9" />
                <circle cx="12" cy="12" r="4.5" />
                <circle cx="12" cy="12" r="1.2" />
              </svg>
            </span>
            <div>
              <strong>{qtdMetas}</strong>
              <span>{qtdMetas === 1 ? 'Meta' : 'Metas'}</span>
            </div>
          </div>

          <div className="drawer-stat-card">
            <span className="drawer-stat-icon purple">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M8 6h13" />
                <path d="M8 12h13" />
                <path d="M8 18h13" />
                <path d="M3 6h.01" />
                <path d="M3 12h.01" />
                <path d="M3 18h.01" />
              </svg>
            </span>
            <div>
              <strong>{qtdLancamentos}</strong>
              <span>Registros</span>
            </div>
          </div>
        </div>

        <hr className="drawer-divider" />

        {/* Itens de navegação */}
        <nav className="drawer-menu">
          <button
            type="button"
            className={
              secaoAtiva === 'minha_conta'
                ? 'drawer-menu-item active'
                : 'drawer-menu-item'
            }
            onClick={() => {
              onFechar();
              onAbrirMinhaConta();
            }}
          >
            <span className="drawer-menu-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
            </span>
            <span className="drawer-menu-label">Minha conta</span>
            <svg
              className="drawer-chevron"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="m9 18 6-6-6-6" />
            </svg>
          </button>

          <button
            type="button"
            className={
              secaoAtiva === 'ajuda' ? 'drawer-menu-item active' : 'drawer-menu-item'
            }
            onClick={() => {
              onFechar();
              onAbrirAjuda();
            }}
          >
            <span className="drawer-menu-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                <path d="M12 17h.01" />
              </svg>
            </span>
            <span className="drawer-menu-label">Ajuda</span>
            <svg
              className="drawer-chevron"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="m9 18 6-6-6-6" />
            </svg>
          </button>
        </nav>

        <hr className="drawer-divider" />

        {/* Sair da conta */}
        <button
          type="button"
          className="drawer-logout"
          onClick={() => {
            onFechar();
            onSair();
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
          <span>Sair da conta</span>
        </button>
      </aside>
    </div>
  );
}
