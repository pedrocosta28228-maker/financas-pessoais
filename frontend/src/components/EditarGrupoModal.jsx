import { useEffect, useState } from 'react';
import { api } from '../api.js';

const CATEGORIAS_DIVIDA = [
  'Cartão de crédito',
  'Parcelamento',
  'Empréstimo',
  'Financiamento',
  'Boleto atrasado',
  'Outros',
];

function formatarMoeda(valor) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(valor || 0);
}

function somarMesesPreview(dataIso, mesesParaSomar) {
  if (!dataIso || !/^\d{4}-\d{2}-\d{2}$/.test(dataIso)) return '';
  const [anoOrig, mesOrig, diaOrig] = dataIso.split('-').map(Number);
  const totalMeses = anoOrig * 12 + (mesOrig - 1) + mesesParaSomar;
  const novoAno = Math.floor(totalMeses / 12);
  const novoMes = (totalMeses % 12) + 1;
  const ultimoDia = new Date(novoAno, novoMes, 0).getDate();
  const diaFinal = Math.min(diaOrig, ultimoDia);
  return `${String(diaFinal).padStart(2, '0')}/${String(novoMes).padStart(2, '0')}/${novoAno}`;
}

/**
 * Modal para editar TODAS as parcelas de uma dívida parcelada de uma só vez
 * (descrição, valor de cada parcela, data da 1ª parcela, categoria e cartão/pessoa).
 */
export default function EditarGrupoModal({
  grupo,
  origensSugeridas = [],
  onFechar,
  onSalvo,
}) {
  const [titulo, setTitulo] = useState('');
  const [valorParcela, setValorParcela] = useState('');
  const [dataPrimeira, setDataPrimeira] = useState('');
  const [categoria, setCategoria] = useState('Parcelamento');
  const [origemDivida, setOrigemDivida] = useState('');
  const [manterPagas, setManterPagas] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  useEffect(() => {
    if (!grupo) return;
    setTitulo(grupo.nomeBase || '');
    setValorParcela(String(grupo.valorMensal || ''));
    setDataPrimeira(grupo.parcelas?.[0]?.data || '');
    setCategoria(grupo.categoria || 'Parcelamento');
    setOrigemDivida(grupo.origemDivida || '');
    setManterPagas(grupo.qtdPagas > 0);
    setErro('');
  }, [grupo]);

  useEffect(() => {
    if (!grupo) return;
    function onKeyDown(e) {
      if (e.key === 'Escape' && !salvando) onFechar();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [grupo, salvando, onFechar]);

  if (!grupo) return null;

  const categoriasDisponiveis = CATEGORIAS_DIVIDA.includes(categoria)
    ? CATEGORIAS_DIVIDA
    : [categoria, ...CATEGORIAS_DIVIDA];

  const valorNum = Number(String(valorParcela).replace(',', '.'));
  const primeiraFmt = somarMesesPreview(dataPrimeira, 0);
  const ultimaFmt = somarMesesPreview(dataPrimeira, grupo.qtdTotal - 1);

  async function handleSubmit(e) {
    e.preventDefault();
    setErro('');
    setSalvando(true);
    try {
      await api.atualizarGrupoParcelas(grupo.grupoId, {
        titulo,
        valorParcela: valorNum,
        dataPrimeiraParcela: dataPrimeira,
        categoria,
        origemDivida,
        manterPagas,
      });
      await onSalvo();
      onFechar();
    } catch (err) {
      setErro(err.message);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={() => !salvando && onFechar()}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2>Editar dívida parcelada ({grupo.qtdTotal}x)</h2>
            <p className="modal-subtitle">
              Altera todas as {grupo.qtdTotal} parcelas juntas sem precisar apagar e recriar
            </p>
          </div>
          <button
            type="button"
            className="modal-close"
            onClick={onFechar}
            disabled={salvando}
            aria-label="Fechar"
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="entry-form">
          <label className="field">
            <span>Descrição da dívida</span>
            <input
              type="text"
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              placeholder="Ex.: Celular, Cadeira..."
              autoFocus
              required
            />
          </label>

          <div className="field-row">
            <label className="field">
              <span>Valor de cada parcela (R$)</span>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={valorParcela}
                onChange={(e) => setValorParcela(e.target.value)}
                required
              />
            </label>

            <label className="field">
              <span>Data da 1ª parcela</span>
              <input
                type="date"
                value={dataPrimeira}
                onChange={(e) => setDataPrimeira(e.target.value)}
                required
              />
            </label>
          </div>

          <div className="field-row">
            <label className="field">
              <span>Categoria</span>
              <select
                value={categoria}
                onChange={(e) => setCategoria(e.target.value)}
              >
                {categoriasDisponiveis.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>Cartão / Devo para (opcional)</span>
              <input
                type="text"
                list="origens-grupo-datalist"
                placeholder="Ex.: Nubank, Cartão da mãe..."
                value={origemDivida}
                onChange={(e) => setOrigemDivida(e.target.value)}
              />
              <datalist id="origens-grupo-datalist">
                {origensSugeridas.map((orig) => (
                  <option key={orig} value={orig} />
                ))}
              </datalist>
            </label>
          </div>

          {grupo.qtdPagas > 0 && (
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={manterPagas}
                onChange={(e) => setManterPagas(e.target.checked)}
              />
              <span>
                Manter o valor das {grupo.qtdPagas}{' '}
                {grupo.qtdPagas === 1 ? 'parcela já paga' : 'parcelas já pagas'} intacto
              </span>
            </label>
          )}

          {primeiraFmt && Number.isFinite(valorNum) && valorNum > 0 && (
            <div className="installment-preview">
              <strong>Prévia:</strong> {grupo.qtdTotal}x de{' '}
              <strong>{formatarMoeda(valorNum)}</strong> ({primeiraFmt} até {ultimaFmt})
            </div>
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
              {salvando ? 'Salvando...' : 'Salvar em todas as parcelas'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
