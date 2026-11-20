import { useEffect, useState } from 'react';
import { api } from '../api.js';

const CORES_CARTEIRA = [
  '#3b82f6', // Azul
  '#22c55e', // Verde
  '#a855f7', // Roxo
  '#f59e0b', // Âmbar
  '#ec4899', // Rosa
  '#14b8a6', // Turquesa
];

function formatarMoeda(valor) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(valor || 0);
}

/**
 * Seção "Onde está meu dinheiro (Carteiras)" na aba Entradas.
 * Permite criar carteiras (ex.: RecargaPay, Cofrinho, Uso diário) com etiqueta livre
 * e transferir dinheiro entre elas sem alterar o Saldo Total.
 */
export default function ContasSection({ contas, saldoSemConta, onAtualizar }) {
  // Modal criar/editar carteira
  const [modalContaAberto, setModalContaAberto] = useState(false);
  const [contaEditando, setContaEditando] = useState(null);
  const [nome, setNome] = useState('');
  const [etiqueta, setEtiqueta] = useState('');
  const [rendimento, setRendimento] = useState('');
  const [cor, setCor] = useState(CORES_CARTEIRA[0]);
  const [salvandoConta, setSalvandoConta] = useState(false);
  const [erroConta, setErroConta] = useState('');

  // Modal transferir entre carteiras
  const [modalTransfAberto, setModalTransfAberto] = useState(false);
  const [origemId, setOrigemId] = useState('');
  const [destinoId, setDestinoId] = useState('');
  const [valorTransf, setValorTransf] = useState('');
  const [salvandoTransf, setSalvandoTransf] = useState(false);
  const [erroTransf, setErroTransf] = useState('');

  // Modal confirmar exclusão de carteira
  const [contaExcluindo, setContaExcluindo] = useState(null);
  const [excluindoConta, setExcluindoConta] = useState(false);
  const [erroExclusao, setErroExclusao] = useState('');

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key !== 'Escape') return;
      if (modalContaAberto && !salvandoConta) setModalContaAberto(false);
      if (modalTransfAberto && !salvandoTransf) setModalTransfAberto(false);
      if (contaExcluindo && !excluindoConta) setContaExcluindo(null);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    modalContaAberto,
    salvandoConta,
    modalTransfAberto,
    salvandoTransf,
    contaExcluindo,
    excluindoConta,
  ]);

  function abrirNovaConta() {
    setContaEditando(null);
    setNome('');
    setEtiqueta('');
    setRendimento('');
    setCor(CORES_CARTEIRA[contas.length % CORES_CARTEIRA.length]);
    setErroConta('');
    setModalContaAberto(true);
  }

  function abrirEditarConta(conta) {
    setContaEditando(conta);
    setNome(conta.nome);
    setEtiqueta(conta.etiqueta || '');
    setRendimento(conta.rendimento || '');
    setCor(conta.cor || CORES_CARTEIRA[0]);
    setErroConta('');
    setModalContaAberto(true);
  }

  async function handleSalvarConta(e) {
    e.preventDefault();
    setErroConta('');
    setSalvandoConta(true);
    try {
      if (contaEditando) {
        await api.atualizarConta(contaEditando.id, { nome, etiqueta, rendimento, cor });
      } else {
        await api.criarConta({ nome, etiqueta, rendimento, cor });
      }
      await onAtualizar();
      setModalContaAberto(false);
    } catch (err) {
      setErroConta(err.message);
    } finally {
      setSalvandoConta(false);
    }
  }

  function abrirTransferencia() {
    setOrigemId(String(contas[0]?.id || ''));
    setDestinoId(String(contas[1]?.id || ''));
    setValorTransf('');
    setErroTransf('');
    setModalTransfAberto(true);
  }

  async function handleTransferir(e) {
    e.preventDefault();
    setErroTransf('');
    setSalvandoTransf(true);
    try {
      const valorNum = Number(String(valorTransf).replace(',', '.'));
      await api.transferirEntreContas(Number(origemId), Number(destinoId), valorNum);
      await onAtualizar();
      setModalTransfAberto(false);
    } catch (err) {
      setErroTransf(err.message);
    } finally {
      setSalvandoTransf(false);
    }
  }

  async function handleExcluirConta() {
    if (!contaExcluindo) return;
    setErroExclusao('');
    setExcluindoConta(true);
    try {
      await api.excluirConta(contaExcluindo.id);
      await onAtualizar();
      setContaExcluindo(null);
    } catch (err) {
      setErroExclusao(err.message);
    } finally {
      setExcluindoConta(false);
    }
  }

  return (
    <section className="panel wallets-panel">
      <div className="wallets-header">
        <div>
          <h2>Onde está meu dinheiro (Carteiras)</h2>
          <span className="chart-subtitle">
            Separe quanto está em cada banco, cofrinho ou uso diário — e mova valores entre elas sem alterar o Saldo Total
          </span>
        </div>

        <div className="wallets-actions">
          {contas.length >= 2 && (
            <button
              type="button"
              className="btn-transfer"
              onClick={abrirTransferencia}
            >
              ⇄ Transferir
            </button>
          )}
          <button
            type="button"
            className="btn-small-primary"
            onClick={abrirNovaConta}
          >
            + Nova carteira
          </button>
        </div>
      </div>

      {contas.length === 0 ? (
        <div className="wallets-empty">
          <p>
            Você ainda não cadastrou nenhuma carteira. Crie lugares como{' '}
            <strong>Uso diário</strong>, <strong>Cofrinho</strong> ou{' '}
            <strong>RecargaPay</strong> para saber exatamente onde cada valor está guardado!
          </p>
        </div>
      ) : (
        <div className="wallets-grid">
          {contas.map((conta) => (
            <div
              key={conta.id}
              className="wallet-card"
              style={{ borderLeftColor: conta.cor }}
            >
              <div className="wallet-top">
                <div className="wallet-title-group">
                  <span
                    className="wallet-dot"
                    style={{ backgroundColor: conta.cor }}
                  />
                  <strong>{conta.nome}</strong>
                </div>
                {conta.etiqueta && (
                  <span className="wallet-tag">{conta.etiqueta}</span>
                )}
              </div>

              <strong
                className={`wallet-balance ${conta.saldo >= 0 ? 'positive' : 'negative'}`}
              >
                {formatarMoeda(conta.saldo)}
              </strong>

              {conta.rendimento && (
                <div className="wallet-yield">
                  <span>↗ Rendendo {conta.rendimento}</span>
                </div>
              )}

              <div className="wallet-footer">
                <button
                  type="button"
                  className="btn-link"
                  onClick={() => abrirEditarConta(conta)}
                >
                  Editar
                </button>
                <button
                  type="button"
                  className="btn-link danger"
                  onClick={() => {
                    setErroExclusao('');
                    setContaExcluindo(conta);
                  }}
                >
                  Excluir
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {contas.length > 0 && Math.abs(saldoSemConta) > 0.009 && (
        <div className="unassigned-note">
          <span>
            Ainda existem <strong>{formatarMoeda(saldoSemConta)}</strong> em lançamentos sem carteira vinculada. Você pode clicar em <strong>Editar</strong> nas entradas abaixo para escolher em qual carteira esse dinheiro está!
          </span>
        </div>
      )}

      {/* Modal Criar / Editar Carteira */}
      {modalContaAberto && (
        <div
          className="modal-backdrop"
          onClick={() => !salvandoConta && setModalContaAberto(false)}
        >
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2>{contaEditando ? 'Editar carteira' : 'Nova carteira'}</h2>
                <p className="modal-subtitle">
                  Ex.: RecargaPay, Cofrinho Nubank, Uso diário (Pix)
                </p>
              </div>
              <button
                type="button"
                className="modal-close"
                onClick={() => setModalContaAberto(false)}
              >
                ×
              </button>
            </div>

            <form onSubmit={handleSalvarConta} className="entry-form">
              <label className="field">
                <span>Nome da carteira</span>
                <input
                  type="text"
                  placeholder="Ex.: RecargaPay, Cofrinho, Uso diário..."
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  autoFocus
                  required
                />
              </label>

              <label className="field">
                <span>Etiqueta (opcional)</span>
                <input
                  type="text"
                  placeholder="Ex.: Reserva de emergência, Cofrinho, Pix diário..."
                  value={etiqueta}
                  onChange={(e) => setEtiqueta(e.target.value)}
                />
              </label>

              <div className="field">
                <div className="day-header">
                  <span>Quanto está rendendo? (opcional)</span>
                  <div className="day-presets">
                    {['100% CDI', '102% CDI', '110% CDI'].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        className={
                          rendimento === preset ? 'preset-btn active' : 'preset-btn'
                        }
                        onClick={() =>
                          setRendimento(rendimento === preset ? '' : preset)
                        }
                      >
                        {preset}
                      </button>
                    ))}
                  </div>
                </div>
                <input
                  type="text"
                  placeholder="Deixe vazio se não render — ou escreva ex.: 110% CDI, 1% ao mês"
                  value={rendimento}
                  onChange={(e) => setRendimento(e.target.value)}
                />
              </div>

              <div className="field">
                <span>Cor de identificação</span>
                <div className="color-picker">
                  {CORES_CARTEIRA.map((c) => (
                    <button
                      key={c}
                      type="button"
                      className={cor === c ? 'color-dot active' : 'color-dot'}
                      style={{ backgroundColor: c }}
                      onClick={() => setCor(c)}
                      aria-label={`Cor ${c}`}
                    />
                  ))}
                </div>
              </div>

              {erroConta && <div className="alert-error">{erroConta}</div>}

              <div className="modal-actions">
                <button
                  type="button"
                  className="btn-outline"
                  onClick={() => setModalContaAberto(false)}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={salvandoConta}
                >
                  {salvandoConta
                    ? 'Salvando...'
                    : contaEditando
                      ? 'Salvar alterações'
                      : 'Criar carteira'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Transferir entre Carteiras */}
      {modalTransfAberto && (
        <div
          className="modal-backdrop"
          onClick={() => !salvandoTransf && setModalTransfAberto(false)}
        >
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2>Transferir entre carteiras</h2>
                <p className="modal-subtitle">
                  Move o dinheiro de um lugar para outro sem alterar seu Saldo Total
                </p>
              </div>
              <button
                type="button"
                className="modal-close"
                onClick={() => setModalTransfAberto(false)}
              >
                ×
              </button>
            </div>

            <form onSubmit={handleTransferir} className="entry-form">
              <div className="field-row">
                <label className="field">
                  <span>Tirar de</span>
                  <select
                    value={origemId}
                    onChange={(e) => setOrigemId(e.target.value)}
                    required
                  >
                    {contas.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nome} ({formatarMoeda(c.saldo)})
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field">
                  <span>Colocar em</span>
                  <select
                    value={destinoId}
                    onChange={(e) => setDestinoId(e.target.value)}
                    required
                  >
                    {contas.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nome} ({formatarMoeda(c.saldo)})
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="field">
                <span>Valor da transferência (R$)</span>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  placeholder="0,00"
                  value={valorTransf}
                  onChange={(e) => setValorTransf(e.target.value)}
                  autoFocus
                  required
                />
              </label>

              {erroTransf && <div className="alert-error">{erroTransf}</div>}

              <div className="modal-actions">
                <button
                  type="button"
                  className="btn-outline"
                  onClick={() => setModalTransfAberto(false)}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={salvandoTransf}
                >
                  {salvandoTransf ? 'Transferindo...' : 'Confirmar transferência'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Confirmar Exclusão de Carteira */}
      {contaExcluindo && (
        <div
          className="modal-backdrop"
          onClick={() => !excluindoConta && setContaExcluindo(null)}
        >
          <div className="modal-card modal-danger" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2>Excluir esta carteira?</h2>
                <p className="modal-subtitle">
                  Seus lançamentos não serão apagados — apenas ficarão sem carteira vinculada.
                </p>
              </div>
              <button
                type="button"
                className="modal-close"
                onClick={() => setContaExcluindo(null)}
              >
                ×
              </button>
            </div>

            <div className="delete-summary">
              <div className="delete-summary-top">
                <span className="wallet-tag">{contaExcluindo.etiqueta || 'Carteira'}</span>
                <strong>{formatarMoeda(contaExcluindo.saldo)}</strong>
              </div>
              <div className="delete-summary-name">{contaExcluindo.nome}</div>
            </div>

            {erroExclusao && <div className="alert-error">{erroExclusao}</div>}

            <div className="modal-actions">
              <button
                type="button"
                className="btn-outline"
                onClick={() => setContaExcluindo(null)}
                disabled={excluindoConta}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn-danger"
                onClick={handleExcluirConta}
                disabled={excluindoConta}
              >
                {excluindoConta ? 'Excluindo...' : 'Sim, excluir carteira'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
