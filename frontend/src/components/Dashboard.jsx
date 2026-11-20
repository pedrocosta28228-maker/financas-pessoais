import { useEffect, useState } from 'react';
import { api } from '../api.js';
import Sidebar from './Sidebar.jsx';
import Charts from './Charts.jsx';
import ContasSection from './ContasSection.jsx';
import ListaLancamentos, { agruparLancamentos } from './ListaLancamentos.jsx';
import NovoLancamentoModal from './NovoLancamentoModal.jsx';
import ConfirmarPagamentoModal from './ConfirmarPagamentoModal.jsx';
import ConfirmarExclusaoModal from './ConfirmarExclusaoModal.jsx';
import SalarioModal from './SalarioModal.jsx';

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

const TITULOS_SECAO = {
  visao_geral: {
    titulo: 'Visão Geral',
    subtitulo: 'Resumo rápido do seu saldo, saídas e dívidas',
  },
  entradas: {
    titulo: 'Entradas & Carteiras',
    subtitulo: 'Veja onde seu dinheiro está guardado, transfira entre carteiras e acompanhe suas entradas',
  },
  dividas: {
    titulo: 'Dívidas e Cartões',
    subtitulo: 'Acompanhe quanto deve em cada cartão/pessoa, veja parcelas e adiante quando quiser',
  },
  saidas: {
    titulo: 'Saídas',
    subtitulo: 'Controle de gastos pagos e contas a vencer',
  },
  estatisticas: {
    titulo: 'Estatísticas',
    subtitulo: 'Histórico total de entradas e visão por categoria',
  },
  metas: {
    titulo: 'Metas',
    subtitulo: 'Seus objetivos de economia (próxima etapa)',
  },
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
  const chaveVistas = `financeiro_dividas_vistas_${usuario.id}`;

  const [secaoAtiva, setSecaoAtiva] = useState('visao_geral');
  const [sidebarRecolhida, setSidebarRecolhida] = useState(() => {
    return localStorage.getItem('financeiro_sidebar_recolhida') === 'true';
  });
  const [dividasVistas, setDividasVistas] = useState(() => {
    try {
      const salvo = JSON.parse(localStorage.getItem(chaveVistas) || '[]');
      return Array.isArray(salvo) ? salvo : [];
    } catch {
      return [];
    }
  });
  const [mes, setMes] = useState(''); // '' = Tudo (Total Geral)
  const [lancamentos, setLancamentos] = useState([]);
  const [contas, setContas] = useState([]);
  const [saldoSemConta, setSaldoSemConta] = useState(0);
  const [salarioConfig, setSalarioConfig] = useState(null);
  const [proximoSalario, setProximoSalario] = useState(null);
  const [modoSalarioModal, setModoSalarioModal] = useState(null); // null | 'configurar' | 'receber'
  const [filtroOrigemDivida, setFiltroOrigemDivida] = useState('');
  const [resumo, setResumo] = useState({
    entradasRecebidas: 0,
    entradasPrevistas: 0,
    saidasPagas: 0,
    saidasPagasPorFora: 0,
    saidasAPagar: 0,
    dividasPendentes: 0,
    saldoReal: 0,
    saldoPrevisto: 0,
  });
  const [modalAberto, setModalAberto] = useState(false);
  const [tipoNovoPadrao, setTipoNovoPadrao] = useState('entrada');
  const [itemEditando, setItemEditando] = useState(null);
  const [itemPagando, setItemPagando] = useState(null);
  const [alvoExclusao, setAlvoExclusao] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');

  async function carregarDados(mesSelecionado = mes) {
    setCarregando(true);
    setErro('');
    try {
      const [dadosLanc, dadosContas, dadosSalario] = await Promise.all([
        api.listarLancamentos(mesSelecionado),
        api.listarContas(),
        api.obterSalario(),
      ]);
      setLancamentos(dadosLanc.lancamentos);
      setResumo(dadosLanc.resumo);
      setContas(dadosContas.contas);
      setSaldoSemConta(dadosContas.saldoSemConta);
      setSalarioConfig(dadosSalario.salario);
      setProximoSalario(dadosSalario.proximo);
    } catch (err) {
      setErro(err.message);
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    carregarDados(mes);
  }, [mes]);

  function abrirNovo(tipoPadrao = 'entrada') {
    setItemEditando(null);
    setTipoNovoPadrao(tipoPadrao);
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

  const modoGeral = !mes;
  const infoSecao = TITULOS_SECAO[secaoAtiva];

  // Subconjuntos por seção
  const listaEntradas = lancamentos.filter((i) => i.tipo === 'entrada');
  const listaDividas = lancamentos.filter((i) => i.tipo === 'divida');
  const listaSaidas = lancamentos.filter((i) => i.tipo === 'saida');

  // Resumos específicos para as abas
  const dividasAgrupadas = agruparLancamentos(listaDividas);
  const chavesDividasAtuais = dividasAgrupadas.map((e) =>
    e.tipoItem === 'unico' ? `item:${e.item.id}` : `grupo:${e.grupoId}`
  );

  // Conta apenas dívidas novas (que ainda não foram vistas na aba Dívidas)
  const novasDividasNaoVistas = chavesDividasAtuais.filter(
    (chave) => !dividasVistas.includes(chave)
  ).length;

  // Assim que você abre a aba Dívidas (ou já está nela), marca todas as dívidas atuais como vistas
  useEffect(() => {
    if (secaoAtiva !== 'dividas' || chavesDividasAtuais.length === 0) return;

    const temNova = chavesDividasAtuais.some((c) => !dividasVistas.includes(c));
    if (!temNova) return;

    const atualizadas = Array.from(new Set([...dividasVistas, ...chavesDividasAtuais]));
    setDividasVistas(atualizadas);
    localStorage.setItem(chaveVistas, JSON.stringify(atualizadas));
  }, [secaoAtiva, chavesDividasAtuais.join('|')]);

  function alternarSidebar() {
    setSidebarRecolhida((atual) => {
      const proximo = !atual;
      localStorage.setItem('financeiro_sidebar_recolhida', String(proximo));
      return proximo;
    });
  }

  const gruposDividasPendentes = dividasAgrupadas.filter((e) =>
    e.tipoItem === 'unico' ? e.item.status === 'pendente' : e.qtdPendentes > 0
  ).length;

  const dividasPagasTotal = listaDividas
    .filter((i) => i.status === 'pago')
    .reduce((acc, i) => acc + i.valor, 0);

  const proximaDividaPendente = [...listaDividas]
    .filter((i) => i.status === 'pendente')
    .sort((a, b) => a.data.localeCompare(b.data))[0];

  // Agrupamento de dívidas por "Cartão / Devo para" (origem_divida)
  const mapaOrigensDivida = {};
  for (const d of listaDividas) {
    const chave = d.origem_divida?.trim() || 'Sem cartão informado';
    if (!mapaOrigensDivida[chave]) {
      mapaOrigensDivida[chave] = { nome: chave, pendente: 0, pago: 0, qtdPendentes: 0 };
    }
    if (d.status === 'pendente') {
      mapaOrigensDivida[chave].pendente += d.valor;
      mapaOrigensDivida[chave].qtdPendentes += 1;
    } else {
      mapaOrigensDivida[chave].pago += d.valor;
    }
  }
  const origensDividaLista = Object.values(mapaOrigensDivida).sort(
    (a, b) => b.pendente - a.pendente
  );
  const temOrigemInformada = listaDividas.some((d) => d.origem_divida?.trim());
  const origensSugeridas = Array.from(
    new Set(listaDividas.map((d) => d.origem_divida?.trim()).filter(Boolean))
  );

  const listaDividasFiltradaPorOrigem = filtroOrigemDivida
    ? listaDividas.filter(
        (d) =>
          (d.origem_divida?.trim() || 'Sem cartão informado') === filtroOrigemDivida
      )
    : listaDividas;

  const saidasPendentesTotal = listaSaidas
    .filter((i) => i.status === 'pendente')
    .reduce((acc, i) => acc + i.valor, 0);

  const saidasPagasApenas = listaSaidas
    .filter((i) => i.status === 'pago')
    .reduce((acc, i) => acc + i.valor, 0);

  // Agrupamento por categoria para a aba Estatísticas
  const mapaCategorias = {};
  for (const item of lancamentos) {
    if (item.tipo === 'saida' || item.tipo === 'divida') {
      mapaCategorias[item.categoria] =
        (mapaCategorias[item.categoria] || 0) + item.valor;
    }
  }
  const categoriasOrdenadas = Object.entries(mapaCategorias)
    .map(([categoria, valor]) => ({ categoria, valor }))
    .sort((a, b) => b.valor - a.valor);
  const maxCategoria = Math.max(...categoriasOrdenadas.map((c) => c.valor), 1);

  const tipoBotaoTopo =
    secaoAtiva === 'dividas'
      ? 'divida'
      : secaoAtiva === 'saidas'
        ? 'saida'
        : 'entrada';

  const textoBotaoTopo =
    secaoAtiva === 'dividas'
      ? '+ Nova dívida'
      : secaoAtiva === 'saidas'
        ? '+ Nova saída'
        : secaoAtiva === 'entradas'
          ? '+ Nova entrada'
          : '+ Novo lançamento';

  return (
    <div className="app-shell">
      <Sidebar
        usuario={usuario}
        secaoAtiva={secaoAtiva}
        onTrocarSecao={setSecaoAtiva}
        novasDividas={novasDividasNaoVistas}
        recolhida={sidebarRecolhida}
        onAlternarRecolhida={alternarSidebar}
        onSair={onSair}
      />

      <div className="main-area">
        {/* Cabeçalho da aba atual */}
        <header className="page-header">
          <div>
            <h2>{infoSecao.titulo}</h2>
            <p className="page-subtitle">{infoSecao.subtitulo}</p>
          </div>

          <button
            type="button"
            className="btn-add"
            onClick={() => abrirNovo(tipoBotaoTopo)}
          >
            {textoBotaoTopo}
          </button>
        </header>

        <main className="main-content">
          {erro && <div className="alert-error">{erro}</div>}

          {/* Barra de período (exibida nas seções que filtram por mês/total) */}
          {secaoAtiva !== 'metas' && (
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
          )}

          {/* ==================== ABA 1: VISÃO GERAL ==================== */}
          {secaoAtiva === 'visao_geral' && (
            <>
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
                      : proximoSalario && modoGeral
                        ? `Próximo: ${proximoSalario.titulo} (${formatarMoeda(proximoSalario.valor)} em ${formatarData(proximoSalario.dataIso)})`
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

              <Charts resumo={resumo} modoGeral={modoGeral} />

              <ListaLancamentos
                titulo={
                  modoGeral
                    ? 'Todos os lançamentos'
                    : `Lançamentos — ${formatarMesBonito(mes)}`
                }
                lancamentos={lancamentos}
                carregando={carregando}
                mostrarFiltrosTipo={true}
                recolhivel={true}
                chaveRecolher={`financeiro_home_recolhido_${usuario.id}`}
                textoBotaoVazio="+ Adicionar primeiro lançamento"
                onAdicionar={() => abrirNovo('entrada')}
                onAlternarStatus={alternarStatus}
                onEditar={abrirEdicao}
                onExcluirUnico={pedirExclusaoUnico}
                onExcluirGrupo={pedirExclusaoGrupo}
              />
            </>
          )}

          {/* ==================== ABA 2: ENTRADAS & CARTEIRAS ==================== */}
          {secaoAtiva === 'entradas' && (
            <>
              <ContasSection
                contas={contas}
                saldoSemConta={saldoSemConta}
                onAtualizar={() => carregarDados(mes)}
              />

              <section className="summary-grid">
                <div className="card">
                  <span className="card-label">
                    {modoGeral ? 'Entradas Recebidas (Total)' : 'Recebido no Mês'}
                  </span>
                  <strong className="card-value positive">
                    {formatarMoeda(resumo.entradasRecebidas)}
                  </strong>
                  <span className="card-sub">Tudo que já entrou nas suas contas</span>
                </div>

                <div className="card card-salario">
                  <div className="card-top-row">
                    <span className="card-label">Previsto para Entrar</span>
                    {salarioConfig && (
                      <button
                        type="button"
                        className="btn-link"
                        onClick={() => setModoSalarioModal('configurar')}
                      >
                        Editar salário
                      </button>
                    )}
                  </div>

                  <strong className="card-value warning">
                    {formatarMoeda(
                      resumo.entradasPrevistas +
                        (proximoSalario ? proximoSalario.valor : 0)
                    )}
                  </strong>

                  {proximoSalario ? (
                    <>
                      <span className="card-sub">
                        <strong>{proximoSalario.titulo}</strong> • dia{' '}
                        {formatarData(proximoSalario.dataIso)}
                        {proximoSalario.contaNome
                          ? ` (${proximoSalario.contaNome})`
                          : ''}
                        {resumo.entradasPrevistas > 0
                          ? ` + ${formatarMoeda(resumo.entradasPrevistas)} avulso`
                          : ''}
                      </span>
                      <div className="salary-card-actions">
                        <button
                          type="button"
                          className="btn-pay"
                          onClick={() => setModoSalarioModal('receber')}
                        >
                          Registrar recebimento
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <span className="card-sub">
                        Cadastre seu salário fixo para prever automaticamente o próximo mês
                      </span>
                      <div className="salary-card-actions">
                        <button
                          type="button"
                          className="btn-small-primary"
                          onClick={() => setModoSalarioModal('configurar')}
                        >
                          + Adicionar salário
                        </button>
                      </div>
                    </>
                  )}
                </div>

                <div className="card">
                  <span className="card-label">Saldo Disponível Hoje</span>
                  <strong
                    className={`card-value ${resumo.saldoReal >= 0 ? 'positive' : 'negative'}`}
                  >
                    {formatarMoeda(resumo.saldoReal)}
                  </strong>
                  <span className="card-sub">Após descontar saídas pagas do saldo</span>
                </div>
              </section>

              <ListaLancamentos
                titulo={
                  modoGeral
                    ? 'Todas as entradas'
                    : `Entradas — ${formatarMesBonito(mes)}`
                }
                lancamentos={listaEntradas}
                carregando={carregando}
                mostrarFiltrosTipo={false}
                textoBotaoVazio="+ Adicionar entrada"
                onAdicionar={() => abrirNovo('entrada')}
                onAlternarStatus={alternarStatus}
                onEditar={abrirEdicao}
                onExcluirUnico={pedirExclusaoUnico}
                onExcluirGrupo={pedirExclusaoGrupo}
              />
            </>
          )}

          {/* ==================== ABA 3: DÍVIDAS ==================== */}
          {secaoAtiva === 'dividas' && (
            <>
              <section className="summary-grid">
                <div className="card">
                  <span className="card-label">Total em Dívidas Pendentes</span>
                  <strong className="card-value warning">
                    {formatarMoeda(resumo.dividasPendentes)}
                  </strong>
                  <span className="card-sub">
                    {gruposDividasPendentes}{' '}
                    {gruposDividasPendentes === 1 ? 'dívida ativa' : 'dívidas ativas'}
                  </span>
                </div>

                <div className="card">
                  <span className="card-label">Dívidas Já Pagas</span>
                  <strong className="card-value positive">
                    {formatarMoeda(dividasPagasTotal)}
                  </strong>
                  <span className="card-sub">Parcelas quitadas neste período</span>
                </div>

                <div className="card">
                  <span className="card-label">Próximo Vencimento</span>
                  <strong className="card-value">
                    {proximaDividaPendente
                      ? formatarData(proximaDividaPendente.data)
                      : 'Tudo em dia!'}
                  </strong>
                  <span className="card-sub">
                    {proximaDividaPendente
                      ? `${proximaDividaPendente.titulo} (${formatarMoeda(proximaDividaPendente.valor)})`
                      : 'Nenhuma parcela pendente'}
                  </span>
                </div>
              </section>

              {/* Resumo por Cartão / Pessoa (quando houver dívidas com origem cadastrada) */}
              {temOrigemInformada && (
                <section className="panel origins-panel">
                  <div className="origins-header">
                    <div>
                      <h2>Quanto devo por cartão / pessoa</h2>
                      <span className="chart-subtitle">
                        Clique em um cartão para filtrar apenas as dívidas dele
                      </span>
                    </div>
                    {filtroOrigemDivida && (
                      <button
                        type="button"
                        className="btn-small"
                        onClick={() => setFiltroOrigemDivida('')}
                      >
                        Mostrar todos os cartões
                      </button>
                    )}
                  </div>

                  <div className="origins-grid">
                    {origensDividaLista.map((orig) => {
                      const ativo = filtroOrigemDivida === orig.nome;
                      return (
                        <button
                          key={orig.nome}
                          type="button"
                          className={ativo ? 'origin-card active' : 'origin-card'}
                          onClick={() =>
                            setFiltroOrigemDivida(ativo ? '' : orig.nome)
                          }
                        >
                          <span className="origin-card-name">{orig.nome}</span>
                          <strong className="origin-card-value warning">
                            {formatarMoeda(orig.pendente)}
                          </strong>
                          <span className="origin-card-sub">
                            {orig.qtdPendentes}{' '}
                            {orig.qtdPendentes === 1
                              ? 'parcela pendente'
                              : 'parcelas pendentes'}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              )}

              <ListaLancamentos
                titulo={
                  filtroOrigemDivida
                    ? `Dívidas — ${filtroOrigemDivida}`
                    : modoGeral
                      ? 'Todas as dívidas'
                      : `Dívidas — ${formatarMesBonito(mes)}`
                }
                lancamentos={listaDividasFiltradaPorOrigem}
                carregando={carregando}
                mostrarFiltrosTipo={false}
                textoBotaoVazio="+ Adicionar dívida"
                onAdicionar={() => abrirNovo('divida')}
                onAlternarStatus={alternarStatus}
                onEditar={abrirEdicao}
                onExcluirUnico={pedirExclusaoUnico}
                onExcluirGrupo={pedirExclusaoGrupo}
              />
            </>
          )}

          {/* ==================== ABA 4: SAÍDAS ==================== */}
          {secaoAtiva === 'saidas' && (
            <>
              <section className="summary-grid">
                <div className="card">
                  <span className="card-label">Saídas Pagas</span>
                  <strong className="card-value negative">
                    {formatarMoeda(saidasPagasApenas)}
                  </strong>
                  <span className="card-sub">Gastos comuns já pagos</span>
                </div>

                <div className="card">
                  <span className="card-label">Saídas Pendentes</span>
                  <strong className="card-value warning">
                    {formatarMoeda(saidasPendentesTotal)}
                  </strong>
                  <span className="card-sub">Contas comuns ainda a pagar</span>
                </div>
              </section>

              <ListaLancamentos
                titulo={
                  modoGeral
                    ? 'Todas as saídas'
                    : `Saídas — ${formatarMesBonito(mes)}`
                }
                lancamentos={listaSaidas}
                carregando={carregando}
                mostrarFiltrosTipo={false}
                textoBotaoVazio="+ Adicionar saída"
                onAdicionar={() => abrirNovo('saida')}
                onAlternarStatus={alternarStatus}
                onEditar={abrirEdicao}
                onExcluirUnico={pedirExclusaoUnico}
                onExcluirGrupo={pedirExclusaoGrupo}
              />
            </>
          )}

          {/* ==================== ABA 5: ESTATÍSTICAS ==================== */}
          {secaoAtiva === 'estatisticas' && (
            <>
              <section className="summary-grid">
                <div className="card">
                  <span className="card-label">
                    {modoGeral ? 'Total Que Já Entrou Até Hoje' : 'Entradas do Mês'}
                  </span>
                  <strong className="card-value positive">
                    {formatarMoeda(resumo.entradasRecebidas)}
                  </strong>
                  <span className="card-sub">Histórico acumulado de entradas recebidas</span>
                </div>

                <div className="card">
                  <span className="card-label">Saídas Pagas (do Saldo)</span>
                  <strong className="card-value negative">
                    {formatarMoeda(resumo.saidasPagas)}
                  </strong>
                  <span className="card-sub">
                    {resumo.saidasPagasPorFora > 0
                      ? `+ ${formatarMoeda(resumo.saidasPagasPorFora)} pagos por fora`
                      : 'Total descontado do seu saldo'}
                  </span>
                </div>

                <div className="card">
                  <span className="card-label">Comprometido em Dívidas</span>
                  <strong className="card-value warning">
                    {formatarMoeda(resumo.dividasPendentes)}
                  </strong>
                  <span className="card-sub">Parcelas pendentes no período</span>
                </div>
              </section>

              <section className="panel">
                <h2>Gastos e dívidas por categoria</h2>
                {categoriasOrdenadas.length === 0 ? (
                  <p className="empty-state">
                    Nenhuma saída ou dívida registrada neste período ainda.
                  </p>
                ) : (
                  <div className="stats-bars">
                    {categoriasOrdenadas.map((cat) => {
                      const pct = Math.max(5, (cat.valor / maxCategoria) * 100);
                      return (
                        <div key={cat.categoria} className="stat-bar-row">
                          <div className="stat-bar-top">
                            <span>{cat.categoria}</span>
                            <strong>{formatarMoeda(cat.valor)}</strong>
                          </div>
                          <div className="stat-bar-track">
                            <div
                              className="stat-bar-fill"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            </>
          )}

          {/* ==================== ABA 6: METAS (PRÓXIMA FASE) ==================== */}
          {secaoAtiva === 'metas' && (
            <section className="panel placeholder-panel">
              <h2>Metas financeiras</h2>
              <p className="empty-state">
                Esta aba será construída na <strong>Fase 5</strong> do nosso plano — aqui você vai criar seus objetivos de economia (ex.: reserva de emergência, celular, viagem) e acompanhar o progresso com o seu saldo atual ({formatarMoeda(resumo.saldoReal)}).
              </p>
            </section>
          )}
        </main>
      </div>

      {/* Modais globais */}
      <NovoLancamentoModal
        aberto={modalAberto}
        itemEditando={itemEditando}
        tipoInicial={tipoNovoPadrao}
        contas={contas}
        origensSugeridas={origensSugeridas}
        onFechar={fecharModal}
        onSalvo={handleSalvo}
      />

      <ConfirmarPagamentoModal
        item={itemPagando}
        saldoAtual={resumo.saldoReal}
        contas={contas}
        onFechar={() => setItemPagando(null)}
        onConfirmado={() => carregarDados(mes)}
      />

      <ConfirmarExclusaoModal
        alvo={alvoExclusao}
        onFechar={() => setAlvoExclusao(null)}
        onConfirmar={confirmarExclusao}
      />

      <SalarioModal
        modo={modoSalarioModal}
        salario={salarioConfig}
        proximo={proximoSalario}
        contas={contas}
        onFechar={() => setModoSalarioModal(null)}
        onAtualizado={() => carregarDados(mes)}
      />
    </div>
  );
}
