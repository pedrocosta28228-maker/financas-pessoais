import { useState } from 'react';

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

function nomeBaseParcela(titulo) {
  return titulo.replace(/\s*\(\d+\/\d+\)\s*$/, '').trim();
}

/**
 * Agrupa lançamentos que pertencem ao mesmo "grupo_parcela" em um único item
 * expansível (acordeão), evitando poluir a lista com dezenas de linhas.
 */
export function agruparLancamentos(lista) {
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
        origemDivida: item.origem_divida || '',
        parcelas: [],
      };
      mapaGrupos.set(item.grupo_parcela, grupo);
      resultado.push(grupo);
    }

    mapaGrupos.get(item.grupo_parcela).parcelas.push(item);
  }

  return resultado.map((entrada) => {
    if (entrada.tipoItem === 'unico') return entrada;

    if (entrada.parcelas.length === 1) {
      return {
        tipoItem: 'unico',
        item: entrada.parcelas[0],
        dataOrdem: entrada.parcelas[0].data,
      };
    }

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

/**
 * Lista reutilizável de lançamentos (usada na Visão Geral, Entradas, Dívidas e Saídas).
 */
export default function ListaLancamentos({
  titulo,
  lancamentos,
  carregando,
  mostrarFiltrosTipo = true,
  recolhivel = false,
  chaveRecolher = '',
  textoBotaoVazio = '+ Adicionar lançamento',
  onAdicionar,
  onAlternarStatus,
  onEditar,
  onExcluirUnico,
  onExcluirGrupo,
}) {
  const [filtro, setFiltro] = useState('todos');
  const [busca, setBusca] = useState('');
  const [gruposAbertos, setGruposAbertos] = useState({});
  const [recolhido, setRecolhido] = useState(() => {
    if (!recolhivel || !chaveRecolher) return false;
    return localStorage.getItem(chaveRecolher) === 'true';
  });

  function alternarRecolhido() {
    setRecolhido((atual) => {
      const proximo = !atual;
      if (chaveRecolher) {
        localStorage.setItem(chaveRecolher, String(proximo));
      }
      return proximo;
    });
  }

  function alternarGrupo(grupoId) {
    setGruposAbertos((prev) => ({ ...prev, [grupoId]: !prev[grupoId] }));
  }

  const termoBusca = busca.trim().toLowerCase();

  const lancamentosFiltrados = lancamentos.filter((item) => {
    const passaFiltro =
      filtro === 'todos'
        ? true
        : filtro === 'pendente'
          ? item.status === 'pendente'
          : filtro === 'pago'
            ? item.status === 'pago'
            : item.tipo === filtro;

    const passaBusca =
      !termoBusca ||
      item.titulo.toLowerCase().includes(termoBusca) ||
      item.categoria.toLowerCase().includes(termoBusca) ||
      (item.origem_divida || '').toLowerCase().includes(termoBusca) ||
      (item.conta_nome || '').toLowerCase().includes(termoBusca);

    return passaFiltro && passaBusca;
  });

  const itensExibidos = agruparLancamentos(lancamentosFiltrados);
  const todosAgrupados = agruparLancamentos(lancamentos);

  const opcoesFiltro = mostrarFiltrosTipo
    ? [
        { id: 'todos', label: 'Todos', count: todosAgrupados.length },
        {
          id: 'entrada',
          label: 'Entradas',
          count: todosAgrupados.filter((e) =>
            e.tipoItem === 'unico' ? e.item.tipo === 'entrada' : e.tipo === 'entrada'
          ).length,
        },
        {
          id: 'saida',
          label: 'Saídas',
          count: todosAgrupados.filter((e) =>
            e.tipoItem === 'unico' ? e.item.tipo === 'saida' : e.tipo === 'saida'
          ).length,
        },
        {
          id: 'divida',
          label: 'Dívidas',
          count: todosAgrupados.filter((e) =>
            e.tipoItem === 'unico' ? e.item.tipo === 'divida' : e.tipo === 'divida'
          ).length,
        },
        {
          id: 'pendente',
          label: 'A Pagar',
          count: todosAgrupados.filter((e) =>
            e.tipoItem === 'unico' ? e.item.status === 'pendente' : e.qtdPendentes > 0
          ).length,
        },
      ]
    : [
        { id: 'todos', label: 'Todos', count: todosAgrupados.length },
        {
          id: 'pendente',
          label: 'Pendentes',
          count: todosAgrupados.filter((e) =>
            e.tipoItem === 'unico' ? e.item.status === 'pendente' : e.qtdPendentes > 0
          ).length,
        },
        {
          id: 'pago',
          label: 'Concluídos',
          count: todosAgrupados.filter((e) =>
            e.tipoItem === 'unico' ? e.item.status === 'pago' : e.qtdPagas > 0
          ).length,
        },
      ];

  return (
    <section className="panel entries-panel">
      <div className="entries-header">
        <div className="entries-title-area">
          <div>
            <h2>{titulo}</h2>
            <span className="chart-subtitle">
              {recolhido
                ? `${todosAgrupados.length} ${todosAgrupados.length === 1 ? 'item oculto' : 'itens ocultos'}`
                : `${itensExibidos.length} ${itensExibidos.length === 1 ? 'item exibido' : 'itens exibidos'}`}
            </span>
          </div>

          {recolhivel && (
            <button
              type="button"
              className="btn-collapse"
              onClick={alternarRecolhido}
            >
              {recolhido ? 'Expandir ▾' : 'Recolher ▴'}
            </button>
          )}
        </div>

        {!recolhido && (
          <div className="entries-toolbar">
            <input
              type="search"
              className="search-input"
              placeholder="Buscar descrição, cartão ou carteira..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />

            <div className="filter-pills">
              {opcoesFiltro.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className={filtro === f.id ? 'pill active' : 'pill'}
                  onClick={() => setFiltro(f.id)}
                >
                  {f.label} <span className="pill-count">{f.count}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {recolhido ? null : carregando ? (
        <p className="empty-state">Carregando lançamentos...</p>
      ) : itensExibidos.length === 0 ? (
        <div className="empty-box">
          <p className="empty-state">
            {termoBusca
              ? `Nenhum registro encontrado para "${busca}".`
              : 'Nenhum registro encontrado aqui ainda.'}
          </p>
          {!termoBusca && onAdicionar && (
            <button type="button" className="btn-add" onClick={onAdicionar}>
              {textoBotaoVazio}
            </button>
          )}
        </div>
      ) : (
        <ul className="entry-list">
          {itensExibidos.map((entrada) => {
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
                      {item.origem_divida && (
                        <span className="origin-pill">{item.origem_divida}</span>
                      )}
                      {item.conta_nome && (
                        <span className="wallet-inline-pill">
                          <span
                            className="wallet-dot tiny"
                            style={{ backgroundColor: item.conta_cor || '#3b82f6' }}
                          />
                          {item.conta_nome}
                        </span>
                      )}
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
                      className={item.status === 'pendente' ? 'btn-pay' : 'btn-small'}
                      onClick={() => onAlternarStatus(item)}
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
                      onClick={() => onEditar(item)}
                    >
                      Editar
                    </button>

                    <button
                      type="button"
                      className="btn-delete"
                      onClick={() => onExcluirUnico(item)}
                    >
                      Excluir
                    </button>
                  </div>
                </li>
              );
            }

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
                      {entrada.origemDivida && (
                        <span className="origin-pill">{entrada.origemDivida}</span>
                      )}
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
                        -{' '}
                        {formatarMoeda(
                          entrada.todosPagos
                            ? entrada.valorTotal
                            : entrada.valorRestante
                        )}
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
                      onClick={() => onExcluirGrupo(entrada)}
                      title="Excluir todas as parcelas desta dívida"
                    >
                      Excluir todas
                    </button>
                  </div>
                </div>

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
                            onClick={() => onAlternarStatus(parcela)}
                          >
                            {parcela.status === 'pago'
                              ? 'Desfazer pago'
                              : 'Marcar pago'}
                          </button>

                          <button
                            type="button"
                            className="btn-small"
                            onClick={() => onEditar(parcela)}
                          >
                            Editar
                          </button>

                          <button
                            type="button"
                            className="btn-delete"
                            onClick={() => onExcluirUnico(parcela)}
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
  );
}
