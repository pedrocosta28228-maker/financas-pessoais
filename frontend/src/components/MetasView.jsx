import { useEffect, useState } from 'react';
import { api } from '../api.js';
import InfoTip from './InfoTip.jsx';

const CORES_META = [
  '#22c55e', // Verde
  '#3b82f6', // Azul
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

function formatarData(dataIso) {
  if (!dataIso) return '';
  const [ano, mes, dia] = dataIso.split('-');
  return `${dia}/${mes}/${ano}`;
}

function calcularInfoPrazo(prazoIso, faltante, concluida) {
  if (!prazoIso) return null;

  const dataFormatada = formatarData(prazoIso);
  if (concluida) {
    return { texto: `Prazo: ${dataFormatada}`, vencido: false };
  }

  const hoje = new Date();
  const hojeSemHora = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  const [ano, mes, dia] = prazoIso.split('-').map(Number);
  const dataPrazo = new Date(ano, mes - 1, dia);

  if (dataPrazo < hojeSemHora) {
    return { texto: `Prazo vencido (${dataFormatada})`, vencido: true };
  }

  const diffDias = Math.max(
    1,
    Math.ceil((dataPrazo.getTime() - hojeSemHora.getTime()) / (1000 * 60 * 60 * 24))
  );
  const mesesRestantes = Math.max(1, Math.ceil(diffDias / 30));
  const porMes = faltante / mesesRestantes;

  return {
    texto: `Prazo: ${dataFormatada} • ~${formatarMoeda(porMes)}/mês`,
    vencido: false,
  };
}

/**
 * Aba "Metas": permite criar objetivos financeiros (ex.: Reserva de emergência, Celular, Viagem),
 * acompanhar o progresso por aportes manuais ou sincronizado automaticamente com uma carteira.
 */
export default function MetasView({
  metas,
  contas,
  saldoReal,
  abrirNovaSignal,
  onAtualizar,
}) {
  // Modal Criar / Editar Meta
  const [modalFormAberto, setModalFormAberto] = useState(false);
  const [metaEditando, setMetaEditando] = useState(null);
  const [titulo, setTitulo] = useState('');
  const [valorAlvo, setValorAlvo] = useState('');
  const [modoVinculo, setModoVinculo] = useState('manual'); // 'manual' | 'carteira'
  const [valorAtual, setValorAtual] = useState('');
  const [contaId, setContaId] = useState('');
  const [prazo, setPrazo] = useState('');
  const [observacao, setObservacao] = useState('');
  const [cor, setCor] = useState(CORES_META[0]);
  const [salvando, setSalvando] = useState(false);
  const [erroForm, setErroForm] = useState('');

  // Modal Aportar / Retirar
  const [metaAportando, setMetaAportando] = useState(null);
  const [operacao, setOperacao] = useState('aportar'); // 'aportar' | 'retirar'
  const [valorAporte, setValorAporte] = useState('');
  const [salvandoAporte, setSalvandoAporte] = useState(false);
  const [erroAporte, setErroAporte] = useState('');

  // Modal Confirmar Exclusão
  const [metaExcluindo, setMetaExcluindo] = useState(null);
  const [excluindo, setExcluindo] = useState(false);
  const [erroExclusao, setErroExclusao] = useState('');

  function abrirNovaMeta() {
    setMetaEditando(null);
    setTitulo('');
    setValorAlvo('');
    setModoVinculo('manual');
    setValorAtual('0');
    setContaId(contas[0] ? String(contas[0].id) : '');
    setPrazo('');
    setObservacao('');
    setCor(CORES_META[metas.length % CORES_META.length]);
    setErroForm('');
    setModalFormAberto(true);
  }

  // Responde ao botão "+ Nova meta" no cabeçalho do Dashboard
  useEffect(() => {
    if (abrirNovaSignal > 0) {
      abrirNovaMeta();
    }
  }, [abrirNovaSignal]);

  // Fecha qualquer modal com a tecla Escape
  useEffect(() => {
    function onKeyDown(e) {
      if (e.key !== 'Escape') return;
      if (modalFormAberto && !salvando) setModalFormAberto(false);
      if (metaAportando && !salvandoAporte) setMetaAportando(null);
      if (metaExcluindo && !excluindo) setMetaExcluindo(null);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    modalFormAberto,
    salvando,
    metaAportando,
    salvandoAporte,
    metaExcluindo,
    excluindo,
  ]);

  function abrirEditarMeta(meta) {
    setMetaEditando(meta);
    setTitulo(meta.titulo);
    setValorAlvo(String(meta.valor_alvo));
    setModoVinculo(meta.conta_id ? 'carteira' : 'manual');
    setValorAtual(String(meta.valor_atual ?? 0));
    setContaId(meta.conta_id ? String(meta.conta_id) : contas[0] ? String(contas[0].id) : '');
    setPrazo(meta.prazo || '');
    setObservacao(meta.observacao || '');
    setCor(meta.cor || CORES_META[0]);
    setErroForm('');
    setModalFormAberto(true);
  }

  async function handleSalvarMeta(e) {
    e.preventDefault();
    setErroForm('');
    setSalvando(true);
    try {
      const alvoNum = Number(String(valorAlvo).replace(',', '.'));
      const atualNum =
        modoVinculo === 'manual'
          ? Number(String(valorAtual || '0').replace(',', '.'))
          : 0;

      if (modoVinculo === 'carteira' && !contaId) {
        setErroForm('Selecione uma carteira ou escolha o modo de aporte manual.');
        setSalvando(false);
        return;
      }

      const payload = {
        titulo,
        valorAlvo: alvoNum,
        valorAtual: atualNum,
        prazo: prazo || null,
        cor,
        contaId: modoVinculo === 'carteira' ? Number(contaId) : null,
        observacao,
      };

      if (metaEditando) {
        await api.atualizarMeta(metaEditando.id, payload);
      } else {
        await api.criarMeta(payload);
      }

      await onAtualizar();
      setModalFormAberto(false);
    } catch (err) {
      setErroForm(err.message);
    } finally {
      setSalvando(false);
    }
  }

  function abrirModalAporte(meta) {
    setMetaAportando(meta);
    setOperacao('aportar');
    setValorAporte('');
    setErroAporte('');
  }

  async function handleConfirmarAporte(e) {
    e.preventDefault();
    if (!metaAportando) return;
    setErroAporte('');
    setSalvandoAporte(true);
    try {
      const valorNum = Number(String(valorAporte).replace(',', '.'));
      await api.aportarMeta(metaAportando.id, valorNum, operacao);
      await onAtualizar();
      setMetaAportando(null);
    } catch (err) {
      setErroAporte(err.message);
    } finally {
      setSalvandoAporte(false);
    }
  }

  async function handleExcluirMeta() {
    if (!metaExcluindo) return;
    setErroExclusao('');
    setExcluindo(true);
    try {
      await api.excluirMeta(metaExcluindo.id);
      await onAtualizar();
      setMetaExcluindo(null);
    } catch (err) {
      setErroExclusao(err.message);
    } finally {
      setExcluindo(false);
    }
  }

  // Enriquecimento de cada meta com o valor efetivo (manual ou sincronizado da carteira)
  const contasPorId = Object.fromEntries(contas.map((c) => [c.id, c]));

  const metasEnriquecidas = metas.map((meta) => {
    const contaVinculada = meta.conta_id ? contasPorId[meta.conta_id] : null;
    const valorEfetivo = contaVinculada
      ? Math.max(0, contaVinculada.saldo)
      : Math.max(0, meta.valor_atual || 0);
    const faltante = Math.max(0, meta.valor_alvo - valorEfetivo);
    const concluida = valorEfetivo >= meta.valor_alvo;
    const pctReal = meta.valor_alvo > 0 ? (valorEfetivo / meta.valor_alvo) * 100 : 0;
    const percentual = concluida ? 100 : Math.min(99, Math.floor(pctReal));

    return {
      ...meta,
      contaVinculada,
      valorEfetivo,
      faltante,
      concluida,
      percentual,
    };
  });

  // Ordena: metas em andamento primeiro, concluídas por último
  const metasOrdenadas = [...metasEnriquecidas].sort((a, b) => {
    if (a.concluida !== b.concluida) return a.concluida ? 1 : -1;
    return b.id - a.id;
  });

  const qtdConcluidas = metasEnriquecidas.filter((m) => m.concluida).length;
  const qtdAtivas = metasEnriquecidas.length - qtdConcluidas;
  const totalAlvo = metasEnriquecidas.reduce((acc, m) => acc + m.valor_alvo, 0);
  const totalGuardado = metasEnriquecidas.reduce((acc, m) => acc + m.valorEfetivo, 0);
  const totalFaltante = metasEnriquecidas.reduce((acc, m) => acc + m.faltante, 0);
  const pctGeral =
    totalAlvo > 0
      ? Math.min(100, Math.round((Math.min(totalGuardado, totalAlvo) / totalAlvo) * 100))
      : 0;

  // Prévia em tempo real no modal de aporte
  const valorAporteNum = Number(String(valorAporte).replace(',', '.'));
  const valorAporteValido = Number.isFinite(valorAporteNum) && valorAporteNum > 0;
  const novoValorPreview = metaAportando
    ? Math.max(
        0,
        (metaAportando.valor_atual || 0) +
          (valorAporteValido ? (operacao === 'retirar' ? -valorAporteNum : valorAporteNum) : 0)
      )
    : 0;
  const novoPctPreview =
    metaAportando && metaAportando.valor_alvo > 0
      ? Math.min(100, Math.round((novoValorPreview / metaAportando.valor_alvo) * 100))
      : 0;

  return (
    <div className="metas-view">
      {/* 3 Cards de Resumo */}
      <section className="summary-grid">
        <div className="card">
          <div className="card-label-row">
            <span className="card-label">Em andamento</span>
            <InfoTip texto="Quantidade de objetivos ainda não concluídos." />
          </div>
          <strong className="card-value">{qtdAtivas}</strong>
          {qtdConcluidas > 0 && (
            <span className="card-sub">
              {qtdConcluidas} {qtdConcluidas === 1 ? 'concluída' : 'concluídas'} ✓
            </span>
          )}
        </div>

        <div className="card">
          <div className="card-label-row">
            <span className="card-label">Guardado</span>
            <InfoTip texto="Soma do progresso acumulado em todas as suas metas." />
          </div>
          <strong className="card-value positive">{formatarMoeda(totalGuardado)}</strong>
          {totalAlvo > 0 && (
            <span className="card-sub">
              {pctGeral}% de {formatarMoeda(totalAlvo)}
            </span>
          )}
        </div>

        <div className="card">
          <div className="card-label-row">
            <span className="card-label">Falta juntar</span>
            <InfoTip texto="Valor restante para completar todas as metas cadastradas." />
          </div>
          <strong className={`card-value ${totalFaltante === 0 && metas.length > 0 ? 'positive' : 'warning'}`}>
            {formatarMoeda(totalFaltante)}
          </strong>
          {metas.length > 0 && totalFaltante === 0 && (
            <span className="card-sub positive">Todas alcançadas! ✓</span>
          )}
        </div>
      </section>

      {/* Painel Principal de Metas */}
      <section className="panel metas-panel">
        <div className="wallets-header">
          <div className="title-with-tip">
            <h2>Objetivos</h2>
            <InfoTip
              alinhamento="left"
              texto="Acompanhe cada meta por aportes manuais ou sincronizada automaticamente com uma carteira."
            />
          </div>

          <button
            type="button"
            className="btn-small-primary"
            onClick={abrirNovaMeta}
          >
            + Nova meta
          </button>
        </div>

        {metasOrdenadas.length === 0 ? (
          <div className="wallets-empty metas-empty">
            <p>
              Você ainda não cadastrou nenhuma meta. Que tal criar objetivos como{' '}
              <strong>Reserva de emergência</strong>, <strong>Celular novo</strong> ou{' '}
              <strong>Viagem</strong> e acompanhar o progresso passo a passo?
            </p>
            <button
              type="button"
              className="btn-small-primary"
              onClick={abrirNovaMeta}
            >
              + Criar primeira meta
            </button>
          </div>
        ) : (
          <div className="metas-grid">
            {metasOrdenadas.map((meta) => {
              const infoPrazo = calcularInfoPrazo(meta.prazo, meta.faltante, meta.concluida);
              const corBarra = meta.concluida ? '#22c55e' : meta.cor || '#22c55e';

              return (
                <article
                  key={meta.id}
                  className={meta.concluida ? 'meta-card concluida' : 'meta-card'}
                  style={{ borderLeftColor: corBarra }}
                >
                  <div className="meta-card-top">
                    <div className="wallet-title-group">
                      <span
                        className="wallet-dot"
                        style={{ backgroundColor: corBarra }}
                      />
                      <strong>{meta.titulo}</strong>
                    </div>

                    {meta.concluida ? (
                      <span className="meta-badge done">✓ Concluída</span>
                    ) : meta.contaVinculada ? (
                      <span className="wallet-inline-pill">
                        <span
                          className="wallet-dot tiny"
                          style={{ backgroundColor: meta.contaVinculada.cor }}
                        />
                        {meta.contaVinculada.nome}
                      </span>
                    ) : (
                      <span className="wallet-tag">Aporte manual</span>
                    )}
                  </div>

                  <div className="meta-amounts">
                    <div>
                      <strong className="meta-current">
                        {formatarMoeda(meta.valorEfetivo)}
                      </strong>
                      <span className="meta-target">
                        {' '}de {formatarMoeda(meta.valor_alvo)}
                      </span>
                    </div>
                    <span
                      className={`meta-pct ${meta.concluida ? 'positive' : ''}`}
                    >
                      {meta.percentual}%
                    </span>
                  </div>

                  <div className="meta-progress-track">
                    <div
                      className="meta-progress-fill"
                      style={{
                        width: `${meta.percentual}%`,
                        backgroundColor: corBarra,
                      }}
                    />
                  </div>

                  <div className="meta-details">
                    {meta.concluida ? (
                      <span className="positive">Objetivo alcançado!</span>
                    ) : (
                      <span>
                        Faltam <strong>{formatarMoeda(meta.faltante)}</strong>
                      </span>
                    )}

                    {infoPrazo && (
                      <span className={infoPrazo.vencido ? 'warning' : ''}>
                        {infoPrazo.texto}
                      </span>
                    )}

                    {meta.observacao && (
                      <span className="meta-obs">{meta.observacao}</span>
                    )}
                  </div>

                  <div className="meta-footer">
                    <div className="meta-footer-left">
                      {!meta.conta_id ? (
                        <button
                          type="button"
                          className="btn-pay"
                          onClick={() => abrirModalAporte(meta)}
                        >
                          + Aportar
                        </button>
                      ) : (
                        <span className="meta-sync-note">
                          Sincronizada com a carteira
                        </span>
                      )}
                    </div>

                    <div className="meta-footer-right">
                      <button
                        type="button"
                        className="btn-link"
                        onClick={() => abrirEditarMeta(meta)}
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        className="btn-link danger"
                        onClick={() => {
                          setErroExclusao('');
                          setMetaExcluindo(meta);
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
      </section>

      {/* ==================== MODAL CRIAR / EDITAR META ==================== */}
      {modalFormAberto && (
        <div
          className="modal-backdrop"
          onClick={() => !salvando && setModalFormAberto(false)}
        >
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2>{metaEditando ? 'Editar meta' : 'Nova meta financeira'}</h2>
                <p className="modal-subtitle">
                  Defina quanto quer juntar e acompanhe o progresso
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

            <form onSubmit={handleSalvarMeta} className="entry-form">
              <label className="field">
                <span>Nome da meta</span>
                <input
                  type="text"
                  placeholder="Ex.: Reserva de emergência, Celular novo, Viagem..."
                  value={titulo}
                  onChange={(e) => setTitulo(e.target.value)}
                  autoFocus
                  required
                />
              </label>

              <div className="field-row">
                <label className="field">
                  <span>Valor alvo (R$)</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    placeholder="0,00"
                    value={valorAlvo}
                    onChange={(e) => setValorAlvo(e.target.value)}
                    required
                  />
                </label>

                <label className="field">
                  <span>Prazo (opcional)</span>
                  <input
                    type="date"
                    value={prazo}
                    onChange={(e) => setPrazo(e.target.value)}
                  />
                </label>
              </div>

              <div className="field">
                <span>Como acompanhar o valor guardado?</span>
                <div className="period-segmented full-width">
                  <button
                    type="button"
                    className={modoVinculo === 'manual' ? 'seg-btn active' : 'seg-btn'}
                    onClick={() => setModoVinculo('manual')}
                  >
                    Aporte manual
                  </button>
                  <button
                    type="button"
                    className={modoVinculo === 'carteira' ? 'seg-btn active' : 'seg-btn'}
                    onClick={() => setModoVinculo('carteira')}
                    disabled={contas.length === 0}
                    title={
                      contas.length === 0
                        ? 'Crie uma carteira na aba Entradas primeiro'
                        : 'Usa automaticamente o saldo de uma carteira'
                    }
                  >
                    Sincronizar com carteira
                  </button>
                </div>
              </div>

              {modoVinculo === 'manual' ? (
                <label className="field">
                  <span>Quanto já guardou até hoje? (R$)</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0,00"
                    value={valorAtual}
                    onChange={(e) => setValorAtual(e.target.value)}
                  />
                </label>
              ) : (
                <label className="field">
                  <span>Escolha a carteira vinculada</span>
                  <select
                    value={contaId}
                    onChange={(e) => setContaId(e.target.value)}
                    required
                  >
                    {contas.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nome} ({formatarMoeda(c.saldo)})
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <label className="field">
                <span>Observação (opcional)</span>
                <input
                  type="text"
                  placeholder="Ex.: Guardar R$ 300 todo mês após o salário"
                  value={observacao}
                  onChange={(e) => setObservacao(e.target.value)}
                />
              </label>

              <div className="field">
                <span>Cor da barra</span>
                <div className="color-picker">
                  {CORES_META.map((c) => (
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
                  disabled={salvando}
                >
                  {salvando
                    ? 'Salvando...'
                    : metaEditando
                      ? 'Salvar alterações'
                      : 'Criar meta'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================== MODAL APORTAR / RETIRAR ==================== */}
      {metaAportando && (
        <div
          className="modal-backdrop"
          onClick={() => !salvandoAporte && setMetaAportando(null)}
        >
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2>Movimentar meta</h2>
                <p className="modal-subtitle">{metaAportando.titulo}</p>
              </div>
              <button
                type="button"
                className="modal-close"
                onClick={() => setMetaAportando(null)}
              >
                ×
              </button>
            </div>

            <form onSubmit={handleConfirmarAporte} className="entry-form">
              <div className="period-segmented full-width">
                <button
                  type="button"
                  className={operacao === 'aportar' ? 'seg-btn active' : 'seg-btn'}
                  onClick={() => setOperacao('aportar')}
                >
                  + Guardar valor
                </button>
                <button
                  type="button"
                  className={operacao === 'retirar' ? 'seg-btn active' : 'seg-btn'}
                  onClick={() => setOperacao('retirar')}
                >
                  − Retirar valor
                </button>
              </div>

              <div className="field">
                <div className="day-header">
                  <span>Valor (R$)</span>
                  <div className="day-presets">
                    {[50, 100, 200, 500].map((v) => (
                      <button
                        key={v}
                        type="button"
                        className="preset-btn"
                        onClick={() => setValorAporte(String(v))}
                      >
                        R$ {v}
                      </button>
                    ))}
                    {operacao === 'aportar' && metaAportando.faltante > 0 && (
                      <button
                        type="button"
                        className="preset-btn active"
                        onClick={() =>
                          setValorAporte(String(Number(metaAportando.faltante.toFixed(2))))
                        }
                      >
                        Completar
                      </button>
                    )}
                  </div>
                </div>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  placeholder="0,00"
                  value={valorAporte}
                  onChange={(e) => setValorAporte(e.target.value)}
                  autoFocus
                  required
                />
              </div>

              <div className="meta-preview-box">
                <div className="meta-preview-row">
                  <span>Progresso atual</span>
                  <strong>{formatarMoeda(metaAportando.valor_atual || 0)}</strong>
                </div>
                <div className="meta-preview-row">
                  <span>Como vai ficar</span>
                  <strong className={operacao === 'aportar' ? 'positive' : 'warning'}>
                    {formatarMoeda(novoValorPreview)} ({novoPctPreview}%)
                  </strong>
                </div>
              </div>

              {erroAporte && <div className="alert-error">{erroAporte}</div>}

              <div className="modal-actions">
                <button
                  type="button"
                  className="btn-outline"
                  onClick={() => setMetaAportando(null)}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={salvandoAporte}
                >
                  {salvandoAporte
                    ? 'Salvando...'
                    : operacao === 'aportar'
                      ? 'Confirmar aporte'
                      : 'Confirmar retirada'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================== MODAL CONFIRMAR EXCLUSÃO ==================== */}
      {metaExcluindo && (
        <div
          className="modal-backdrop"
          onClick={() => !excluindo && setMetaExcluindo(null)}
        >
          <div className="modal-card modal-danger" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2>Excluir esta meta?</h2>
                <p className="modal-subtitle">
                  Isso remove apenas o objetivo da aba Metas — seu saldo e suas carteiras continuam intactos.
                </p>
              </div>
              <button
                type="button"
                className="modal-close"
                onClick={() => setMetaExcluindo(null)}
              >
                ×
              </button>
            </div>

            <div className="delete-summary">
              <div className="delete-summary-top">
                <span className="wallet-tag">
                  {metaExcluindo.percentual}% concluído
                </span>
                <strong>
                  {formatarMoeda(metaExcluindo.valorEfetivo)} /{' '}
                  {formatarMoeda(metaExcluindo.valor_alvo)}
                </strong>
              </div>
              <div className="delete-summary-name">{metaExcluindo.titulo}</div>
            </div>

            {erroExclusao && <div className="alert-error">{erroExclusao}</div>}

            <div className="modal-actions">
              <button
                type="button"
                className="btn-outline"
                onClick={() => setMetaExcluindo(null)}
                disabled={excluindo}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn-danger"
                onClick={handleExcluirMeta}
                disabled={excluindo}
              >
                {excluindo ? 'Excluindo...' : 'Sim, excluir meta'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
