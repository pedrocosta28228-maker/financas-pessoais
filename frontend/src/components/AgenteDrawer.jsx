import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

const SUGESTOES_INICIAIS = [
  'Como está meu mês?',
  'Quanto sobra depois das dívidas?',
  'Quero lançar um gasto',
  'Posso parcelar uma compra de R$ 600 em 3x?',
];

const TITULOS_ACAO = {
  criar_lancamento: 'Confirmar novo lançamento',
  marcar_pago: 'Confirmar pagamento',
  criar_meta: 'Confirmar nova meta',
  criar_despesa_fixa: 'Confirmar despesa fixa',
};

/**
 * Gaveta lateral do Assistente Financeiro (IA).
 * Conversa com os dados reais do usuário e exige confirmação em 1 clique
 * antes de gravar qualquer lançamento, pagamento, meta ou despesa fixa.
 */
export default function AgenteDrawer({ aberto, onFechar, onDadosAlterados }) {
  const [statusAgente, setStatusAgente] = useState({ configurado: true, modelo: '' });
  const [mensagens, setMensagens] = useState([]);
  const [carregandoInicial, setCarregandoInicial] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [limpando, setLimpando] = useState(false);
  const [texto, setTexto] = useState('');
  const [erro, setErro] = useState('');
  const [acoesProcessando, setAcoesProcessando] = useState({});

  const fimListaRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!aberto) return;
    function onKeyDown(e) {
      if (e.key === 'Escape') onFechar();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [aberto, onFechar]);

  useEffect(() => {
    if (!aberto) return;
    let ativo = true;

    async function carregar() {
      setCarregandoInicial(true);
      setErro('');
      try {
        const [st, hist] = await Promise.all([
          api.agenteStatus(),
          api.agenteHistorico(),
        ]);
        if (!ativo) return;
        setStatusAgente(st);
        setMensagens(hist.mensagens || []);
      } catch (err) {
        if (ativo) setErro(err.message || 'Não foi possível carregar o assistente.');
      } finally {
        if (ativo) setCarregandoInicial(false);
      }
    }

    carregar();
    return () => {
      ativo = false;
    };
  }, [aberto]);

  useEffect(() => {
    if (!aberto) return;
    fimListaRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [aberto, mensagens, enviando]);

  useEffect(() => {
    if (aberto && !carregandoInicial && statusAgente.configurado) {
      inputRef.current?.focus();
    }
  }, [aberto, carregandoInicial, statusAgente.configurado]);

  if (!aberto) return null;

  async function enviar(conteudoOpcional) {
    const mensagemLimpa = String(conteudoOpcional ?? texto).trim();
    if (!mensagemLimpa || enviando || !statusAgente.configurado) return;

    setErro('');
    setEnviando(true);
    setTexto('');

    const msgOtimista = {
      id: `temp-${Date.now()}`,
      papel: 'usuario',
      conteudo: mensagemLimpa,
      acoes: [],
      temporaria: true,
    };
    setMensagens((prev) => [...prev, msgOtimista]);

    try {
      const res = await api.agenteEnviarMensagem(mensagemLimpa);
      setMensagens((prev) => [
        ...prev.filter((m) => m.id !== msgOtimista.id),
        res.mensagemUsuario,
        res.mensagemAssistente,
      ]);
    } catch (err) {
      setMensagens((prev) => prev.filter((m) => m.id !== msgOtimista.id));
      setTexto(mensagemLimpa);
      setErro(err.message || 'Erro ao conversar com o assistente.');
    } finally {
      setEnviando(false);
    }
  }

  function atualizarStatusAcaoLocal(acaoAtualizada) {
    setMensagens((prev) =>
      prev.map((msg) => ({
        ...msg,
        acoes: (msg.acoes || []).map((a) =>
          a.id === acaoAtualizada.id ? acaoAtualizada : a
        ),
      }))
    );
  }

  async function handleConfirmarAcao(acaoId) {
    if (acoesProcessando[acaoId]) return;
    setErro('');
    setAcoesProcessando((prev) => ({ ...prev, [acaoId]: 'confirmando' }));
    try {
      const res = await api.agenteConfirmarAcao(acaoId);
      atualizarStatusAcaoLocal(res.acao);
      onDadosAlterados?.();
    } catch (err) {
      setErro(err.message || 'Não foi possível confirmar esta ação.');
    } finally {
      setAcoesProcessando((prev) => {
        const proximo = { ...prev };
        delete proximo[acaoId];
        return proximo;
      });
    }
  }

  async function handleCancelarAcao(acaoId) {
    if (acoesProcessando[acaoId]) return;
    setErro('');
    setAcoesProcessando((prev) => ({ ...prev, [acaoId]: 'cancelando' }));
    try {
      const res = await api.agenteCancelarAcao(acaoId);
      atualizarStatusAcaoLocal(res.acao);
    } catch (err) {
      setErro(err.message || 'Não foi possível cancelar esta ação.');
    } finally {
      setAcoesProcessando((prev) => {
        const proximo = { ...prev };
        delete proximo[acaoId];
        return proximo;
      });
    }
  }

  async function handleLimparConversa() {
    if (limpando || enviando) return;
    setLimpando(true);
    setErro('');
    try {
      await api.agenteLimparHistorico();
      setMensagens([]);
    } catch (err) {
      setErro(err.message || 'Não foi possível limpar a conversa.');
    } finally {
      setLimpando(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      enviar();
    }
  }

  return (
    <div className="drawer-backdrop" onClick={onFechar}>
      <aside
        className="agente-drawer"
        onClick={(e) => e.stopPropagation()}
        aria-label="Assistente Financeiro"
      >
        <header className="agente-header">
          <div className="agente-header-title">
            <span className="agente-header-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9L12 3z" />
                <path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15z" />
              </svg>
            </span>
            <div>
              <h2>Assistente Financeiro</h2>
              <span>Análise real e lançamentos com confirmação</span>
            </div>
          </div>

          <div className="agente-header-actions">
            {mensagens.length > 0 && (
              <button
                type="button"
                className="agente-clear-btn"
                onClick={handleLimparConversa}
                disabled={limpando || enviando}
                title="Limpar histórico da conversa"
              >
                {limpando ? 'Limpando...' : 'Limpar'}
              </button>
            )}
            <button
              type="button"
              className="modal-close"
              onClick={onFechar}
              aria-label="Fechar assistente"
            >
              ×
            </button>
          </div>
        </header>

        {!statusAgente.configurado && (
          <div className="agente-alert-config">
            <strong>Assistente ainda não ativado:</strong> adicione a variável{' '}
            <code>GEMINI_API_KEY</code> (gratuita no Google AI Studio) no arquivo{' '}
            <code>backend/.env</code> ou nas variáveis do Render e reinicie o servidor.
          </div>
        )}

        <div className="agente-messages">
          {carregandoInicial ? (
            <p className="agente-empty-hint">Carregando conversa...</p>
          ) : mensagens.length === 0 ? (
            <div className="agente-welcome">
              <p>
                Olá! Posso analisar seu saldo, dívidas, cartões, projeção dos próximos meses
                e preparar lançamentos para você aprovar em 1 clique.
              </p>
              <div className="agente-chips">
                {SUGESTOES_INICIAIS.map((sugestao) => (
                  <button
                    key={sugestao}
                    type="button"
                    className="agente-chip"
                    onClick={() => enviar(sugestao)}
                    disabled={!statusAgente.configurado || enviando}
                  >
                    {sugestao}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            mensagens.map((msg) => (
              <div
                key={msg.id}
                className={`agente-msg-group ${msg.papel === 'usuario' ? 'user' : 'assistant'}`}
              >
                <div className={`agente-bubble ${msg.papel === 'usuario' ? 'user' : 'assistant'}`}>
                  {msg.conteudo}
                </div>

                {Array.isArray(msg.acoes) && msg.acoes.length > 0 && (
                  <div className="agente-actions-list">
                    {msg.acoes.map((acao) => {
                      const estadoProc = acoesProcessando[acao.id];
                      return (
                        <div key={acao.id} className={`agente-action-card status-${acao.status}`}>
                          <div className="agente-action-top">
                            <span className="agente-action-title">
                              {TITULOS_ACAO[acao.tipoAcao] || 'Confirmar ação'}
                            </span>
                            {acao.status === 'confirmada' && (
                              <span className="agente-action-badge confirmed">Confirmado</span>
                            )}
                            {acao.status === 'cancelada' && (
                              <span className="agente-action-badge cancelled">Cancelado</span>
                            )}
                          </div>

                          <p className="agente-action-summary">{acao.resumo}</p>

                          {acao.status === 'pendente' && (
                            <div className="agente-action-buttons">
                              <button
                                type="button"
                                className="agente-btn-confirm"
                                onClick={() => handleConfirmarAcao(acao.id)}
                                disabled={Boolean(estadoProc)}
                              >
                                {estadoProc === 'confirmando' ? 'Salvando...' : 'Confirmar'}
                              </button>
                              <button
                                type="button"
                                className="agente-btn-cancel"
                                onClick={() => handleCancelarAcao(acao.id)}
                                disabled={Boolean(estadoProc)}
                              >
                                {estadoProc === 'cancelando' ? 'Cancelando...' : 'Cancelar'}
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ))
          )}

          {enviando && (
            <div className="agente-msg-group assistant">
              <div className="agente-bubble assistant typing">
                Analisando suas finanças...
              </div>
            </div>
          )}

          <div ref={fimListaRef} />
        </div>

        {erro && <div className="agente-error">{erro}</div>}

        <form
          className="agente-composer"
          onSubmit={(e) => {
            e.preventDefault();
            enviar();
          }}
        >
          <textarea
            ref={inputRef}
            rows={2}
            maxLength={1500}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              statusAgente.configurado
                ? 'Pergunte algo ou diga "paguei 85 no mercado..."'
                : 'Configure GEMINI_API_KEY para começar'
            }
            disabled={!statusAgente.configurado || enviando}
          />
          <button
            type="submit"
            className="agente-send-btn"
            disabled={!statusAgente.configurado || enviando || !texto.trim()}
            aria-label="Enviar mensagem"
          >
            Enviar
          </button>
        </form>
      </aside>
    </div>
  );
}
