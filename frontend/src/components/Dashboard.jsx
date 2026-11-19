import { useEffect, useState } from 'react';
import { api } from '../api.js';
import Charts from './Charts.jsx';
import NovoLancamentoModal from './NovoLancamentoModal.jsx';
import ConfirmarPagamentoModal from './ConfirmarPagamentoModal.jsx';
import ConfirmarExclusaoModal from './ConfirmarExclusaoModal.jsx';

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

function nomeBaseParcela(titulo) {
  return titulo.replace(/\s*\(\d+\/\d+\)\s*$/, '').trim();
}

/**
 * Agrupa lançamentos que pertencem ao mesmo "grupo_parcela" em um único item
 * expansível (acordeão), evitando que uma dívida de 48x polua a lista inicial.
 */
function agruparLancamentos(lista) {
  const mapaGrupos = new Map();
  const resultado = [];

  for (const item of lista) {
    if (!item.grupo_parcela) {
      resultado.push({ tipoItem: 'unico', item, dataOrdem: item.data });
      continue;
    }

    if (!mapaGrupos.has(item.grupo_parcela)) {
      const grupo = {
        tipoItem: 'grupo',
        grupoId: item.grupo_parcela,
        nomeBase: nomeBaseParcela(item.titulo),
        tipo: item.tipo,
        categoria: item.categoria,
        parcelas: [],
      };
      mapaGrupos.set(item.grupo_parcela, grupo);
      resultado.push(grupo);
    }

    mapaGrupos.get(item.grupo_parcela).parcelas.push(item);
  }

  return resultado.map((entrada) => {
    if (entrada.tipoItem === 'unico') return entrada;

    // Se só existe 1 parcela visível (ex.: filtro "Por Mês"), mostra direto como linha simples
    if (entrada.parcelas.length === 1) {
      return {
        tipoItem: 'unico',
        item: entrada.parcelas[0],
        dataOrdem: entrada.parcelas[0].data,
      };
    }

    // Ordena as parcelas dentro do grupo em ordem cronológica (1/48, 2/48, ...)
    const ordenadas = [...entrada.parcelas].sort((a, b) =>
      a.data.localeCompare(b.data)
    );
    const pagas = ordenadas.filter((p) => p.status === 'pago');
    const pendentes = ordenadas.filter((p) => p.status === 'pendente');
    const valorRestante = pendentes.reduce((acc, p) => acc + p.valor, 0);
    const valorTotal = ordenadas.reduce((acc, p) => acc + p.valor, 0);
    const proximaParcela = pendentes[0] || ordenadas[ordenadas.length - 1];

    return {
      ...entrada,
      parcelas: ordenadas,
      qtdTotal: ordenadas.length,
      qtdPagas: pagas.length,
      qtdPendentes: pendentes.length,
      valorRestante,
      valorTotal,
      valorMensal: proximaParcela?.valor || 0,
      proximaData: proximaParcela?.data || ordenadas[0].data,
      todosPagos: pendentes.length === 0,
    };
  });
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
  const [gruposAbertos, setGruposAbertos] = useState({});
  const [modalAberto, setModalAberto] = useState(false);
  const [itemEditando, setItemEditando] = useState(null);
  const [itemPagando, setItemPagando] = useState(null);
  const [alvoExclusao, setAlvoExclusao] = useState(null);
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

  function abrirNovo() {
    setItemEditando(null);
    setModalAberto(true);
  }

  function abrirEdicao(item) {
    setItemEditando(item);
    setModalAberto(true);
  }

  function fecharModal() {
    setModalAberto(false);
    setItemEditando(null);
  }

  async function handleSalvo(dataDoLancamento) {
    const mesDoLancamento = dataDoLancamento.slice(0, 7);
    if (mes && mesDoLancamento !== mes) {
      setMes(mesDoLancamento);
    } else {
      await carregarDados(mes);
    }
  }

  async function alternarStatus(item) {
    // Ao pagar uma saída ou dívida pendente, abre o pop-up perguntando se sai do saldo atual
    if (item.status === 'pendente' && item.tipo !== 'entrada') {
      setItemPagando(item);
      return;
    }

    const novoStatus = item.status === 'pago' ? 'pendente' : 'pago';
    try {
      await api.atualizarStatus(item.id, novoStatus);
      await carregarDados(mes);
    } catch (err) {
      setErro(err.message);
    }
  }

  function pedirExclusaoUnico(item) {
    setAlvoExclusao({ modo: 'unico', item });
  }

  function pedirExclusaoGrupo(grupo) {
    setAlvoExclusao({ modo: 'grupo', grupo });
  }

  async function confirmarExclusao(alvo) {
    if (alvo.modo === 'grupo') {
      await api.excluirGrupoParcelas(alvo.grupo.grupoId);
    } else {
      await api.excluirLancamento(alvo.item.id);
    }
    await carregarDados(mes);
  }

  function alternarGrupo(grupoId) {
    setGruposAbertos((prev) => ({ ...prev, [grupoId]: !prev[grupoId] }));
  }

  const modoGeral = !mes;
  const termoBusca = busca.trim().toLowerCase();

  // Aplica filtros e busca nos lançamentos
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

  // Agrupa dívidas parceladas em 1 card expansível por dívida
  const itensExibidos = agruparLancamentos(lancamentosFiltrados);

  // Contadores limpos (contando cada dívida parcelada como 1 grupo no modo geral)
  const todosAgrupados = agruparLancamentos(lancamentos);
  const contadores = {
    todos: todosAgrupados.length,
    entrada: todosAgrupados.filter((e) =>
      e.tipoItem === 'unico' ? e.item.tipo === 'entrada' : e.tipo === 'entrada'
    ).length,
    saida: todosAgrupados.filter((e) =>
      e.tipoItem === 'unico' ? e.item.tipo === 'saida' : e.tipo === 'saida'
    ).length,
    divida: todosAgrupados.filter((e) =>
      e.tipoItem === 'unico' ? e.item.tipo === 'divida' : e.tipo === 'divida'
    ).length,
    pendente: todosAgrupados.filter((e) =>
      e.tipoItem === 'unico' ? e.item.status === 'pendente' : e.qtdPendentes > 0
    ).length,
  };

  return (
    <div className="dashboard">
      {/* Barra superior limpa */}
      <header className="topbar">
        <div className="topbar-left">
          <div className="logo-badge small">R$</div>
          <div>
            <h1>Minhas Finanças</h1>
            <span className="greeting">Olá, {usuario.nome}</span>
          </div>
        </div>

        <div className="topbar-actions">
          <button type="button" className="btn-add" onClick={abrirNovo}>
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

        {/* Cards de resumo (3 cards limpos e diretos) */}
        <section className="summary-grid">
          <div className="card card-saldo">
            <span className="card-label">
              {modoGeral ? 'Saldo Total (Quanto Tenho)' : 'Saldo do Mês'}
            </span>
            <strong
              className={`card-value ${resumo.saldoReal >= 0 ? 'positive' : 'negative'}`}
            >
              {formatarMoeda(resumo.saldoReal)}
            </strong>
            <span className="card-sub">
              {resumo.entradasPrevistas > 0
                ? `+ ${formatarMoeda(resumo.entradasPrevistas)} previsto para entrar`
                : modoGeral
                  ? 'Atualiza automaticamente ao pagar ou adiantar'
                  : 'Entradas menos saídas pagas neste mês'}
            </span>
          </div>

          <div className="card card-saida">
            <span className="card-label">
              {modoGeral ? 'Saídas Pagas (Total)' : 'Saídas Pagas do Mês'}
            </span>
            <strong className="card-value negative">
              {formatarMoeda(resumo.saidasPagas)}
            </strong>
            <span className="card-sub">O que já saiu do seu saldo</span>
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
        </section>

        {/* Gráfico único e limpo: Verde (o que tenho) x Amarelo (vai sair) x Vermelho (já saiu) */}
        <Charts resumo={resumo} modoGeral={modoGeral} />

        {/* Lista de lançamentos com dívidas parceladas agrupadas */}
        <section className="panel entries-panel">
          <div className="entries-header">
            <div>
              <h2>
                {modoGeral
                  ? 'Todos os lançamentos'
                  : `Lançamentos — ${formatarMesBonito(mes)}`}
              </h2>
              <span className="chart-subtitle">
                {itensExibidos.length}{' '}
                {itensExibidos.length === 1 ? 'item exibido' : 'itens exibidos'}
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
          ) : itensExibidos.length === 0 ? (
            <div className="empty-box">
              <p className="empty-state">
                {termoBusca
                  ? `Nenhum lançamento encontrado para "${busca}".`
                  : 'Nenhum lançamento neste período ainda.'}
              </p>
              {!termoBusca && (
                <button type="button" className="btn-add" onClick={abrirNovo}>
                  + Adicionar primeiro lançamento
                </button>
              )}
            </div>
          ) : (
            <ul className="entry-list">
              {itensExibidos.map((entrada) => {
                // Caso 1: Lançamento individual (Entrada, Saída, Dívida 1x ou parcela única do mês)
                if (entrada.tipoItem === 'unico') {
                  const { item } = entrada;
                  return (
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
                                : item.descontar_saldo === 0
                                  ? 'Pago (por fora)'
                                  : 'Pago (do saldo)'
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
                          {item.tipo === 'entrada' ? '+' : '-'}{' '}
                          {formatarMoeda(item.valor)}
                        </span>

                        <button
                          type="button"
                          className={
                            item.status === 'pendente' ? 'btn-pay' : 'btn-small'
                          }
                          onClick={() => alternarStatus(item)}
                        >
                          {item.status === 'pago'
                            ? item.tipo === 'entrada'
                              ? 'Voltar pendente'
                              : 'Desfazer pago'
                            : item.tipo === 'entrada'
                              ? 'Marcar recebido'
                              : 'Marcar pago'}
                        </button>

                        <button
                          type="button"
                          className="btn-small"
                          onClick={() => abrirEdicao(item)}
                        >
                          Editar
                        </button>

                        <button
                          type="button"
                          className="btn-delete"
                          onClick={() => pedirExclusaoUnico(item)}
                        >
                          Excluir
                        </button>
                      </div>
                    </li>
                  );
                }

                // Caso 2: Grupo de Dívida Parcelada (1 único card expansível!)
                const aberto = Boolean(gruposAbertos[entrada.grupoId]);
                return (
                  <li
                    key={entrada.grupoId}
                    className={`group-card ${entrada.todosPagos ? 'pago' : 'pendente'}`}
                  >
                    <div
                      className="group-summary"
                      onClick={() => alternarGrupo(entrada.grupoId)}
                    >
                      <div className="entry-info">
                        <div className="entry-title-row">
                          <span className="badge divida">Dívida parcelada</span>
                          <strong className="entry-title">{entrada.nomeBase}</strong>
                          <span className="parcel-pill">
                            {entrada.qtdPagas}/{entrada.qtdTotal} pagas
                          </span>
                        </div>

                        <div className="entry-meta">
                          <span>{entrada.categoria}</span>
                          <span>•</span>
                          <span>{formatarMoeda(entrada.valorMensal)}/mês</span>
                          <span>•</span>
                          {entrada.todosPagos ? (
                            <span className="status-dot pago">Todas pagas</span>
                          ) : (
                            <span className="status-dot pendente">
                              Faltam {entrada.qtdPendentes} • Próx.:{' '}
                              {formatarData(entrada.proximaData)}
                            </span>
                          )}
                        </div>
                      </div>

                      <div
                        className="entry-actions"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="group-totals">
                          <span className="entry-amount negative">
                            - {formatarMoeda(entrada.todosPagos ? entrada.valorTotal : entrada.valorRestante)}
                          </span>
                          <span className="group-total-sub">
                            {entrada.todosPagos
                              ? 'Quitada'
                              : `Restante (Total: ${formatarMoeda(entrada.valorTotal)})`}
                          </span>
                        </div>

                        <button
                          type="button"
                          className="btn-expand"
                          onClick={() => alternarGrupo(entrada.grupoId)}
                        >
                          {aberto ? 'Ocultar ▴' : 'Ver parcelas ▾'}
                        </button>

                        <button
                          type="button"
                          className="btn-delete"
                          onClick={() => pedirExclusaoGrupo(entrada)}
                          title="Excluir todas as parcelas desta dívida"
                        >
                          Excluir todas
                        </button>
                      </div>
                    </div>

                    {/* Lista interna das parcelas (só aparece quando você clica para abrir) */}
                    {aberto && (
                      <div className="group-parcelas">
                        {entrada.parcelas.map((parcela) => (
                          <div
                            key={parcela.id}
                            className={`parcela-row ${parcela.status}`}
                          >
                            <div className="parcela-left">
                              <strong>{parcela.titulo}</strong>
                              <span className="parcela-date">
                                Vencimento: {formatarData(parcela.data)} •{' '}
                                <span className={`status-dot ${parcela.status}`}>
                                  {parcela.status === 'pago'
                                    ? parcela.descontar_saldo === 0
                                      ? 'Pago (por fora)'
                                      : 'Pago (do saldo)'
                                    : 'Pendente'}
                                </span>
                              </span>
                            </div>

                            <div className="entry-actions">
                              <span className="parcela-value negative">
                                - {formatarMoeda(parcela.valor)}
                              </span>

                              <button
                                type="button"
                                className={
                                  parcela.status === 'pendente'
                                    ? 'btn-pay'
                                    : 'btn-small'
                                }
                                onClick={() => alternarStatus(parcela)}
                              >
                                {parcela.status === 'pago'
                                  ? 'Desfazer pago'
                                  : 'Marcar pago'}
                              </button>

                              <button
                                type="button"
                                className="btn-small"
                                onClick={() => abrirEdicao(parcela)}
                              >
                                Editar
                              </button>

                              <button
                                type="button"
                                className="btn-delete"
                                onClick={() => pedirExclusaoUnico(parcela)}
                                title="Excluir apenas esta parcela"
                              >
                                Excluir
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </main>

      {/* Modal único para Criar e Editar lançamentos */}
      <NovoLancamentoModal
        aberto={modalAberto}
        itemEditando={itemEditando}
        onFechar={fecharModal}
        onSalvo={handleSalvo}
      />

      {/* Pop-up ao pagar/adiantar uma parcela ou conta */}
      <ConfirmarPagamentoModal
        item={itemPagando}
        saldoAtual={resumo.saldoReal}
        onFechar={() => setItemPagando(null)}
        onConfirmado={() => carregarDados(mes)}
      />

      {/* Pop-up visual de confirmação ao excluir */}
      <ConfirmarExclusaoModal
        alvo={alvoExclusao}
        onFechar={() => setAlvoExclusao(null)}
        onConfirmar={confirmarExclusao}
      />
    </div>
  );
}
