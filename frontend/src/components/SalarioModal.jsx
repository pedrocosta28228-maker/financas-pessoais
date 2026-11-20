import { useEffect, useState } from 'react';
import { api } from '../api.js';

function formatarMoeda(valor) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(valor || 0);
}

/**
 * Modal de Salário Fixo recorrente com 2 modos:
 * - 'configurar': definir ou editar valor fixo, dia do mês e carteira padrão
 * - 'receber': registrar o salário daquele mês (permitindo editar valor se teve hora extra!)
 */
export default function SalarioModal({
  modo, // null | 'configurar' | 'receber'
  salario,
  proximo,
  contas = [],
  onFechar,
  onAtualizado,
}) {
  const [valor, setValor] = useState('');
  const [diaPagamento, setDiaPagamento] = useState('5');
  const [contaId, setContaId] = useState('');
  const [tituloRecebimento, setTituloRecebimento] = useState('');
  const [dataRecebimento, setDataRecebimento] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  useEffect(() => {
    if (!modo) return;
    setErro('');

    if (modo === 'configurar') {
      setValor(salario ? String(salario.valor) : '');
      setDiaPagamento(salario ? String(salario.diaPagamento) : '5');
      setContaId(salario?.contaId ? String(salario.contaId) : '');
    } else if (modo === 'receber' && proximo) {
      setTituloRecebimento(proximo.titulo);
      setValor(String(proximo.valor));
      setDataRecebimento(proximo.dataIso);
      setContaId(proximo.contaId ? String(proximo.contaId) : '');
    }
  }, [modo, salario, proximo]);

  useEffect(() => {
    if (!modo) return;
    function onKeyDown(e) {
      if (e.key === 'Escape' && !salvando) onFechar();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [modo, salvando, onFechar]);

  if (!modo) return null;

  async function handleSalvarConfig(e) {
    e.preventDefault();
    setErro('');
    setSalvando(true);
    try {
      const valorNum = Number(String(valor).replace(',', '.'));
      await api.salvarSalario({
        valor: valorNum,
        diaPagamento: Number(diaPagamento),
        contaId: contaId ? Number(contaId) : null,
      });
      await onAtualizado();
      onFechar();
    } catch (err) {
      setErro(err.message);
    } finally {
      setSalvando(false);
    }
  }

  async function handleRemoverSalario() {
    setErro('');
    setSalvando(true);
    try {
      await api.removerSalario();
      await onAtualizado();
      onFechar();
    } catch (err) {
      setErro(err.message);
    } finally {
      setSalvando(false);
    }
  }

  async function handleRegistrarRecebimento(e) {
    e.preventDefault();
    setErro('');
    setSalvando(true);
    try {
      const valorNum = Number(String(valor).replace(',', '.'));
      await api.criarLancamento({
        titulo: tituloRecebimento.trim() || proximo.titulo,
        valor: valorNum,
        tipo: 'entrada',
        categoria: 'Salário',
        data: dataRecebimento,
        status: 'pago',
        contaId: contaId ? Number(contaId) : null,
      });
      await onAtualizado();
      onFechar();
    } catch (err) {
      setErro(err.message);
    } finally {
      setSalvando(false);
    }
  }

  if (modo === 'receber' && proximo) {
    return (
      <div className="modal-backdrop" onClick={() => !salvando && onFechar()}>
        <div className="modal-card" onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">
            <div>
              <h2>Registrar recebimento</h2>
              <p className="modal-subtitle">
                Caiu com hora extra ou valor diferente? Pode ajustar aqui antes de lançar!
              </p>
            </div>
            <button
              type="button"
              className="modal-close"
              onClick={onFechar}
              disabled={salvando}
            >
              ×
            </button>
          </div>

          <form onSubmit={handleRegistrarRecebimento} className="entry-form">
            <label className="field">
              <span>Descrição</span>
              <input
                type="text"
                value={tituloRecebimento}
                onChange={(e) => setTituloRecebimento(e.target.value)}
                required
              />
            </label>

            <div className="field-row">
              <label className="field">
                <span>Valor recebido (R$)</span>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={valor}
                  onChange={(e) => setValor(e.target.value)}
                  autoFocus
                  required
                />
              </label>

              <label className="field">
                <span>Data do recebimento</span>
                <input
                  type="date"
                  value={dataRecebimento}
                  onChange={(e) => setDataRecebimento(e.target.value)}
                  required
                />
              </label>
            </div>

            {contas.length > 0 && (
              <label className="field">
                <span>Carteira onde o salário caiu (opcional)</span>
                <select
                  value={contaId}
                  onChange={(e) => setContaId(e.target.value)}
                >
                  <option value="">Sem carteira específica</option>
                  {contas.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nome} ({formatarMoeda(c.saldo)})
                    </option>
                  ))}
                </select>
              </label>
            )}

            {erro && <div className="alert-error">{erro}</div>}

            <div className="modal-actions">
              <button
                type="button"
                className="btn-outline"
                onClick={onFechar}
                disabled={salvando}
              >
                Cancelar
              </button>
              <button type="submit" className="btn-primary" disabled={salvando}>
                {salvando ? 'Lançando...' : 'Confirmar recebimento'}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-backdrop" onClick={() => !salvando && onFechar()}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2>{salario ? 'Editar salário fixo' : 'Adicionar salário fixo'}</h2>
            <p className="modal-subtitle">
              Todo mês o card &ldquo;Previsto para Entrar&rdquo; vai mostrar automaticamente o próximo salário a cair.
            </p>
          </div>
          <button
            type="button"
            className="modal-close"
            onClick={onFechar}
            disabled={salvando}
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSalvarConfig} className="entry-form">
          <label className="field">
            <span>Valor do salário mensal (R$)</span>
            <input
              type="number"
              step="0.01"
              min="0.01"
              placeholder="Ex.: 2000,00"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              autoFocus
              required
            />
          </label>

          <div className="field">
            <div className="day-header">
              <span>Dia do mês que cai o salário</span>
              <div className="day-presets">
                {[5, 10, 15, 25, 30].map((d) => (
                  <button
                    key={d}
                    type="button"
                    className={
                      Number(diaPagamento) === d ? 'preset-btn active' : 'preset-btn'
                    }
                    onClick={() => setDiaPagamento(String(d))}
                  >
                    Dia {d}
                  </button>
                ))}
              </div>
            </div>
            <input
              type="number"
              min="1"
              max="31"
              value={diaPagamento}
              onChange={(e) => setDiaPagamento(e.target.value)}
              required
            />
          </div>

          {contas.length > 0 && (
            <label className="field">
              <span>Carteira padrão onde costuma cair (opcional)</span>
              <select
                value={contaId}
                onChange={(e) => setContaId(e.target.value)}
              >
                <option value="">Sem carteira específica</option>
                {contas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                    {c.etiqueta ? ` (${c.etiqueta})` : ''}
                  </option>
                ))}
              </select>
            </label>
          )}

          {erro && <div className="alert-error">{erro}</div>}

          <div className="modal-actions">
            {salario && (
              <button
                type="button"
                className="btn-delete"
                onClick={handleRemoverSalario}
                disabled={salvando}
              >
                Remover
              </button>
            )}
            <button
              type="button"
              className="btn-outline"
              onClick={onFechar}
              disabled={salvando}
            >
              Cancelar
            </button>
            <button type="submit" className="btn-primary" disabled={salvando}>
              {salvando ? 'Salvando...' : 'Salvar salário'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
