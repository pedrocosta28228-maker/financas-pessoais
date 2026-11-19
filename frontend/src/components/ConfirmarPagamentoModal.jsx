import { useEffect, useState } from 'react';
import { api } from '../api.js';

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
 * Modal de confirmação ao pagar / adiantar uma parcela ou conta pendente.
 * Permite escolher se o valor sai do saldo atual (subtraindo do total que você tem hoje)
 * ou se foi pago por fora (sem mexer no saldo atual).
 */
export default function ConfirmarPagamentoModal({
  item,
  saldoAtual,
  onFechar,
  onConfirmado,
}) {
  const [descontarSaldo, setDescontarSaldo] = useState(true);
  const [valorPago, setValorPago] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  useEffect(() => {
    if (!item) return;
    setDescontarSaldo(true);
    setValorPago(String(item.valor));
    setErro('');
  }, [item]);

  useEffect(() => {
    if (!item) return;
    function onKeyDown(e) {
      if (e.key === 'Escape') onFechar();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [item, onFechar]);

  if (!item) return null;

  const valorNum = Number(String(valorPago).replace(',', '.'));
  const valorValido = Number.isFinite(valorNum) && valorNum > 0;
  const novoSaldo = saldoAtual - (valorValido ? valorNum : item.valor);

  async function handleConfirmar(e) {
    e.preventDefault();
    if (!valorValido) {
      setErro('Informe um valor válido maior que zero.');
      return;
    }

    setErro('');
    setSalvando(true);
    try {
      await api.atualizarStatus(item.id, 'pago', {
        descontarSaldo,
        valor: valorNum,
      });
      await onConfirmado();
      onFechar();
    } catch (err) {
      setErro(err.message);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onFechar}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2>Confirmar pagamento</h2>
            <p className="modal-subtitle">
              {item.titulo} • Vencimento {formatarData(item.data)}
            </p>
          </div>
          <button
            type="button"
            className="modal-close"
            onClick={onFechar}
            aria-label="Fechar"
          >
            ×
          </button>
        </div>

        <form onSubmit={handleConfirmar} className="entry-form">
          <label className="field">
            <span>Valor pago (R$) — pode ajustar se teve desconto ao adiantar</span>
            <input
              type="number"
              step="0.01"
              min="0.01"
              value={valorPago}
              onChange={(e) => setValorPago(e.target.value)}
              required
            />
          </label>

          <div className="pay-choices">
            <button
              type="button"
              className={descontarSaldo ? 'pay-choice active' : 'pay-choice'}
              onClick={() => setDescontarSaldo(true)}
            >
              <div className="pay-choice-top">
                <strong>Usar o dinheiro que tenho hoje</strong>
                <span className="pay-tag descontar">Abate do saldo</span>
              </div>
              <p className="pay-choice-desc">
                Ideal para pagar ou adiantar usando o total que está aqui. Seu saldo
                atual vai de <strong>{formatarMoeda(saldoAtual)}</strong> para{' '}
                <strong className={novoSaldo >= 0 ? 'positive' : 'negative'}>
                  {formatarMoeda(novoSaldo)}
                </strong>
                .
              </p>
            </button>

            <button
              type="button"
              className={!descontarSaldo ? 'pay-choice active' : 'pay-choice'}
              onClick={() => setDescontarSaldo(false)}
            >
              <div className="pay-choice-top">
                <strong>Pago por fora (não descontar)</strong>
                <span className="pay-tag fora">Mantém saldo</span>
              </div>
              <p className="pay-choice-desc">
                Dá baixa na dívida/conta sem subtrair do valor cadastrado aqui. Seu
                saldo continua em <strong>{formatarMoeda(saldoAtual)}</strong>.
              </p>
            </button>
          </div>

          <p className="pay-tip">
            Pode testar tranquilo: se marcar errado, basta clicar em{' '}
            <strong>Desfazer pago</strong> depois que tudo volta ao normal!
          </p>

          {erro && <div className="alert-error">{erro}</div>}

          <div className="modal-actions">
            <button type="button" className="btn-outline" onClick={onFechar}>
              Cancelar
            </button>
            <button type="submit" className="btn-primary" disabled={salvando}>
              {salvando ? 'Confirmando...' : 'Confirmar pagamento'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
