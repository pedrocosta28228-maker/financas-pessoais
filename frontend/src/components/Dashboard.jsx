import { useEffect, useState } from 'react';
import { api } from '../api.js';
import Sidebar from './Sidebar.jsx';
import Charts from './Charts.jsx';
import ContasSection from './ContasSection.jsx';
import DespesasFixasSection from './DespesasFixasSection.jsx';
import CalendarioDividas from './CalendarioDividas.jsx';
import EstatisticasView from './EstatisticasView.jsx';
import MetasView from './MetasView.jsx';
import ListaLancamentos, { agruparLancamentos } from './ListaLancamentos.jsx';
import NovoLancamentoModal from './NovoLancamentoModal.jsx';
import EditarGrupoModal from './EditarGrupoModal.jsx';
import ConfirmarPagamentoModal from './ConfirmarPagamentoModal.jsx';
import ConfirmarExclusaoModal from './ConfirmarExclusaoModal.jsx';
import SalarioModal from './SalarioModal.jsx';
import InfoTip from './InfoTip.jsx';
import PerfilDrawer, { obterIniciais } from './PerfilDrawer.jsx';
import MinhaContaView from './MinhaContaView.jsx';
import AjudaView from './AjudaView.jsx';

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
    subtitulo: 'Despesas fixas mensais, gastos pagos e contas a vencer',
  },
  estatisticas: {
    titulo: 'Estatísticas e Projeção',
    subtitulo: 'Evolução do saldo nos próximos 12 meses, queda das dívidas e previsão de quitação',
  },
  metas: {
    titulo: 'Metas',
    subtitulo: 'Defina seus objetivos de economia e acompanhe cada conquista',
  },
  minha_conta: {
    titulo: 'Minha conta',
    subtitulo: 'Gerencie seus dados de perfil, altere sua senha e baixe backups',
  },
  ajuda: {
    titulo: 'Central de ajuda',
    subtitulo: 'Guia rápido de como aproveitar cada recurso do Minhas Finanças',
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

function montarDataNoMes(ano, mes1a12, diaDesejado) {
  const ultimoDia = new Date(ano, mes1a12, 0).getDate();
  const diaFinal = Math.min(diaDesejado, ultimoDia);
  return `${ano}-${String(mes1a12).padStart(2, '0')}-${String(diaFinal).padStart(2, '0')}`;
}

/**
 * Calcula qual salário previsto exibir no card "Previsto para Entrar":
 * - No modo Geral ou em meses passados: mostra o próximo salário real vindo do servidor.
 * - No modo Por Mês (mês atual ou futuro): mostra sempre o salário do mês posterior ao mês selecionado
 *   (ex.: olhando Dezembro -> mostra Salário de Janeiro).
 */
function calcularSalarioExibido(mesSelecionado, salarioConfig, proximoReal) {
  if (!salarioConfig) return null;
  if (!mesSelecionado) return proximoReal;

  const mesAtual = mesAtualIso();
  if (mesSelecionado < mesAtual) {
    return proximoReal;
  }

  const mesPosterior = moverMes(mesSelecionado, 1);
  const [anoPost, mesPost] = mesPosterior.split('-').map(Number);
  const mesNome = NOMES_MESES[mesPost - 1];

  return {
    titulo: `Salário de ${mesNome}`,
    mesNome,
    ano: anoPost,
    mesRef: mesPosterior,
    dataIso: montarDataNoMes(anoPost, mesPost, salarioConfig.diaPagamento),
    valor: salarioConfig.valor,
    diaPagamento: salarioConfig.diaPagamento,
    contaId: salarioConfig.contaId || null,
    contaNome: salarioConfig.contaNome || null,
  };
}

export default function Dashboard({
  usuario,
  onUsuarioAtualizado,
  onSair,
  tema,
  onAlternarTema,
}) {
  const primeiroNome = (usuario.nome || '').trim().split(/\s+/)[0] || usuario.nome;
  const chaveNovasDividas = `financeiro_dividas_novas_${usuario.id}`;

  const [secaoAtiva, setSecaoAtiva] = useState('visao_geral');
  const [perfilAberto, setPerfilAberto] = useState(false);
  const [sidebarRecolhida, setSidebarRecolhida] = useState(() => {
    return localStorage.getItem('financeiro_sidebar_recolhida') === 'true';
  });
  const [novasDividasNaoVistas, setNovasDividasNaoVistas] = useState(() => {
    const salvo = Number(localStorage.getItem(chaveNovasDividas) || '0');
    return Number.isFinite(salvo) && salvo > 0 ? Math.floor(salvo) : 0;
  });
  const [mes, setMes] = useState(''); // '' = Tudo (Total Geral)
  const [lancamentos, setLancamentos] = useState([]);
  const [lancamentosTodos, setLancamentosTodos] = useState([]);
  const [contas, setContas] = useState([]);
  const [saldoSemConta, setSaldoSemConta] = useState(0);
  const [metas, setMetas] = useState([]);
  const [abrirNovaMetaSignal, setAbrirNovaMetaSignal] = useState(0);
  const [despesasFixas, setDespesasFixas] = useState([]);
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
  const [resumoGeral, setResumoGeral] = useState({
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
  const [grupoEditando, setGrupoEditando] = useState(null);
  const [itemPagando, setItemPagando] = useState(null);
  const [alvoExclusao, setAlvoExclusao] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');

  async function carregarDados(mesSelecionado = mes) {
    setCarregando(true);
    setErro('');
    try {
      const promessas = [
        api.listarLancamentos(mesSelecionado),
        api.listarContas(),
        api.obterSalario(),
        api.listarMetas(),
        api.listarDespesasFixas(),
      ];
      if (mesSelecionado) {
        promessas.push(api.listarLancamentos(''));
      }

      const [
        dadosLanc,
        dadosContas,
        dadosSalario,
        dadosMetas,
        dadosDespesasFixas,
        dadosGerais,
      ] = await Promise.all(promessas);

      setLancamentos(dadosLanc.lancamentos);
      setResumo(dadosLanc.resumo);
      setLancamentosTodos(dadosGerais ? dadosGerais.lancamentos : dadosLanc.lancamentos);
      setResumoGeral(dadosGerais ? dadosGerais.resumo : dadosLanc.resumo);
      setContas(dadosContas.contas);
      setSaldoSemConta(dadosContas.saldoSemConta);
      setSalarioConfig(dadosSalario.salario);
      setProximoSalario(dadosSalario.proximo);
      setMetas(dadosMetas.metas || []);
      setDespesasFixas(dadosDespesasFixas.despesas || []);
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

  async function handleSalvo(dataDoLancamento, meta = {}) {
    if (meta.ehNovo && meta.tipo === 'divida' && secaoAtiva !== 'dividas') {
      setNovasDividasNaoVistas((atual) => {
        const proximo = atual + 1;
        localStorage.setItem(chaveNovasDividas, String(proximo));
        return proximo;
      });
    }

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
  const salarioExibido = calcularSalarioExibido(mes, salarioConfig, proximoSalario);

  // Subconjuntos por seção
  const listaEntradas = lancamentos.filter((i) => i.tipo === 'entrada');
  const listaDividas = lancamentos.filter((i) => i.tipo === 'divida');
  const listaSaidas = lancamentos.filter((i) => i.tipo === 'saida');

  // Resumos específicos para as abas
  const dividasAgrupadas = agruparLancamentos(listaDividas);

  // Assim que você abre a aba Dívidas, limpa a notificação de novas dívidas
  useEffect(() => {
    if (secaoAtiva !== 'dividas' || novasDividasNaoVistas === 0) return;
    setNovasDividasNaoVistas(0);
    localStorage.setItem(chaveNovasDividas, '0');
  }, [secaoAtiva, novasDividasNaoVistas, chaveNovasDividas]);

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

  const dividasCalendario = lancamentosTodos.filter(
    (d) =>
      d.tipo === 'divida' &&
      (!filtroOrigemDivida ||
        (d.origem_divida?.trim() || 'Sem cartão informado') === filtroOrigemDivida)
  );

  const saidasPendentesTotal = listaSaidas
    .filter((i) => i.status === 'pendente')
    .reduce((acc, i) => acc + i.valor, 0);

  const saidasPagasApenas = listaSaidas
    .filter((i) => i.status === 'pago')
    .reduce((acc, i) => acc + i.valor, 0);

  const despesasFixasAtivas = despesasFixas.filter((d) => d.ativa !== 0);
  const totalDespesasFixasMensal = despesasFixasAtivas.reduce(
    (acc, d) => acc + d.valor,
    0
  );

  const tipoBotaoTopo =
    secaoAtiva === 'dividas'
      ? 'divida'
      : secaoAtiva === 'saidas'
        ? 'saida'
        : 'entrada';

  const labelBotaoTopo =
    secaoAtiva === 'metas'
      ? 'Nova meta'
      : secaoAtiva === 'dividas'
        ? 'Nova dívida'
        : secaoAtiva === 'saidas'
          ? 'Nova saída'
          : secaoAtiva === 'entradas'
            ? 'Nova entrada'
            : 'Novo lançamento';

  function clicarBotaoTopo() {
    if (secaoAtiva === 'metas') {
      setAbrirNovaMetaSignal((n) => n + 1);
      return;
    }
    abrirNovo(tipoBotaoTopo);
  }

  return (
    <div className="app-shell">
      <Sidebar
        secaoAtiva={secaoAtiva}
        onTrocarSecao={setSecaoAtiva}
        novasDividas={novasDividasNaoVistas}
        recolhida={sidebarRecolhida}
        onAlternarRecolhida={alternarSidebar}
      />

      <div className="main-area">
        {/* Cabeçalho da aba atual */}
        <header className="page-header">
          <div className="title-with-tip">
            <h2>
              {secaoAtiva === 'visao_geral'
                ? `Olá, ${primeiroNome}!`
                : infoSecao.titulo}
            </h2>
            {secaoAtiva !== 'visao_geral' && (
              <InfoTip texto={infoSecao.subtitulo} alinhamento="left" />
            )}
          </div>

          <div className="page-header-actions">
            <button
              type="button"
              className="btn-header-salary"
              onClick={() => setModoSalarioModal('configurar')}
            >
              {salarioConfig ? 'Editar salário' : 'Registrar salário'}
            </button>

            <button
              type="button"
              className="btn-add-icon"
              onClick={clicarBotaoTopo}
              title={labelBotaoTopo}
              aria-label={labelBotaoTopo}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 5v14" />
                <path d="M5 12h14" />
              </svg>
            </button>

            <button
              type="button"
              className="btn-theme-icon"
              onClick={onAlternarTema}
              title={tema === 'dark' ? 'Mudar para modo claro' : 'Mudar para modo escuro'}
              aria-label={tema === 'dark' ? 'Mudar para modo claro' : 'Mudar para modo escuro'}
            >
              {tema === 'dark' ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 2v2" />
                  <path d="M12 20v2" />
                  <path d="m4.93 4.93 1.41 1.41" />
                  <path d="m17.66 17.66 1.41 1.41" />
                  <path d="M2 12h2" />
                  <path d="M20 12h2" />
                  <path d="m6.34 17.66-1.41 1.41" />
                  <path d="m19.07 4.93-1.41 1.41" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
                </svg>
              )}
            </button>

            <button
              type="button"
              className="btn-profile-chip"
              onClick={() => setPerfilAberto(true)}
              aria-label="Abrir menu do perfil"
              title={usuario.nome}
            >
              <span className="profile-chip-name">{usuario.nome}</span>
              <span
                className="avatar-circle small"
                style={{ backgroundColor: usuario.avatarCor || '#0052d4' }}
              >
                {obterIniciais(usuario.nome)}
              </span>
            </button>
          </div>
        </header>

        <main className="main-content">
          {erro && <div className="alert-error">{erro}</div>}

          {/* Barra de período (exibida nas seções que filtram por mês/total) */}
          {!['metas', 'estatisticas', 'minha_conta', 'ajuda'].includes(secaoAtiva) && (
            <section className="period-bar">
              <div className="period-segmented">
                <button
                  type="button"
                  className={modoGeral ? 'seg-btn active' : 'seg-btn'}
                  onClick={() => setMes('')}
                >
                  Geral
                </button>
                <button
                  type="button"
                  className={!modoGeral ? 'seg-btn active' : 'seg-btn'}
                  onClick={() => setMes(mes || mesAtualIso())}
                >
                  Por mês
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
              <section className="summary-grid cols-4">
                {!modoGeral && (
                  <div className="card card-saldo-total">
                    <div className="card-label-row">
                      <span className="card-label">Saldo total</span>
                      <InfoTip texto="Quanto você tem disponível hoje no total (somando todos os meses)." />
                    </div>
                    <strong
                      className={`card-value ${resumoGeral.saldoReal >= 0 ? 'positive' : 'negative'}`}
                    >
                      {formatarMoeda(resumoGeral.saldoReal)}
                    </strong>
                  </div>
                )}

                <div className="card card-saldo">
                  <div className="card-label-row">
                    <span className="card-label">
                      {modoGeral ? 'Saldo disponível' : 'Saldo do mês'}
                    </span>
                    <InfoTip
                      texto={
                        modoGeral
                          ? 'Quanto você tem disponível hoje: tudo que entrou menos as saídas pagas do saldo.'
                          : 'Diferença entre o que entrou e as saídas pagas neste mês.'
                      }
                    />
                  </div>
                  <strong
                    className={`card-value ${resumo.saldoReal >= 0 ? 'positive' : 'negative'}`}
                  >
                    {formatarMoeda(resumo.saldoReal)}
                  </strong>
                </div>

                {modoGeral && (
                  <div className="card card-salario">
                    <div className="card-label-row">
                      <span className="card-label">Previsto para entrar</span>
                      <InfoTip texto="Soma do próximo salário fixo com eventuais entradas pendentes." />
                    </div>
                    <strong className="card-value info">
                      {formatarMoeda(
                        resumo.entradasPrevistas +
                          (salarioExibido ? salarioExibido.valor : 0)
                      )}
                    </strong>
                    {salarioExibido ? (
                      <>
                        <span className="card-sub">
                          <strong>{salarioExibido.titulo}</strong> •{' '}
                          {formatarData(salarioExibido.dataIso).slice(0, 5)}
                          {resumo.entradasPrevistas > 0
                            ? ` + ${formatarMoeda(resumo.entradasPrevistas)}`
                            : ''}
                        </span>
                        <div className="salary-card-actions">
                          <button
                            type="button"
                            className="btn-pay"
                            onClick={() => setModoSalarioModal('receber')}
                          >
                            Receber salário
                          </button>
                        </div>
                      </>
                    ) : resumo.entradasPrevistas > 0 ? (
                      <span className="card-sub">Entradas pendentes</span>
                    ) : (
                      <div className="salary-card-actions">
                        <button
                          type="button"
                          className="btn-small"
                          onClick={() => setModoSalarioModal('configurar')}
                        >
                          + Salário fixo
                        </button>
                      </div>
                    )}
                  </div>
                )}

                <div className="card card-saida">
                  <div className="card-label-row">
                    <span className="card-label">Saídas pagas</span>
                    <InfoTip
                      texto={
                        modoGeral
                          ? 'Total de gastos e parcelas que já saíram do seu saldo.'
                          : 'Gastos e parcelas já pagos neste mês.'
                      }
                    />
                  </div>
                  <strong className="card-value negative">
                    {formatarMoeda(resumo.saidasPagas)}
                  </strong>
                </div>

                <div className="card card-pendente">
                  <div className="card-label-row">
                    <span className="card-label">A pagar</span>
                    <InfoTip
                      texto={
                        modoGeral
                          ? 'Contas e parcelas pendentes que ainda vão sair do seu saldo.'
                          : 'Contas e parcelas pendentes neste mês.'
                      }
                    />
                  </div>
                  <strong className="card-value warning">
                    {formatarMoeda(resumo.saidasAPagar)}
                  </strong>
                  {resumo.dividasPendentes > 0 && (
                    <span className="card-sub">
                      Dívidas: {formatarMoeda(resumo.dividasPendentes)}
                    </span>
                  )}
                </div>
              </section>

              <Charts resumo={resumo} modoGeral={modoGeral} />

              <CalendarioDividas
                modo="geral"
                dividasTodas={lancamentosTodos}
                mesExterno={mes}
                onAlternarStatus={alternarStatus}
              />

              <ListaLancamentos
                titulo={
                  modoGeral
                    ? 'Lançamentos'
                    : `Lançamentos — ${formatarMesBonito(mes)}`
                }
                infoTexto="Suas entradas, saídas e dívidas. Use os filtros, a busca ou a setinha ao lado para recolher."
                lancamentos={lancamentos}
                carregando={carregando}
                mostrarFiltrosTipo={true}
                recolhivel={true}
                chaveRecolher={`financeiro_home_recolhido_${usuario.id}`}
                textoBotaoVazio="+ Adicionar lançamento"
                onAdicionar={() => abrirNovo('entrada')}
                onAlternarStatus={alternarStatus}
                onEditar={abrirEdicao}
                onEditarGrupo={setGrupoEditando}
                onExcluirUnico={pedirExclusaoUnico}
                onExcluirGrupo={pedirExclusaoGrupo}
              />
            </>
          )}

          {/* ==================== ABA 2: ENTRADAS & CARTEIRAS ==================== */}
          {secaoAtiva === 'entradas' && (
            <>
              {modoGeral && (
                <ContasSection
                  contas={contas}
                  saldoSemConta={saldoSemConta}
                  onAtualizar={() => carregarDados(mes)}
                />
              )}

              <section className="summary-grid">
                <div className="card">
                  <div className="card-label-row">
                    <span className="card-label">
                      {modoGeral ? 'Recebido' : 'Recebido no mês'}
                    </span>
                    <InfoTip texto="Total de entradas já recebidas neste período." />
                  </div>
                  <strong className="card-value positive">
                    {formatarMoeda(resumo.entradasRecebidas)}
                  </strong>
                </div>

                <div className="card card-salario">
                  <div className="card-top-row">
                    <div className="card-label-row">
                      <span className="card-label">Previsto para entrar</span>
                      <InfoTip texto="Soma do próximo salário fixo com eventuais entradas pendentes." />
                    </div>
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

                  <strong className="card-value info">
                    {formatarMoeda(
                      resumo.entradasPrevistas +
                        (salarioExibido ? salarioExibido.valor : 0)
                    )}
                  </strong>

                  {salarioExibido ? (
                    <>
                      <span className="card-sub">
                        <strong>{salarioExibido.titulo}</strong> •{' '}
                        {formatarData(salarioExibido.dataIso).slice(0, 5)}
                        {salarioExibido.contaNome
                          ? ` (${salarioExibido.contaNome})`
                          : ''}
                        {resumo.entradasPrevistas > 0
                          ? ` + ${formatarMoeda(resumo.entradasPrevistas)}`
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
                    <div className="salary-card-actions">
                      <button
                        type="button"
                        className="btn-small-primary"
                        onClick={() => setModoSalarioModal('configurar')}
                      >
                        + Adicionar salário
                      </button>
                    </div>
                  )}
                </div>

                <div className="card">
                  <div className="card-label-row">
                    <span className="card-label">Saldo disponível</span>
                    <InfoTip texto="Quanto resta após descontar as saídas pagas do saldo." />
                  </div>
                  <strong
                    className={`card-value ${resumo.saldoReal >= 0 ? 'positive' : 'negative'}`}
                  >
                    {formatarMoeda(resumo.saldoReal)}
                  </strong>
                </div>
              </section>

              <ListaLancamentos
                titulo={
                  modoGeral
                    ? 'Entradas'
                    : `Entradas — ${formatarMesBonito(mes)}`
                }
                lancamentos={listaEntradas}
                carregando={carregando}
                mostrarFiltrosTipo={false}
                textoBotaoVazio="+ Adicionar entrada"
                onAdicionar={() => abrirNovo('entrada')}
                onAlternarStatus={alternarStatus}
                onEditar={abrirEdicao}
                onEditarGrupo={setGrupoEditando}
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
                  <div className="card-label-row">
                    <span className="card-label">Pendente</span>
                    <InfoTip texto="Total de parcelas de dívidas ainda não pagas." />
                  </div>
                  <strong className="card-value warning">
                    {formatarMoeda(resumo.dividasPendentes)}
                  </strong>
                  {gruposDividasPendentes > 0 && (
                    <span className="card-sub">
                      {gruposDividasPendentes}{' '}
                      {gruposDividasPendentes === 1 ? 'dívida ativa' : 'dívidas ativas'}
                    </span>
                  )}
                </div>

                <div className="card">
                  <div className="card-label-row">
                    <span className="card-label">Já pago</span>
                    <InfoTip texto="Total de parcelas de dívidas já quitadas neste período." />
                  </div>
                  <strong className="card-value positive">
                    {formatarMoeda(dividasPagasTotal)}
                  </strong>
                </div>

                <div className="card">
                  <div className="card-label-row">
                    <span className="card-label">Próximo vencimento</span>
                    <InfoTip texto="Data e valor da próxima parcela pendente." />
                  </div>
                  <strong className="card-value">
                    {proximaDividaPendente
                      ? formatarData(proximaDividaPendente.data)
                      : 'Tudo em dia!'}
                  </strong>
                  {proximaDividaPendente && (
                    <span className="card-sub">
                      {proximaDividaPendente.titulo} ({formatarMoeda(proximaDividaPendente.valor)})
                    </span>
                  )}
                </div>
              </section>

              {/* Calendário visual de vencimentos de dívidas */}
              <CalendarioDividas
                dividasTodas={dividasCalendario}
                mesExterno={mes}
                onAlternarStatus={alternarStatus}
              />

              {/* Resumo por Cartão / Pessoa (quando houver dívidas com origem cadastrada) */}
              {temOrigemInformada && (
                <section className="panel origins-panel">
                  <div className="origins-header">
                    <div className="title-with-tip">
                      <h2>Por cartão / pessoa</h2>
                      <InfoTip
                        alinhamento="left"
                        texto="Clique em um cartão ou pessoa para filtrar somente as dívidas dele."
                      />
                    </div>
                    {filtroOrigemDivida && (
                      <button
                        type="button"
                        className="btn-small"
                        onClick={() => setFiltroOrigemDivida('')}
                      >
                        Mostrar todos
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
                              ? 'parcela'
                              : 'parcelas'}
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
                      ? 'Dívidas'
                      : `Dívidas — ${formatarMesBonito(mes)}`
                }
                lancamentos={listaDividasFiltradaPorOrigem}
                carregando={carregando}
                mostrarFiltrosTipo={false}
                textoBotaoVazio="+ Adicionar dívida"
                onAdicionar={() => abrirNovo('divida')}
                onAlternarStatus={alternarStatus}
                onEditar={abrirEdicao}
                onEditarGrupo={setGrupoEditando}
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
                  <div className="card-label-row">
                    <span className="card-label">Fixas / mês</span>
                    <InfoTip texto="Soma das suas despesas fixas mensais ativas." />
                  </div>
                  <strong className="card-value warning">
                    {formatarMoeda(totalDespesasFixasMensal)}
                  </strong>
                  {despesasFixasAtivas.length > 0 && (
                    <span className="card-sub">
                      {despesasFixasAtivas.length}{' '}
                      {despesasFixasAtivas.length === 1 ? 'conta ativa' : 'contas ativas'}
                    </span>
                  )}
                </div>

                <div className="card">
                  <div className="card-label-row">
                    <span className="card-label">Pagas</span>
                    <InfoTip texto="Gastos comuns já pagos neste período." />
                  </div>
                  <strong className="card-value negative">
                    {formatarMoeda(saidasPagasApenas)}
                  </strong>
                </div>

                <div className="card">
                  <div className="card-label-row">
                    <span className="card-label">Pendentes</span>
                    <InfoTip texto="Contas comuns que ainda faltam pagar." />
                  </div>
                  <strong className="card-value warning">
                    {formatarMoeda(saidasPendentesTotal)}
                  </strong>
                </div>
              </section>

              <DespesasFixasSection
                despesasFixas={despesasFixas}
                contas={contas}
                lancamentosTodos={lancamentosTodos}
                mesSelecionado={mes}
                onAtualizar={() => carregarDados(mes)}
              />

              <ListaLancamentos
                titulo={
                  modoGeral
                    ? 'Saídas'
                    : `Saídas — ${formatarMesBonito(mes)}`
                }
                lancamentos={listaSaidas}
                carregando={carregando}
                mostrarFiltrosTipo={false}
                textoBotaoVazio="+ Adicionar saída"
                onAdicionar={() => abrirNovo('saida')}
                onAlternarStatus={alternarStatus}
                onEditar={abrirEdicao}
                onEditarGrupo={setGrupoEditando}
                onExcluirUnico={pedirExclusaoUnico}
                onExcluirGrupo={pedirExclusaoGrupo}
              />
            </>
          )}

          {/* ==================== ABA 5: ESTATÍSTICAS E PROJEÇÃO ==================== */}
          {secaoAtiva === 'estatisticas' && (
            <EstatisticasView
              lancamentosTodos={lancamentosTodos}
              resumoGeral={resumoGeral}
              salarioConfig={salarioConfig}
              despesasFixas={despesasFixas}
              onConfigurarSalario={() => setModoSalarioModal('configurar')}
            />
          )}

          {/* ==================== ABA 6: METAS FINANCEIRAS ==================== */}
          {secaoAtiva === 'metas' && (
            <MetasView
              metas={metas}
              contas={contas}
              saldoReal={resumoGeral.saldoReal}
              abrirNovaSignal={abrirNovaMetaSignal}
              onAtualizar={() => carregarDados(mes)}
            />
          )}

          {/* ==================== MINHA CONTA (PERFIL) ==================== */}
          {secaoAtiva === 'minha_conta' && (
            <MinhaContaView
              usuario={usuario}
              lancamentosTodos={lancamentosTodos}
              contas={contas}
              metas={metas}
              despesasFixas={despesasFixas}
              salarioConfig={salarioConfig}
              onUsuarioAtualizado={onUsuarioAtualizado}
              onVoltar={() => setSecaoAtiva('visao_geral')}
            />
          )}

          {/* ==================== CENTRAL DE AJUDA ==================== */}
          {secaoAtiva === 'ajuda' && (
            <AjudaView onVoltar={() => setSecaoAtiva('visao_geral')} />
          )}
        </main>
      </div>

      {/* Gaveta lateral de Perfil */}
      <PerfilDrawer
        aberto={perfilAberto}
        usuario={usuario}
        qtdContas={contas.length}
        qtdMetas={metas.length}
        qtdLancamentos={lancamentosTodos.length}
        secaoAtiva={secaoAtiva}
        onFechar={() => setPerfilAberto(false)}
        onAbrirMinhaConta={() => setSecaoAtiva('minha_conta')}
        onAbrirAjuda={() => setSecaoAtiva('ajuda')}
        onSair={onSair}
      />

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

      <EditarGrupoModal
        grupo={grupoEditando}
        origensSugeridas={origensSugeridas}
        onFechar={() => setGrupoEditando(null)}
        onSalvo={() => carregarDados(mes)}
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
        proximo={salarioExibido}
        contas={contas}
        onFechar={() => setModoSalarioModal(null)}
        onAtualizado={() => carregarDados(mes)}
      />
    </div>
  );
}
