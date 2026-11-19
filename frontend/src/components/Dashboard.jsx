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

function mesAtualIso() {
  const hoje = new Date();
  const ano = hoje.getFullYear();
  const mes = String(hoje.getMonth() + 1).padStart(2, '0');
  return `${ano}-${mes}`;
}

function hojeIso() {
  const hoje = new Date();
  const ano = hoje.getFullYear();
  const mes = String(hoje.getMonth() + 1).padStart(2, '0');
  const dia = String(hoje.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}

export default function Dashboard({ usuario, onSair }) {
  const [mes, setMes] = useState(mesAtualIso);
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
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');

  // Campos do formulário de novo lançamento
  const [tipo, setTipo] = useState('entrada');
  const [titulo, setTitulo] = useState('');
  const [valor, setValor] = useState('');
  const [categoria, setCategoria] = useState('Salário');
  const [data, setData] = useState(hojeIso);
  const [status, setStatus] = useState('pago');
  const [salvando, setSalvando] = useState(false);

  // Busca os lançamentos do mês selecionado no servidor Node.js
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

  // useEffect roda automaticamente sempre que o "mes" mudar
  useEffect(() => {
    carregarDados(mes);
  }, [mes]);

  function trocarTipo(novoTipo) {
    setTipo(novoTipo);
    setCategoria(CATEGORIAS_POR_TIPO[novoTipo][0]);
    // Dívida geralmente começa como "pendente" (ainda vai pagar)
    if (novoTipo === 'divida') {
      setStatus('pendente');
    } else {
      setStatus('pago');
    }
  }

  async function handleCriar(e) {
    e.preventDefault();
    setErro('');
    setSalvando(true);

    try {
      const valorNumerico = Number(String(valor).replace(',', '.'));
      await api.criarLancamento({
        titulo,
        valor: valorNumerico,
        tipo,
        categoria,
        data,
        status,
      });

      setTitulo('');
      setValor('');

      // Se o lançamento foi em outro mês, pula para o mês dele; senão recarrega o atual
      const mesDoLancamento = data.slice(0, 7);
      if (mesDoLancamento !== mes) {
        setMes(mesDoLancamento);
      } else {
        await carregarDados(mes);
      }
    } catch (err) {
      setErro(err.message);
    } finally {
      setSalvando(false);
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

  const lancamentosFiltrados = lancamentos.filter((item) => {
    if (filtro === 'todos') return true;
    if (filtro === 'pendente') return item.status === 'pendente';
    return item.tipo === filtro;
  });

  return (
    <div className="dashboard">
      {/* Barra superior */}
      <header className="topbar">
        <div className="topbar-left">
          <div className="logo-badge small">R$</div>
          <div>
            <h1>Minhas Finanças</h1>
            <span className="greeting">Olá, {usuario.nome}</span>
          </div>
        </div>

        <div className="topbar-right">
          <label className="month-picker">
            <span>Mês:</span>
            <input
              type="month"
              value={mes}
              onChange={(e) => setMes(e.target.value)}
            />
          </label>
          <button type="button" className="btn-outline" onClick={onSair}>
            Sair
          </button>
        </div>
      </header>

      <main className="container">
        {erro && <div className="alert-error">{erro}</div>}

        {/* Cards de resumo do mês */}
        <section className="summary-grid">
          <div className="card card-entrada">
            <span className="card-label">Entradas (Positivo)</span>
            <strong className="card-value positive">
              {formatarMoeda(resumo.entradasRecebidas)}
            </strong>
            <span className="card-sub">
              {resumo.entradasPrevistas > 0
                ? `+ ${formatarMoeda(resumo.entradasPrevistas)} a receber`
                : 'Tudo que já entrou no mês'}
            </span>
          </div>

          <div className="card card-saida">
            <span className="card-label">Saídas Pagas (Negativo)</span>
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
            <span className="card-label">Saldo Atual do Mês</span>
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

        <div className="content-grid">
          {/* Formulário: adicionar entrada, saída ou dívida */}
          <section className="panel">
            <h2>Novo lançamento</h2>

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

            <form onSubmit={handleCriar} className="entry-form">
              <label className="field">
                <span>Descrição</span>
                <input
                  type="text"
                  placeholder={
                    tipo === 'entrada'
                      ? 'Ex.: Salário, Freelance...'
                      : tipo === 'divida'
                        ? 'Ex.: Fatura Cartão, Parcela 2/6...'
                        : 'Ex.: Mercado, Energia, Aluguel...'
                  }
                  value={titulo}
                  onChange={(e) => setTitulo(e.target.value)}
                  required
                />
              </label>

              <div className="field-row">
                <label className="field">
                  <span>Valor (R$)</span>
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
                  <span>Data</span>
                  <input
                    type="date"
                    value={data}
                    onChange={(e) => setData(e.target.value)}
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
                    {CATEGORIAS_POR_TIPO[tipo].map((cat) => (
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

              <button type="submit" className="btn-primary" disabled={salvando}>
                {salvando ? 'Salvando...' : 'Adicionar lançamento'}
              </button>
            </form>
          </section>

          {/* Lista de lançamentos do mês */}
          <section className="panel">
            <div className="panel-header">
              <h2>Lançamentos do mês</h2>
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
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {carregando ? (
              <p className="empty-state">Carregando lançamentos...</p>
            ) : lancamentosFiltrados.length === 0 ? (
              <p className="empty-state">
                Nenhum lançamento encontrado neste mês. Adicione seu salário, gastos ou dívidas ao lado!
              </p>
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
                        <strong>{item.titulo}</strong>
                      </div>
                      <span className="entry-meta">
                        {item.categoria} • {formatarData(item.data)} •{' '}
                        {item.status === 'pago'
                          ? item.tipo === 'entrada'
                            ? 'Recebido'
                            : 'Pago'
                          : item.tipo === 'entrada'
                            ? 'Previsto'
                            : 'Pendente (vai sair)'}
                      </span>
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
                        className="btn-small"
                        onClick={() => alternarStatus(item)}
                        title="Alternar entre Pago e Pendente"
                      >
                        {item.status === 'pago' ? 'Marcar pendente' : 'Marcar pago'}
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
        </div>
      </main>
    </div>
  );
}
