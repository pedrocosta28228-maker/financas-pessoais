import { useEffect, useState } from 'react';
import { api } from '../api.js';

const CATEGORIAS_POR_TIPO = {
  entrada: ['Salário', 'Freelance / Extra', 'Investimentos', 'Reembolso', 'Outros'],
  saida: ['Moradia', 'Alimentação', 'Transporte', 'Contas Fixas', 'Saúde', 'Lazer', 'Outros'],
  divida: ['Cartão de Crédito', 'Empréstimo', 'Parcelamento', 'Financiamento', 'Outros'],
};

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

function hojeIso() {
  const hoje = new Date();
  const ano = hoje.getFullYear();
  const mes = String(hoje.getMonth() + 1).padStart(2, '0');
  const dia = String(hoje.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}

function somarMesesPreview(dataIso, mesesParaSomar) {
  if (!dataIso || !/^\d{4}-\d{2}-\d{2}$/.test(dataIso)) return '';
  const [anoOrig, mesOrig, diaOrig] = dataIso.split('-').map(Number);
  const totalMeses = anoOrig * 12 + (mesOrig - 1) + mesesParaSomar;
  const novoAno = Math.floor(totalMeses / 12);
  const novoMes = (totalMeses % 12) + 1;
  const ultimoDia = new Date(novoAno, novoMes, 0).getDate();
  const diaFinal = Math.min(diaOrig, ultimoDia);
  return `${novoAno}-${String(novoMes).padStart(2, '0')}-${String(diaFinal).padStart(2, '0')}`;
}

/**
 * Modal reutilizável para CRIAR um novo lançamento (inclusive dívida parcelada)
 * ou EDITAR qualquer lançamento existente.
 */
export default function NovoLancamentoModal({
  aberto,
  itemEditando,
  onFechar,
  onSalvo,
}) {
  const modoEdicao = Boolean(itemEditando);

  const [tipo, setTipo] = useState('entrada');
  const [titulo, setTitulo] = useState('');
  const [valor, setValor] = useState('');
  const [categoria, setCategoria] = useState('Salário');
  const [data, setData] = useState(hojeIso);
  const [status, setStatus] = useState('pago');
  const [parcelas, setParcelas] = useState(1);
  const [modoValorParcela, setModoValorParcela] = useState('parcela');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  // Preenche o formulário quando abre em modo edição ou reseta para novo lançamento
  useEffect(() => {
    if (!aberto) return;
    setErro('');

    if (itemEditando) {
      setTipo(itemEditando.tipo);
      setTitulo(itemEditando.titulo);
      setValor(String(itemEditando.valor));
      setCategoria(itemEditando.categoria);
      setData(itemEditando.data);
      setStatus(itemEditando.status);
      setParcelas(1);
    } else {
      setTipo('entrada');
      setTitulo('');
      setValor('');
      setCategoria('Salário');
      setData(hojeIso());
      setStatus('pago');
      setParcelas(1);
      setModoValorParcela('parcela');
    }
  }, [aberto, itemEditando]);

  // Fecha o modal ao apertar ESC
  useEffect(() => {
    if (!aberto) return;
    function onKeyDown(e) {
      if (e.key === 'Escape') onFechar();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [aberto, onFechar]);

  if (!aberto) return null;

  function trocarTipo(novoTipo) {
    setTipo(novoTipo);
    const listaCategorias = CATEGORIAS_POR_TIPO[novoTipo];
    if (!listaCategorias.includes(categoria)) {
      setCategoria(listaCategorias[0]);
    }
    if (!modoEdicao) {
      if (novoTipo === 'divida') {
        setStatus('pendente');
      } else {
        setStatus('pago');
        setParcelas(1);
      }
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setErro('');
    setSalvando(true);

    try {
      const valorNumerico = Number(String(valor).replace(',', '.'));

      if (modoEdicao) {
        await api.atualizarLancamento(itemEditando.id, {
          titulo,
          valor: valorNumerico,
          tipo,
          categoria,
          data,
          status,
        });
      } else {
        const qtdParcelas =
          tipo === 'divida' ? Math.max(1, Math.min(60, Number(parcelas) || 1)) : 1;

        await api.criarLancamento({
          titulo,
          valor: valorNumerico,
          tipo,
          categoria,
          data,
          status,
          parcelas: qtdParcelas,
          modoValorParcela,
        });
      }

      await onSalvo(data);
      onFechar();
    } catch (err) {
      setErro(err.message);
    } finally {
      setSalvando(false);
    }
  }

  const categoriasDisponiveis = CATEGORIAS_POR_TIPO[tipo].includes(categoria)
    ? CATEGORIAS_POR_TIPO[tipo]
    : [categoria, ...CATEGORIAS_POR_TIPO[tipo]];

  const qtdParcelasValida = Math.max(1, Math.min(60, Number(parcelas) || 1));
  const valorDigitadoNum = Number(String(valor).replace(',', '.'));
  const temPreviewParcelas =
    !modoEdicao &&
    tipo === 'divida' &&
    qtdParcelasValida > 1 &&
    valorDigitadoNum > 0 &&
    data;

  const valorCadaParcelaPreview =
    modoValorParcela === 'total'
      ? valorDigitadoNum / qtdParcelasValida
      : valorDigitadoNum;
  const totalDividaPreview =
    modoValorParcela === 'total'
      ? valorDigitadoNum
      : valorDigitadoNum * qtdParcelasValida;
  const ultimaDataPreview = somarMesesPreview(data, qtdParcelasValida - 1);
  const diaVencimento = data ? data.split('-')[2] : '';

  return (
    <div className="modal-backdrop" onClick={onFechar}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2>{modoEdicao ? 'Editar lançamento' : 'Novo lançamento'}</h2>
            <p className="modal-subtitle">
              {modoEdicao
                ? 'Altere descrição, valor, data ou situação deste registro'
                : 'Registre uma entrada, saída ou dívida parcelada'}
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

        <div className="type-selector">
          <button
            type="button"
            className={tipo === 'entrada' ? 'type-btn active entrada' : 'type-btn'}
            onClick={() => trocarTipo('entrada')}
          >
            + Entrada
          </button>
          <button
            type="button"
            className={tipo === 'saida' ? 'type-btn active saida' : 'type-btn'}
            onClick={() => trocarTipo('saida')}
          >
            - Saída
          </button>
          <button
            type="button"
            className={tipo === 'divida' ? 'type-btn active divida' : 'type-btn'}
            onClick={() => trocarTipo('divida')}
          >
            ! Dívida
          </button>
        </div>

        <form onSubmit={handleSubmit} className="entry-form">
          <label className="field">
            <span>Descrição</span>
            <input
              type="text"
              placeholder={
                tipo === 'entrada'
                  ? 'Ex.: Salário, Freelance...'
                  : tipo === 'divida'
                    ? 'Ex.: Google AI Pro, Celular no Cartão...'
                    : 'Ex.: Mercado, Energia, Aluguel...'
              }
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              autoFocus
              required
            />
          </label>

          <div className="field-row">
            <label className="field">
              <span>
                {!modoEdicao && tipo === 'divida' && qtdParcelasValida > 1
                  ? modoValorParcela === 'total'
                    ? 'Valor total (R$)'
                    : 'Valor da parcela (R$)'
                  : 'Valor (R$)'}
              </span>
              <input
                type="number"
                step="0.01"
                min="0.01"
                placeholder="0,00"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                required
              />
            </label>

            <label className="field">
              <span>
                {tipo === 'divida'
                  ? !modoEdicao && qtdParcelasValida > 1
                    ? '1º Vencimento'
                    : 'Vencimento'
                  : 'Data'}
              </span>
              <input
                type="date"
                value={data}
                onChange={(e) => setData(e.target.value)}
                required
              />
            </label>
          </div>

          {!modoEdicao && tipo === 'divida' && (
            <div className="installment-box">
              <div className="installment-header">
                <span>Quantas parcelas faltam?</span>
                <div className="installment-presets">
                  {[1, 3, 6, 12].map((n) => (
                    <button
                      key={n}
                      type="button"
                      className={
                        qtdParcelasValida === n ? 'preset-btn active' : 'preset-btn'
                      }
                      onClick={() => setParcelas(n)}
                    >
                      {n}x
                    </button>
                  ))}
                </div>
              </div>

              <div className="field-row">
                <label className="field">
                  <span>Número de parcelas</span>
                  <input
                    type="number"
                    min="1"
                    max="60"
                    value={parcelas}
                    onChange={(e) => setParcelas(e.target.value)}
                  />
                </label>

                {qtdParcelasValida > 1 && (
                  <label className="field">
                    <span>O valor acima é:</span>
                    <select
                      value={modoValorParcela}
                      onChange={(e) => setModoValorParcela(e.target.value)}
                    >
                      <option value="parcela">De cada parcela</option>
                      <option value="total">Total (dividir)</option>
                    </select>
                  </label>
                )}
              </div>

              {temPreviewParcelas && (
                <div className="installment-preview">
                  Serão geradas <strong>{qtdParcelasValida} parcelas</strong> de{' '}
                  <strong>{formatarMoeda(valorCadaParcelaPreview)}</strong> (Total:{' '}
                  <strong>{formatarMoeda(totalDividaPreview)}</strong>), todo dia{' '}
                  <strong>{diaVencimento}</strong> — de {formatarData(data)} até{' '}
                  {formatarData(ultimaDataPreview)}.
                </div>
              )}
            </div>
          )}

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
              <span>Situação</span>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="pago">
                  {tipo === 'entrada' ? 'Já entrou' : 'Já paguei'}
                </option>
                <option value="pendente">
                  {tipo === 'entrada' ? 'Vai entrar' : 'Ainda vai sair'}
                </option>
              </select>
            </label>
          </div>

          {erro && <div className="alert-error">{erro}</div>}

          <div className="modal-actions">
            <button type="button" className="btn-outline" onClick={onFechar}>
              Cancelar
            </button>
            <button type="submit" className="btn-primary" disabled={salvando}>
              {salvando
                ? 'Salvando...'
                : modoEdicao
                  ? 'Salvar alterações'
                  : tipo === 'divida' && qtdParcelasValida > 1
                    ? `Adicionar ${qtdParcelasValida} parcelas`
                    : 'Salvar lançamento'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
