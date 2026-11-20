import { useEffect, useRef, useState } from 'react';

/**
 * Ícone minimalista "?" (bolinha com interrogação).
 * Mostra uma explicação curta ao passar o mouse ou clicar, mantendo a tela limpa.
 */
export default function InfoTip({ texto, alinhamento = 'center' }) {
  const [abertoPorClique, setAbertoPorClique] = useState(false);
  const [hover, setHover] = useState(false);
  const containerRef = useRef(null);

  const visivel = abertoPorClique || hover;

  useEffect(() => {
    if (!abertoPorClique) return;

    function handleClickFora(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setAbertoPorClique(false);
      }
    }
    function handleKeyDown(e) {
      if (e.key === 'Escape') setAbertoPorClique(false);
    }

    document.addEventListener('mousedown', handleClickFora);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickFora);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [abertoPorClique]);

  return (
    <span
      ref={containerRef}
      className="info-tip"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <button
        type="button"
        className={visivel ? 'info-tip-btn active' : 'info-tip-btn'}
        onClick={(e) => {
          e.stopPropagation();
          setAbertoPorClique((v) => !v);
        }}
        aria-label={texto}
        aria-expanded={visivel}
      >
        ?
      </button>

      {visivel && (
        <span
          role="tooltip"
          className={`info-tip-popover align-${alinhamento}`}
        >
          {texto}
        </span>
      )}
    </span>
  );
}
