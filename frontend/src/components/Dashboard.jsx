import { useEffect, useState } from 'react';
import { api } from '../api.js';
import Charts from './Charts.jsx';
import NovoLancamentoModal from './NovoLancamentoModal.jsx';

const NOMES_MESES = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
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

function formatarMesBonito(mesIso) {
  if (!mesIso) return '';
  const [ano, mes] = mesIso.split('-').map(Number);
  return `${NOMES_MESES[mes - 1]} de ${ano}`;
}

function mesAtualIso() {
  const hoje = new Date();
  const ano = hoje.getFullYear();
  const mes = String(hoje.getMonth() + 1).padStart(2, '0');
  return `${ano}-${mes}`;
}

function moverMes(mesIso, delta) {
  const [ano, mes] = mesIso.split('-').map(Number);
  const total = ano * 12 + (mes - 1) + delta;
  const novoAno = Math.floor(total / 12);
  const novoMes = (total % 12) + 1;
  return `${novoAno}-${String(novoMes).padStart(2, '0')}`;
}

export default function Dashboard({ usuario, onSair }) {
  // Vazio ('') = padrão "Tudo (Total Geral)". Quando preenchido ('YYYY-MM'), filtra aquele mês.
  const [mes, setMes] = useState('');
  const [lancamentos, setLancamentos] = useState([]);
  const [resumo, setResumo] = useState({
    entradasRecebidas: 0,
    entradasPrevistas: 0,
    saidasPagas: 0,
    saidasAPagar: 0,
    dividasPendentes: 0,
    saldoReal: 0,
    saldoPrevisto: 0,
  });
  const [filtro, setFiltro] = useState('todos');
  const [busca, setBusca] = useState('');
  const [modalAberto, setModalAberto] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');

  async function carregarDados(mesSelecionado = mes) {
    setCarregando(true);
    setErro('');
    try {
      const dados = await api.listarLancamentos(mesSelecionado);
      setLancamentos(dados.lancamentos);
      setResumo(dados.resumo);
    } catch (err) {
      setErro(err.message);
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    carregarDados(mes);
  }, [mes]);

  async function handleLancamentoCriado(dataDoLancamento) {
    const mesDoLancamento = dataDoLancamento.slice(0, 7);
    if (mes && mesDoLancamento !== mes) {
      setMes(mesDoLancamento);
    } else {
      await carregarDados(mes);
    }
  }

  async function alternarStatus(item) {
    const novoStatus = item.status === 'pago' ? 'pendente' : 'pago';
    try {
      await api.atualizarStatus(item.id, novoStatus);
      await carregarDados(mes);
    } catch (err) {
      setErro(err.message);
    }
  }

  async function handleExcluir(id) {
    try {
      await api.excluirLancamento(id);
      await carregarDados(mes);
    } catch (err) {
      setErro(err.message);
    }
  }

  const modoGeral = !mes;
  const termoBusca = busca.trim().toLowerCase();

  // Contadores para os botões de filtro
  const contadores = {
    todos: lancamentos.length,
    entrada: lancamentos.filter((i) => i.tipo === 'entrada').length,
    saida: lancamentos.filter((i) => i.tipo === 'saida').length,
    divida: lancamentos.filter((i) => i.tipo === 'divida').length,
    pendente: lancamentos.filter((i) => i.status === 'pendente').length,
  };

  const lancamentosFiltrados = lancamentos.filter((item) => {
    const passaTipo =
      filtro === 'todos'
        ? true
        : filtro === 'pendente'
          ? item.status === 'pendente'
          : item.tipo === filtro;

    const passaBusca =
      !termoBusca ||
      item.titulo.toLowerCase().includes(termoBusca) ||
      item.categoria.toLowerCase().includes(termoBusca);

    return passaTipo && passaBusca;
  });

  return (
    <div className="dashboard">
      {/* Barra superior limpa com o botão de Novo Lançamento */}
      <header className="topbar">
        <div className="topbar-left">
          <div className="logo-badge small">R$</div>
          <div>
            <h1>Minhas Finanças</h1>
            <span className="greeting">Olá, {usuario.nome}</span>
          </div>
        </div>

        <div className="topbar-actions">
          <button
            type="button"
            className="btn-add"
            onClick={() => setModalAberto(true)}
          >
            + Novo lançamento
          </button>
          <button type="button" className="btn-outline" onClick={onSair}>
            Sair
          </button>
        </div>
      </header>

      <main className="container">
        {erro && <div className="alert-error">{erro}</div>}

        {/* Barra de período */}
        <section className="period-bar">
          <div className="period-segmented">
            <button
              type="button"
              className={modoGeral ? 'seg-btn active' : 'seg-btn'}
              onClick={() => setMes('')}
            >
              Tudo (Total Geral)
            </button>
            <button
              type="button"
              className={!modoGeral ? 'seg-btn active' : 'seg-btn'}
              onClick={() => setMes(mes || mesAtualIso())}
            >
              Por Mês
            </button>
          </div>

          {!modoGeral && (
            <div className="month-nav">
              <button
                type="button"
                className="month-arrow"
                onClick={() => setMes((atual) => moverMes(atual, -1))}
                title="Mês anterior"
              >
                ‹
              </button>
              <span className="month-label">{formatarMesBonito(mes)}</span>
              <button
                type="button"
                className="month-arrow"
                onClick={() => setMes((atual) => moverMes(atual, 1))}
                title="Próximo mês"
              >
                ›
              </button>
              {mes !== mesAtualIso() && (
                <button
                  type="button"
                  className="btn-small"
                  onClick={() => setMes(mesAtualIso())}
                >
                  Mês atual
                </button>
              )}
            </div>
          )}
        </section>

        {/* Cards de resumo */}
        <section className="summary-grid">
          <div className="card card-entrada">
            <span className="card-label">
              {modoGeral ? 'Entradas (Total)' : 'Entradas do Mês'}
            </span>
            <strong className="card-value positive">
              {formatarMoeda(resumo.entradasRecebidas)}
            </strong>
            <span className="card-sub">
              {resumo.entradasPrevistas > 0
                ? `+ ${formatarMoeda(resumo.entradasPrevistas)} a receber`
                : modoGeral
                  ? 'Tudo que já entrou até hoje'
                  : 'Tudo que já entrou no mês'}
            </span>
          </div>

          <div className="card card-saida">
            <span className="card-label">
              {modoGeral ? 'Saídas Pagas (Total)' : 'Saídas Pagas do Mês'}
            </span>
            <strong className="card-value negative">
              {formatarMoeda(resumo.saidasPagas)}
            </strong>
            <span className="card-sub">O que já saiu do seu bolso</span>
          </div>

          <div className="card card-pendente">
            <span className="card-label">Ainda Vai Sair (A Pagar)</span>
            <strong className="card-value warning">
              {formatarMoeda(resumo.saidasAPagar)}
            </strong>
            <span className="card-sub">
              Dívidas pendentes: {formatarMoeda(resumo.dividasPendentes)}
            </span>
          </div>

          <div className="card card-saldo">
            <span className="card-label">
              {modoGeral ? 'Saldo Total (Quanto Tenho)' : 'Saldo Atual do Mês'}
            </span>
            <strong
              className={`card-value ${resumo.saldoReal >= 0 ? 'positive' : 'negative'}`}
            >
              {formatarMoeda(resumo.saldoReal)}
            </strong>
            <span className="card-sub">
              Previsto (após pagar tudo):{' '}
              <strong>{formatarMoeda(resumo.saldoPrevisto)}</strong>
            </span>
          </div>
        </section>

        {/* Gráficos (Rosca + Comparativo em Barras) */}
        <Charts resumo={resumo} lancamentos={lancamentos} modoGeral={modoGeral} />

        {/* Lista completa de lançamentos (agora ocupando 100% da largura!) */}
        <section className="panel entries-panel">
          <div className="entries-header">
            <div>
              <h2>
                {modoGeral
                  ? 'Todos os lançamentos'
                  : `Lançamentos — ${formatarMesBonito(mes)}`}
              </h2>
              <span className="chart-subtitle">
                {lancamentosFiltrados.length}{' '}
                {lancamentosFiltrados.length === 1 ? 'registro exibido' : 'registros exibidos'}
              </span>
            </div>

            <div className="entries-toolbar">
              <input
                type="search"
                className="search-input"
                placeholder="Buscar descrição ou categoria..."
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
              />

              <div className="filter-pills">
                {[
                  { id: 'todos', label: 'Todos' },
                  { id: 'entrada', label: 'Entradas' },
                  { id: 'saida', label: 'Saídas' },
                  { id: 'divida', label: 'Dívidas' },
                  { id: 'pendente', label: 'A Pagar' },
                ].map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    className={filtro === f.id ? 'pill active' : 'pill'}
                    onClick={() => setFiltro(f.id)}
                  >
                    {f.label} <span className="pill-count">{contadores[f.id]}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {carregando ? (
            <p className="empty-state">Carregando lançamentos...</p>
          ) : lancamentosFiltrados.length === 0 ? (
            <div className="empty-box">
              <p className="empty-state">
                {termoBusca
                  ? `Nenhum lançamento encontrado para "${busca}".`
                  : 'Nenhum lançamento neste período ainda.'}
              </p>
              {!termoBusca && (
                <button
                  type="button"
                  className="btn-add"
                  onClick={() => setModalAberto(true)}
                >
                  + Adicionar primeiro lançamento
                </button>
              )}
            </div>
          ) : (
            <ul className="entry-list">
              {lancamentosFiltrados.map((item) => (
                <li key={item.id} className={`entry-item ${item.status}`}>
                  <div className="entry-info">
                    <div className="entry-title-row">
                      <span className={`badge ${item.tipo}`}>
                        {item.tipo === 'entrada'
                          ? 'Entrada'
                          : item.tipo === 'divida'
                            ? 'Dívida'
                            : 'Saída'}
                      </span>
                      <strong className="entry-title">{item.titulo}</strong>
                    </div>

                    <div className="entry-meta">
                      <span>{item.categoria}</span>
                      <span>•</span>
                      <span>{formatarData(item.data)}</span>
                      <span>•</span>
                      <span className={`status-dot ${item.status}`}>
                        {item.status === 'pago'
                          ? item.tipo === 'entrada'
                            ? 'Recebido'
                            : 'Pago'
                          : item.tipo === 'entrada'
                            ? 'A receber'
                            : 'Pendente (vai sair)'}
                      </span>
                    </div>
                  </div>

                  <div className="entry-actions">
                    <span
                      className={`entry-amount ${
                        item.tipo === 'entrada' ? 'positive' : 'negative'
                      }`}
                    >
                      {item.tipo === 'entrada' ? '+' : '-'} {formatarMoeda(item.valor)}
                    </span>

                    <button
                      type="button"
                      className={
                        item.status === 'pendente' ? 'btn-pay' : 'btn-small'
                      }
                      onClick={() => alternarStatus(item)}
                      title="Alternar entre Pago e Pendente"
                    >
                      {item.status === 'pago'
                        ? 'Voltar pendente'
                        : item.tipo === 'entrada'
                          ? 'Marcar recebido'
                          : 'Marcar pago'}
                    </button>

                    <button
                      type="button"
                      className="btn-delete"
                      onClick={() => handleExcluir(item.id)}
                      title="Excluir lançamento"
                    >
                      Excluir
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>

      {/* Modal aberto pelo botão "+ Novo lançamento" */}
      <NovoLancamentoModal
        aberto={modalAberto}
        onFechar={() => setModalAberto(false)}
        onCriado={handleLancamentoCriado}
      />
    </div>
  );
}
