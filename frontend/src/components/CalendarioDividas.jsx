import { useEffect, useMemo, useState } from 'react';
import InfoTip from './InfoTip.jsx';

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

const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function formatarMoeda(valor) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(valor || 0);
}

function formatarDiaMes(dataIso) {
  if (!dataIso) return '';
  const [, mes, dia] = dataIso.split('-');
  return `${dia}/${mes}`;
}

function hojeIso() {
  const h = new Date();
  return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, '0')}-${String(h.getDate()).padStart(2, '0')}`;
}

function mesHojeIso() {
  return hojeIso().slice(0, 7);
}

function moverMesIso(mesIso, delta) {
  const [ano, mes] = mesIso.split('-').map(Number);
  const total = ano * 12 + (mes - 1) + delta;
  const novoAno = Math.floor(total / 12);
  const novoMes = (total % 12) + 1;
  return `${novoAno}-${String(novoMes).padStart(2, '0')}`;
}

function CheckSvg() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3.2 8.4 6.5 11.6 12.8 4.8" />
    </svg>
  );
}

function indicadorTooltipItem(item, ehGeral) {
  if (!ehGeral) return item.status === 'pago' ? 'check' : 'pendente';
  if (item.tipo === 'entrada') return 'entrada';
  if (item.tipo === 'divida') return item.status === 'pago' ? 'check' : 'pendente';
  if (item.status === 'pendente') return 'pendente';
  return 'saida';
}

/**
 * Calendário visual mensal reutilizável:
 * - modo="dividas": foco nos vencimentos das parcelas de dívidas (pendentes em âmbar, pagas em verde)
 * - modo="geral": mostra entradas (verde), saídas (vermelho) e dívidas/pendentes (âmbar) em cada dia do mês
 */
export default function CalendarioDividas({
  modo = 'dividas',
  dividasTodas = [],
  mesExterno,
  onAlternarStatus,
}) {
  const ehGeral = modo === 'geral';
  const hoje = hojeIso();
  const mesAtual = mesHojeIso();

  const [mesVisivel, setMesVisivel] = useState(() => mesExterno || mesAtual);
  const [diaSelecionado, setDiaSelecionado] = useState(null);
  const [diaHover, setDiaHover] = useState(null);

  // Sincroniza quando o usuário navega pelos meses na barra superior ("Por mês")
  useEffect(() => {
    if (mesExterno) {
      setMesVisivel(mesExterno);
      setDiaSelecionado(null);
    }
  }, [mesExterno]);

  const [ano, mesNum] = mesVisivel.split('-').map(Number);

  // Agrupa lançamentos do mês visível por data YYYY-MM-DD
  const {
    porDia,
    listaMes,
    totalPendenteMes,
    totalPagoMes,
    totalEntradasMes,
    totalSaidasMes,
  } = useMemo(() => {
    const mapa = {};
    const doMes = [];
    let pendente = 0;
    let pago = 0;
    let entradas = 0;
    let saidas = 0;

    for (const item of dividasTodas) {
      if (!item.data || item.data.slice(0, 7) !== mesVisivel) continue;
      if (!mapa[item.data]) mapa[item.data] = [];
      mapa[item.data].push(item);
      doMes.push(item);

      if (item.tipo === 'entrada') {
        entradas += item.valor;
      } else {
        saidas += item.valor;
        if (item.status === 'pendente') pendente += item.valor;
        else pago += item.valor;
      }
    }

    doMes.sort((a, b) => a.data.localeCompare(b.data) || a.id - b.id);

    return {
      porDia: mapa,
      listaMes: doMes,
      totalPendenteMes: pendente,
      totalPagoMes: pago,
      totalEntradasMes: entradas,
      totalSaidasMes: saidas,
    };
  }, [dividasTodas, mesVisivel]);

  // Monta as células da grade mensal
  const celulas = useMemo(() => {
    const primeiroDiaSemana = new Date(ano, mesNum - 1, 1).getDay();
    const qtdDias = new Date(ano, mesNum, 0).getDate();
    const lista = [];

    for (let i = 0; i < primeiroDiaSemana; i++) {
      lista.push({ vazio: true, key: `v-${i}` });
    }
    for (let d = 1; d <= qtdDias; d++) {
      const iso = `${ano}-${String(mesNum).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const itens = porDia[iso] || [];
      const entradasDia = itens.filter((i) => i.tipo === 'entrada');
      const pendentes = itens.filter((i) => i.tipo !== 'entrada' && i.status === 'pendente');
      const dividasPagasDia = itens.filter(
        (i) => i.tipo === 'divida' && i.status === 'pago'
      );
      const saidasPagasDia = itens.filter(
        (i) => i.tipo === 'saida' && i.status === 'pago'
      );
      const totalDia = itens.reduce((acc, i) => acc + i.valor, 0);
      const totalPendenteDia = pendentes.reduce((acc, i) => acc + i.valor, 0);
      const saldoLiquidoDia = itens.reduce(
        (acc, i) => acc + (i.tipo === 'entrada' ? i.valor : -i.valor),
        0
      );
      const colSemana = (primeiroDiaSemana + d - 1) % 7;

      lista.push({
        vazio: false,
        key: iso,
        dia: d,
        iso,
        itens,
        entradasDia,
        dividasPagasDia,
        saidasPagasDia,
        pendentes,
        totalDia,
        totalPendenteDia,
        saldoLiquidoDia,
        ehHoje: iso === hoje,
        colSemana,
      });
    }
    return lista;
  }, [ano, mesNum, porDia, hoje]);

  const itensDiaSelecionado = diaSelecionado ? porDia[diaSelecionado] || [] : [];

  function trocarMes(delta) {
    setMesVisivel((m) => moverMesIso(m, delta));
    setDiaSelecionado(null);
    setDiaHover(null);
  }

  return (
    <section className="panel cal-panel">
      <div className="cal-top">
        <div className="title-with-tip">
          <h2>{ehGeral ? 'Calendário do mês' : 'Calendário de vencimentos'}</h2>
          <InfoTip
            alinhamento="left"
            texto={
              ehGeral
                ? 'Veja entradas, saídas e dívidas em cada dia do mês. Passe o mouse ou clique em um dia para ver os detalhes.'
                : 'Passe o mouse sobre um dia destacado para ver as parcelas ou clique para fixar e marcar como paga.'
            }
          />
        </div>

        <div className="cal-nav">
          <button
            type="button"
            className="month-arrow"
            onClick={() => trocarMes(-1)}
            title="Mês anterior"
          >
            ‹
          </button>
          <span className="cal-month-title">
            {NOMES_MESES[mesNum - 1]} de {ano}
          </span>
          <button
            type="button"
            className="month-arrow"
            onClick={() => trocarMes(1)}
            title="Próximo mês"
          >
            ›
          </button>
          {mesVisivel !== mesAtual && (
            <button
              type="button"
              className="btn-small"
              onClick={() => {
                setMesVisivel(mesAtual);
                setDiaSelecionado(null);
              }}
            >
              Hoje
            </button>
          )}
        </div>
      </div>

      <div className="cal-split">
        {/* Esquerda: Grade do Calendário */}
        <div className="cal-grid-wrap">
          <div className="cal-weekdays">
            {DIAS_SEMANA.map((nome) => (
              <span key={nome} className="cal-weekday">
                {nome}
              </span>
            ))}
          </div>

          <div className="cal-days">
            {celulas.map((cel) => {
              if (cel.vazio) {
                return <div key={cel.key} className="cal-cell empty" />;
              }

              const temItens = cel.itens.length > 0;
              const temPendente = cel.pendentes.length > 0;
              const temEntrada = cel.entradasDia.length > 0;
              const temDividaPaga = cel.dividasPagasDia.length > 0;
              const temSaidaPaga = cel.saidasPagasDia.length > 0;
              const tudoPagoDividas = !ehGeral && temItens && !temPendente;
              const selecionado = diaSelecionado === cel.iso;
              const mostrarTooltip = temItens && diaHover === cel.iso;

              const alignClass =
                cel.colSemana <= 1
                  ? 'align-left'
                  : cel.colSemana >= 5
                    ? 'align-right'
                    : 'align-center';

              // Regra limpa de destaque e ícone único por dia no modo geral:
              // 1) Se ainda tem dívida/conta pendente -> âmbar + bolinha amarela
              // 2) Se teve entrada no dia -> compara saldo líquido do dia:
              //    - Sobrou (>= 0) -> verde + só "R$"
              //    - Saiu mais (< 0) -> vermelho + só bolinha vermelha
              // 3) Se teve dívida quitada (sem entrada nem pendência) -> verde + "✓"
              // 4) Só saída paga -> vermelho + bolinha vermelha
              const estadoGeral = !temItens
                ? null
                : temPendente
                  ? 'pendente'
                  : temEntrada
                    ? cel.saldoLiquidoDia >= 0
                      ? 'positivo'
                      : 'negativo'
                    : temDividaPaga
                      ? 'quitado'
                      : 'negativo';

              const classeDestaque = ehGeral
                ? estadoGeral === 'pendente'
                  ? 'has-pending'
                  : estadoGeral === 'positivo' || estadoGeral === 'quitado'
                    ? 'has-paid'
                    : estadoGeral === 'negativo'
                      ? 'has-expense'
                      : ''
                : temPendente
                  ? 'has-pending'
                  : tudoPagoDividas
                    ? 'has-paid'
                    : '';

              return (
                <div
                  key={cel.key}
                  className="cal-cell-wrap"
                  onMouseEnter={() => temItens && setDiaHover(cel.iso)}
                  onMouseLeave={() =>
                    setDiaHover((atual) => (atual === cel.iso ? null : atual))
                  }
                >
                  <button
                    type="button"
                    className={[
                      'cal-cell',
                      cel.ehHoje ? 'today' : '',
                      classeDestaque,
                      selecionado ? 'selected' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onClick={() =>
                      temItens
                        ? setDiaSelecionado((atual) =>
                            atual === cel.iso ? null : cel.iso
                          )
                        : setDiaSelecionado(null)
                    }
                  >
                    <span className="cal-day-num">{cel.dia}</span>

                    {temItens && (
                      <span className="cal-dots" aria-hidden="true">
                        {ehGeral ? (
                          estadoGeral === 'pendente' ? (
                            <span className="cal-dot pendente" />
                          ) : estadoGeral === 'positivo' ? (
                            <span className="cal-money-badge" title="Saldo positivo no dia">
                              R$
                            </span>
                          ) : estadoGeral === 'quitado' ? (
                            <span className="cal-check" title="Quitado">
                              <CheckSvg />
                            </span>
                          ) : (
                            <span className="cal-dot saida" />
                          )
                        ) : temPendente ? (
                          <span className="cal-badge pending">
                            {cel.pendentes.length}
                          </span>
                        ) : (
                          <span className="cal-check" title="Quitado">
                            <CheckSvg />
                          </span>
                        )}
                      </span>
                    )}
                  </button>

                  {mostrarTooltip && (
                    <div className={`cal-tooltip ${alignClass}`} role="tooltip">
                      <div className="cal-tooltip-head">
                        <strong>Dia {formatarDiaMes(cel.iso)}</strong>
                        {ehGeral ? (
                          <span
                            className={
                              cel.saldoLiquidoDia >= 0 ? 'positive' : 'negative'
                            }
                          >
                            {cel.saldoLiquidoDia >= 0 ? '+' : ''}
                            {formatarMoeda(cel.saldoLiquidoDia)}
                          </span>
                        ) : (
                          <span className={temPendente ? 'warning' : 'positive'}>
                            {formatarMoeda(
                              temPendente ? cel.totalPendenteDia : cel.totalDia
                            )}
                          </span>
                        )}
                      </div>
                      <ul className="cal-tooltip-list">
                        {cel.itens.slice(0, 4).map((item) => {
                          const indicador = indicadorTooltipItem(item, ehGeral);
                          return (
                            <li key={item.id}>
                              {indicador === 'check' ? (
                                <span className="cal-tooltip-check" aria-label="Pago">
                                  <CheckSvg />
                                </span>
                              ) : indicador === 'entrada' ? (
                                <span className="cal-tooltip-money" aria-label="Entrada">
                                  R$
                                </span>
                              ) : (
                                <span className={`cal-tooltip-dot ${indicador}`} />
                              )}
                              <span className="cal-tooltip-title">{item.titulo}</span>
                              <strong
                                className={
                                  indicador === 'check' || (ehGeral && item.tipo === 'entrada')
                                    ? 'positive'
                                    : ''
                                }
                              >
                                {ehGeral
                                  ? `${item.tipo === 'entrada' ? '+' : '-'} ${formatarMoeda(item.valor)}`
                                  : formatarMoeda(item.valor)}
                              </strong>
                            </li>
                          );
                        })}
                        {cel.itens.length > 4 && (
                          <li className="cal-tooltip-more">
                            + {cel.itens.length - 4} item(ns)
                          </li>
                        )}
                      </ul>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="cal-legend">
            {ehGeral ? (
              <>
                <span>
                  <i className="cal-legend-money">R$</i>
                  Entrada
                </span>
                <span>
                  <i className="cal-legend-dot pending" />
                  Dívida / A pagar
                </span>
                <span>
                  <i className="cal-legend-dot paid" />
                  Quitada
                </span>
                <span>
                  <i className="cal-legend-dot expense" />
                  Saída paga
                </span>
                <span>
                  <i className="cal-legend-dot today" />
                  Hoje
                </span>
              </>
            ) : (
              <>
                <span>
                  <i className="cal-legend-dot pending" />
                  Parcela pendente
                </span>
                <span>
                  <i className="cal-legend-dot paid" />
                  Quitada
                </span>
                <span>
                  <i className="cal-legend-dot today" />
                  Hoje
                </span>
              </>
            )}
          </div>
        </div>

        {/* Direita: Detalhes do dia clicado ou resumo do mês */}
        <aside className="cal-side">
          <div className="cal-side-header">
            {diaSelecionado ? (
              <>
                <div>
                  <span className="cal-side-label">
                    {ehGeral ? 'Movimentações do dia' : 'Parcelas do dia'}
                  </span>
                  <strong>
                    {formatarDiaMes(diaSelecionado)}/{ano}
                  </strong>
                </div>
                <button
                  type="button"
                  className="btn-link"
                  onClick={() => setDiaSelecionado(null)}
                >
                  Ver mês todo
                </button>
              </>
            ) : ehGeral ? (
              <>
                <div>
                  <span className="cal-side-label">
                    Resumo de {NOMES_MESES[mesNum - 1]}
                  </span>
                  <div className="cal-side-summary-row">
                    <strong className="positive">
                      + {formatarMoeda(totalEntradasMes)}
                    </strong>
                    <strong className="negative">
                      − {formatarMoeda(totalSaidasMes)}
                    </strong>
                  </div>
                </div>
                {listaMes.length > 0 && (
                  <span className="count-chip">{listaMes.length}</span>
                )}
              </>
            ) : (
              <>
                <div>
                  <span className="cal-side-label">
                    Vencimentos em {NOMES_MESES[mesNum - 1]}
                  </span>
                  <strong className={totalPendenteMes > 0 ? 'warning' : 'positive'}>
                    {totalPendenteMes > 0
                      ? `${formatarMoeda(totalPendenteMes)} a pagar`
                      : totalPagoMes > 0
                        ? `Tudo pago (${formatarMoeda(totalPagoMes)})`
                        : 'Livre de dívidas'}
                  </strong>
                </div>
                {listaMes.length > 0 && (
                  <span className="count-chip">{listaMes.length}</span>
                )}
              </>
            )}
          </div>

          {(() => {
            const listaExibir = diaSelecionado ? itensDiaSelecionado : listaMes;
            if (listaExibir.length === 0) {
              return (
                <div className="cal-side-empty">
                  {ehGeral
                    ? 'Nenhum lançamento registrado neste mês.'
                    : 'Nenhuma parcela prevista para este mês.'}
                </div>
              );
            }

            return (
              <ul className="cal-side-list">
                {listaExibir.map((item) => {
                  const ehEntrada = item.tipo === 'entrada';
                  const textoBotao = ehEntrada
                    ? item.status === 'pago'
                      ? 'Desfazer'
                      : 'Receber'
                    : item.status === 'pago'
                      ? 'Desfazer'
                      : 'Pagar';

                  return (
                    <li
                      key={item.id}
                      className={`cal-side-item ${item.status}`}
                      onClick={() => setDiaSelecionado(item.data)}
                    >
                      <div className="cal-side-item-info">
                        <div className="cal-side-item-top">
                          <span className="cal-date-chip">
                            {formatarDiaMes(item.data)}
                          </span>
                          <strong className="cal-side-item-title">
                            {item.titulo}
                          </strong>
                        </div>
                        <div className="cal-side-item-meta">
                          {ehGeral && (
                            <span className={`badge ${item.tipo}`}>
                              {item.tipo === 'entrada'
                                ? 'Entrada'
                                : item.tipo === 'divida'
                                  ? 'Dívida'
                                  : 'Saída'}
                            </span>
                          )}
                          {item.origem_divida && (
                            <span className="origin-pill">{item.origem_divida}</span>
                          )}
                          <span className={`status-dot ${item.status}`}>
                            {item.status === 'pago'
                              ? ehEntrada
                                ? 'Recebido'
                                : 'Pago'
                              : 'Pendente'}
                          </span>
                        </div>
                      </div>

                      <div className="cal-side-item-right">
                        <strong
                          className={`cal-side-amount ${
                            ehGeral
                              ? ehEntrada
                                ? 'positive'
                                : item.status === 'pendente'
                                  ? 'warning'
                                  : 'negative'
                              : ''
                          }`}
                        >
                          {ehGeral ? (ehEntrada ? '+ ' : '- ') : ''}
                          {formatarMoeda(item.valor)}
                        </strong>
                        <button
                          type="button"
                          className={item.status === 'pago' ? 'btn-small' : 'btn-pay'}
                          onClick={(e) => {
                            e.stopPropagation();
                            onAlternarStatus(item);
                          }}
                        >
                          {textoBotao}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            );
          })()}
        </aside>
      </div>
    </section>
  );
}
