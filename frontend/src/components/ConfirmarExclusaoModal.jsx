import { useEffect, useState } from 'react';

function formatarMoeda(valor) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(valor || 0);
}

function formatarData(dataIso) {
  if (!dataIso) return '';
  const [ano, mes, dia] = dataIso.split('-');
  return `${dia}/${mes}/${ano}`;
}

/**
 * Modal de confirmação de exclusão integrado ao visual do app.
 * Recebe "alvo" com { modo: 'unico', item } ou { modo: 'grupo', grupo }.
 */
export default function ConfirmarExclusaoModal({ alvo, onFechar, onConfirmar }) {
  const [excluindo, setExcluindo] = useState(false);
  const [erro, setErro] = useState('');

  useEffect(() => {
    if (!alvo) return;
    setErro('');
    setExcluindo(false);

    function onKeyDown(e) {
      if (e.key === 'Escape' && !excluindo) onFechar();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [alvo, excluindo, onFechar]);

  if (!alvo) return null;

  const ehGrupo = alvo.modo === 'grupo';
  const tituloTexto = ehGrupo
    ? `Excluir todas as ${alvo.grupo.qtdTotal} parcelas?`
    : alvo.item.tipo === 'entrada'
      ? 'Excluir esta entrada?'
      : alvo.item.tipo === 'divida'
        ? 'Excluir esta dívida?'
        : 'Excluir esta saída?';

  const nomeRegistro = ehGrupo ? alvo.grupo.nomeBase : alvo.item.titulo;
  const valorRegistro = ehGrupo ? alvo.grupo.valorTotal : alvo.item.valor;
  const tipoRegistro = ehGrupo ? 'divida' : alvo.item.tipo;

  async function handleConfirmar() {
    setErro('');
    setExcluindo(true);
    try {
      await onConfirmar(alvo);
      onFechar();
    } catch (err) {
      setErro(err.message || 'Erro ao excluir.');
      setExcluindo(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={() => !excluindo && onFechar()}>
      <div className="modal-card modal-danger" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2>{tituloTexto}</h2>
            <p className="modal-subtitle">
              Essa ação não pode ser desfeita depois de confirmada.
            </p>
          </div>
          <button
            type="button"
            className="modal-close"
            onClick={onFechar}
            disabled={excluindo}
            aria-label="Fechar"
          >
            ×
          </button>
        </div>

        <div className="delete-summary">
          <div className="delete-summary-top">
            <span className={`badge ${tipoRegistro}`}>
              {ehGrupo
                ? `Dívida (${alvo.grupo.qtdTotal}x)`
                : tipoRegistro === 'entrada'
                  ? 'Entrada'
                  : tipoRegistro === 'divida'
                    ? 'Dívida'
                    : 'Saída'}
            </span>
            <strong
              className={tipoRegistro === 'entrada' ? 'positive' : 'negative'}
            >
              {tipoRegistro === 'entrada' ? '+' : '-'}{' '}
              {formatarMoeda(valorRegistro)}
            </strong>
          </div>

          <div className="delete-summary-name">{nomeRegistro}</div>

          <div className="delete-summary-meta">
            {ehGrupo ? (
              <span>
                Serão removidas todas as <strong>{alvo.grupo.qtdTotal} parcelas</strong>{' '}
                ({alvo.grupo.qtdPagas} pagas e {alvo.grupo.qtdPendentes} pendentes) em{' '}
                {alvo.grupo.categoria}.
              </span>
            ) : (
              <span>
                {alvo.item.categoria} • {formatarData(alvo.item.data)} •{' '}
                {alvo.item.status === 'pago'
                  ? tipoRegistro === 'entrada'
                    ? 'Recebido'
                    : 'Pago'
                  : 'Pendente'}
              </span>
            )}
          </div>
        </div>

        {erro && <div className="alert-error">{erro}</div>}

        <div className="modal-actions">
          <button
            type="button"
            className="btn-outline"
            onClick={onFechar}
            disabled={excluindo}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="btn-danger"
            onClick={handleConfirmar}
            disabled={excluindo}
          >
            {excluindo
              ? 'Excluindo...'
              : ehGrupo
                ? `Sim, excluir ${alvo.grupo.qtdTotal} parcelas`
                : 'Sim, excluir'}
          </button>
        </div>
      </div>
    </div>
  );
}
