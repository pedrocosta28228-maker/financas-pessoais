import { useEffect, useState } from 'react';
import { api } from '../api.js';
import InfoTip from './InfoTip.jsx';

const CATEGORIAS_FIXAS = [
  'Moradia',
  'Contas',
  'Assinaturas',
  'Alimentação',
  'Transporte',
  'Saúde',
  'Educação',
  'Lazer',
  'Outros',
];

const NOMES_MESES_CURTOS = [
  'Jan',
  'Fev',
  'Mar',
  'Abr',
  'Mai',
  'Jun',
  'Jul',
  'Ago',
  'Set',
  'Out',
  'Nov',
  'Dez',
];

function formatarMoeda(valor) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(valor || 0);
}

function mesAtualIso() {
  const hoje = new Date();
  return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
}

function montarDataNoMesIso(mesIso, diaDesejado) {
  const [ano, mes] = mesIso.split('-').map(Number);
  const ultimoDia = new Date(ano, mes, 0).getDate();
  const diaFinal = Math.min(diaDesejado, ultimoDia);
  return `${ano}-${String(mes).padStart(2, '0')}-${String(diaFinal).padStart(2, '0')}`;
}

function formatarMesCurto(mesIso) {
  const [ano, mes] = mesIso.split('-').map(Number);
  return `${NOMES_MESES_CURTOS[mes - 1]}/${String(ano).slice(2)}`;
}

/**
 * Verifica se já existe uma saída lançada no mês de referência com o mesmo nome da despesa fixa.
 */
export function encontrarLancamentoDespesaNoMes(despesa, mesIso, lancamentosTodos) {
  const alvo = despesa.titulo.trim().toLowerCase();
  return lancamentosTodos.find(
    (item) =>
      item.tipo === 'saida' &&
      item.data.slice(0, 7) === mesIso &&
      item.titulo.trim().toLowerCase().startsWith(alvo)
  );
}

/**
 * Painel de Despesas Fixas Mensais na aba Saídas:
 * - Cadastra contas recorrentes (Internet, Academia, Aluguel, Streaming...)
 * - Permite lançar a conta do mês em 1 clique (ajustando o valor se variou!)
 * - Permite pausar/reativar sem perder o cadastro
 * - Entra automaticamente na projeção de 12 meses da aba Estatísticas
 */
export default function DespesasFixasSection({
  despesasFixas,
  contas,
  lancamentosTodos,
  mesSelecionado,
  onAtualizar,
}) {
  const mesReferencia = mesSelecionado || mesAtualIso();
  const labelMesRef = formatarMesCurto(mesReferencia);

  // Modal Criar / Editar Despesa Fixa
  const [modalFormAberto, setModalFormAberto] = useState(false);
  const [despesaEditando, setDespesaEditando] = useState(null);
  const [titulo, setTitulo] = useState('');
  const [valor, setValor] = useState('');
  const [diaVencimento, setDiaVencimento] = useState('10');
  const [categoria, setCategoria] = useState('Moradia');
  const [contaId, setContaId] = useState('');
  const [salvandoForm, setSalvandoForm] = useState(false);
  const [erroForm, setErroForm] = useState('');

  // Modal Lançar no Mês
  const [despesaLancando, setDespesaLancando] = useState(null);
  const [valorLanc, setValorLanc] = useState('');
  const [dataLanc, setDataLanc] = useState('');
  const [statusLanc, setStatusLanc] = useState('pago');
  const [contaIdLanc, setContaIdLanc] = useState('');
  const [salvandoLanc, setSalvandoLanc] = useState(false);
  const [erroLanc, setErroLanc] = useState('');

  // Modal Confirmar Exclusão
  const [despesaExcluindo, setDespesaExcluindo] = useState(null);
  const [excluindo, setExcluindo] = useState(false);
  const [erroExclusao, setErroExclusao] = useState('');

  const [alternandoId, setAlternandoId] = useState(null);

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key !== 'Escape') return;
      if (modalFormAberto && !salvandoForm) setModalFormAberto(false);
      if (despesaLancando && !salvandoLanc) setDespesaLancando(null);
      if (despesaExcluindo && !excluindo) setDespesaExcluindo(null);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    modalFormAberto,
    salvandoForm,
    despesaLancando,
    salvandoLanc,
    despesaExcluindo,
    excluindo,
  ]);

  function abrirNova() {
    setDespesaEditando(null);
    setTitulo('');
    setValor('');
    setDiaVencimento('10');
    setCategoria('Moradia');
    setContaId('');
    setErroForm('');
    setModalFormAberto(true);
  }

  function abrirEditar(despesa) {
    setDespesaEditando(despesa);
    setTitulo(despesa.titulo);
    setValor(String(despesa.valor));
    setDiaVencimento(String(despesa.dia_vencimento));
    setCategoria(despesa.categoria || 'Moradia');
    setContaId(despesa.conta_id ? String(despesa.conta_id) : '');
    setErroForm('');
    setModalFormAberto(true);
  }

  async function handleSalvarForm(e) {
    e.preventDefault();
    setErroForm('');
    setSalvandoForm(true);
    try {
      const payload = {
        titulo,
        valor: Number(String(valor).replace(',', '.')),
        diaVencimento: Number(diaVencimento),
        categoria,
        contaId: contaId ? Number(contaId) : null,
      };
      if (despesaEditando) {
        await api.atualizarDespesaFixa(despesaEditando.id, {
          ...payload,
          ativa: despesaEditando.ativa !== 0,
        });
      } else {
        await api.criarDespesaFixa(payload);
      }
      await onAtualizar();
      setModalFormAberto(false);
    } catch (err) {
      setErroForm(err.message);
    } finally {
      setSalvandoForm(false);
    }
  }

  function abrirLancarNoMes(despesa) {
    setDespesaLancando(despesa);
    setValorLanc(String(despesa.valor));
    setDataLanc(montarDataNoMesIso(mesReferencia, despesa.dia_vencimento));
    setStatusLanc('pago');
    setContaIdLanc(despesa.conta_id ? String(despesa.conta_id) : '');
    setErroLanc('');
  }

  async function handleConfirmarLancamento(e) {
    e.preventDefault();
    if (!despesaLancando) return;
    setErroLanc('');
    setSalvandoLanc(true);
    try {
      await api.criarLancamento({
        titulo: despesaLancando.titulo,
        valor: Number(String(valorLanc).replace(',', '.')),
        tipo: 'saida',
        categoria: despesaLancando.categoria || 'Moradia',
        data: dataLanc,
        status: statusLanc,
        contaId: statusLanc === 'pago' && contaIdLanc ? Number(contaIdLanc) : null,
      });
      await onAtualizar();
      setDespesaLancando(null);
    } catch (err) {
      setErroLanc(err.message);
    } finally {
      setSalvandoLanc(false);
    }
  }

  async function handleAlternarAtiva(despesa) {
    setAlternandoId(despesa.id);
    try {
      await api.alternarAtivaDespesaFixa(despesa.id, despesa.ativa === 0);
      await onAtualizar();
    } finally {
      setAlternandoId(null);
    }
  }

  async function handleExcluir() {
    if (!despesaExcluindo) return;
    setErroExclusao('');
    setExcluindo(true);
    try {
      await api.excluirDespesaFixa(despesaExcluindo.id);
      await onAtualizar();
      setDespesaExcluindo(null);
    } catch (err) {
      setErroExclusao(err.message);
    } finally {
      setExcluindo(false);
    }
  }

  return (
    <section className="panel fixed-panel">
      <div className="wallets-header">
        <div className="title-with-tip">
          <h2>Despesas fixas</h2>
          <InfoTip
            alinhamento="left"
            texto="Contas mensais recorrentes (internet, academia, aluguel). Entram automaticamente na projeção de 12 meses e podem ser lançadas em 1 clique."
          />
        </div>

        <button
          type="button"
          className="btn-small-primary"
          onClick={abrirNova}
        >
          + Nova despesa fixa
        </button>
      </div>

      {despesasFixas.length === 0 ? (
        <div className="wallets-empty">
          <p>
            Você ainda não cadastrou nenhuma despesa fixa. Adicione suas contas mensais como{' '}
            <strong>Internet</strong>, <strong>Academia</strong>, <strong>Celular</strong> ou{' '}
            <strong>Aluguel</strong> para lançar em 1 clique todo mês e deixar a projeção de 12 meses muito mais realista!
          </p>
        </div>
      ) : (
        <div className="fixed-grid">
          {despesasFixas.map((despesa) => {
            const pausada = despesa.ativa === 0;
            const lancamentoMes = encontrarLancamentoDespesaNoMes(
              despesa,
              mesReferencia,
              lancamentosTodos
            );

            return (
              <article
                key={despesa.id}
                className={pausada ? 'fixed-card pausada' : 'fixed-card'}
              >
                <div className="fixed-card-top">
                  <strong className="fixed-card-title">{despesa.titulo}</strong>
                  <span className="wallet-tag">
                    {pausada ? 'Pausada' : `Dia ${despesa.dia_vencimento}`}
                  </span>
                </div>

                <div className="fixed-card-value-row">
                  <strong className="fixed-card-amount">
                    {formatarMoeda(despesa.valor)}
                  </strong>
                  <span className="fixed-card-period">/mês</span>
                </div>

                <div className="fixed-card-meta">
                  <span className="wallet-tag">{despesa.categoria}</span>
                  {despesa.conta_nome && (
                    <span className="wallet-inline-pill">
                      <span
                        className="wallet-dot tiny"
                        style={{ backgroundColor: despesa.conta_cor || '#3b82f6' }}
                      />
                      {despesa.conta_nome}
                    </span>
                  )}
                </div>

                <div className="fixed-card-footer">
                  <div className="fixed-card-cta">
                    {pausada ? (
                      <span className="meta-sync-note">Fora da projeção</span>
                    ) : lancamentoMes ? (
                      <span
                        className={
                          lancamentoMes.status === 'pago'
                            ? 'fixed-status-pill pago'
                            : 'fixed-status-pill pendente'
                        }
                      >
                        {lancamentoMes.status === 'pago'
                          ? `✓ Paga (${labelMesRef})`
                          : `⏳ Lançada (${labelMesRef})`}
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="btn-pay"
                        onClick={() => abrirLancarNoMes(despesa)}
                      >
                        Lançar ({labelMesRef})
                      </button>
                    )}
                  </div>

                  <div className="meta-footer-right">
                    <button
                      type="button"
                      className="btn-link"
                      disabled={alternandoId === despesa.id}
                      onClick={() => handleAlternarAtiva(despesa)}
                    >
                      {pausada ? 'Reativar' : 'Pausar'}
                    </button>
                    <button
                      type="button"
                      className="btn-link"
                      onClick={() => abrirEditar(despesa)}
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      className="btn-link danger"
                      onClick={() => {
                        setErroExclusao('');
                        setDespesaExcluindo(despesa);
                      }}
                    >
                      Excluir
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* ==================== MODAL CRIAR / EDITAR DESPESA FIXA ==================== */}
      {modalFormAberto && (
        <div
          className="modal-backdrop"
          onClick={() => !salvandoForm && setModalFormAberto(false)}
        >
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2>
                  {despesaEditando ? 'Editar despesa fixa' : 'Nova despesa fixa mensal'}
                </h2>
                <p className="modal-subtitle">
                  Entra automaticamente na previsão mensal dos próximos 12 meses
                </p>
              </div>
              <button
                type="button"
                className="modal-close"
                onClick={() => setModalFormAberto(false)}
              >
                ×
              </button>
            </div>

            <form onSubmit={handleSalvarForm} className="entry-form">
              <label className="field">
                <span>Descrição</span>
                <input
                  type="text"
                  placeholder="Ex.: Internet, Academia, Energia, Aluguel, Spotify..."
                  value={titulo}
                  onChange={(e) => setTitulo(e.target.value)}
                  autoFocus
                  required
                />
              </label>

              <div className="field-row">
                <label className="field">
                  <span>Valor mensal (R$)</span>
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
                  <span>Categoria</span>
                  <select
                    value={categoria}
                    onChange={(e) => setCategoria(e.target.value)}
                  >
                    {CATEGORIAS_FIXAS.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="field">
                <div className="day-header">
                  <span>Dia do vencimento</span>
                  <div className="day-presets">
                    {[5, 10, 15, 20, 25].map((d) => (
                      <button
                        key={d}
                        type="button"
                        className={
                          Number(diaVencimento) === d ? 'preset-btn active' : 'preset-btn'
                        }
                        onClick={() => setDiaVencimento(String(d))}
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
                  value={diaVencimento}
                  onChange={(e) => setDiaVencimento(e.target.value)}
                  required
                />
              </div>

              {contas.length > 0 && (
                <label className="field">
                  <span>Carteira padrão para pagar (opcional)</span>
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

              {erroForm && <div className="alert-error">{erroForm}</div>}

              <div className="modal-actions">
                <button
                  type="button"
                  className="btn-outline"
                  onClick={() => setModalFormAberto(false)}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={salvandoForm}
                >
                  {salvandoForm
                    ? 'Salvando...'
                    : despesaEditando
                      ? 'Salvar alterações'
                      : 'Adicionar despesa fixa'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================== MODAL LANÇAR NO MÊS ==================== */}
      {despesaLancando && (
        <div
          className="modal-backdrop"
          onClick={() => !salvandoLanc && setDespesaLancando(null)}
        >
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2>Lançar despesa em {labelMesRef}</h2>
                <p className="modal-subtitle">
                  {despesaLancando.titulo} — se a conta veio diferente este mês, pode ajustar o valor antes de confirmar
                </p>
              </div>
              <button
                type="button"
                className="modal-close"
                onClick={() => setDespesaLancando(null)}
              >
                ×
              </button>
            </div>

            <form onSubmit={handleConfirmarLancamento} className="entry-form">
              <div className="field-row">
                <label className="field">
                  <span>Valor deste mês (R$)</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={valorLanc}
                    onChange={(e) => setValorLanc(e.target.value)}
                    autoFocus
                    required
                  />
                </label>

                <label className="field">
                  <span>Data</span>
                  <input
                    type="date"
                    value={dataLanc}
                    onChange={(e) => setDataLanc(e.target.value)}
                    required
                  />
                </label>
              </div>

              <div className="field">
                <span>Situação</span>
                <div className="period-segmented full-width">
                  <button
                    type="button"
                    className={statusLanc === 'pago' ? 'seg-btn active' : 'seg-btn'}
                    onClick={() => setStatusLanc('pago')}
                  >
                    Já paguei
                  </button>
                  <button
                    type="button"
                    className={statusLanc === 'pendente' ? 'seg-btn active' : 'seg-btn'}
                    onClick={() => setStatusLanc('pendente')}
                  >
                    Ainda vou pagar
                  </button>
                </div>
              </div>

              {statusLanc === 'pago' && contas.length > 0 && (
                <label className="field">
                  <span>De qual carteira saiu? (opcional)</span>
                  <select
                    value={contaIdLanc}
                    onChange={(e) => setContaIdLanc(e.target.value)}
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

              {erroLanc && <div className="alert-error">{erroLanc}</div>}

              <div className="modal-actions">
                <button
                  type="button"
                  className="btn-outline"
                  onClick={() => setDespesaLancando(null)}
                  disabled={salvandoLanc}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={salvandoLanc}
                >
                  {salvandoLanc ? 'Lançando...' : 'Confirmar lançamento'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================== MODAL CONFIRMAR EXCLUSÃO ==================== */}
      {despesaExcluindo && (
        <div
          className="modal-backdrop"
          onClick={() => !excluindo && setDespesaExcluindo(null)}
        >
          <div className="modal-card modal-danger" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2>Excluir esta despesa fixa?</h2>
                <p className="modal-subtitle">
                  Ela deixa de entrar nas projeções futuras, mas os lançamentos que você já fez nos meses anteriores continuam salvos.
                </p>
              </div>
              <button
                type="button"
                className="modal-close"
                onClick={() => setDespesaExcluindo(null)}
              >
                ×
              </button>
            </div>

            <div className="delete-summary">
              <div className="delete-summary-top">
                <span className="wallet-tag">
                  Todo dia {despesaExcluindo.dia_vencimento} • {despesaExcluindo.categoria}
                </span>
                <strong>{formatarMoeda(despesaExcluindo.valor)}/mês</strong>
              </div>
              <div className="delete-summary-name">{despesaExcluindo.titulo}</div>
            </div>

            {erroExclusao && <div className="alert-error">{erroExclusao}</div>}

            <div className="modal-actions">
              <button
                type="button"
                className="btn-outline"
                onClick={() => setDespesaExcluindo(null)}
                disabled={excluindo}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn-danger"
                onClick={handleExcluir}
                disabled={excluindo}
              >
                {excluindo ? 'Excluindo...' : 'Sim, excluir despesa fixa'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
