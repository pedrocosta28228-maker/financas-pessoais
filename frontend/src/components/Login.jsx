import { useEffect, useState } from 'react';
import { api, salvarToken } from '../api.js';

function EyeIcon({ aberto }) {
  if (aberto) {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
        <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
        <path d="m14.12 14.12a3 3 0 1 1-4.24-4.24" />
        <line x1="1" y1="1" x2="23" y2="23" />
      </svg>
    );
  }

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

/**
 * Tela moderna de Login, Cadastro e Recuperação de Senha ("Esqueci minha senha").
 */
export default function Login({
  onAutenticado,
  modoInicial = 'login',
  onVoltar,
  tema = 'light',
  onAlternarTema,
}) {
  const [modo, setModo] = useState(modoInicial); // 'login' | 'cadastro' | 'recuperar'
  const [etapaReset, setEtapaReset] = useState('email'); // 'email' | 'codigo'
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [codigoReset, setCodigoReset] = useState('');
  const [novaSenha, setNovaSenha] = useState('');
  const [confirmarNovaSenha, setConfirmarNovaSenha] = useState('');
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [erro, setErro] = useState('');
  const [avisoSucesso, setAvisoSucesso] = useState('');
  const [codigoDev, setCodigoDev] = useState('');
  const [carregando, setCarregando] = useState(false);

  useEffect(() => {
    setModo(modoInicial);
    setEtapaReset('email');
    setErro('');
    setAvisoSucesso('');
    setCodigoDev('');
  }, [modoInicial]);

  function trocarModo(novoModo) {
    setModo(novoModo);
    setEtapaReset('email');
    setErro('');
    setAvisoSucesso('');
    setCodigoDev('');
    setCodigoReset('');
    setNovaSenha('');
    setConfirmarNovaSenha('');
  }

  async function handleSubmitAuth(e) {
    e.preventDefault();
    setErro('');
    setAvisoSucesso('');
    setCarregando(true);

    try {
      const resposta =
        modo === 'cadastro'
          ? await api.registrar(nome, email, senha)
          : await api.login(email, senha);

      salvarToken(resposta.token);
      onAutenticado(resposta.usuario);
    } catch (err) {
      setErro(err.message);
    } finally {
      setCarregando(false);
    }
  }

  async function handleSolicitarCodigo(e) {
    e.preventDefault();
    setErro('');
    setAvisoSucesso('');
    setCodigoDev('');
    setCarregando(true);

    try {
      const resp = await api.solicitarRecuperacaoSenha(email);
      setAvisoSucesso(resp.mensagem);
      if (resp.codigoDev) {
        setCodigoDev(resp.codigoDev);
      }
      setEtapaReset('codigo');
    } catch (err) {
      setErro(err.message);
    } finally {
      setCarregando(false);
    }
  }

  async function handleRedefinirSenha(e) {
    e.preventDefault();
    setErro('');

    if (novaSenha !== confirmarNovaSenha) {
      setErro('A confirmação da nova senha não confere.');
      return;
    }

    setCarregando(true);
    try {
      const resp = await api.redefinirSenha(email, codigoReset, novaSenha);
      setModo('login');
      setEtapaReset('email');
      setSenha('');
      setCodigoReset('');
      setNovaSenha('');
      setConfirmarNovaSenha('');
      setCodigoDev('');
      setAvisoSucesso(resp.mensagem || 'Senha redefinida com sucesso! Entre com sua nova senha.');
    } catch (err) {
      setErro(err.message);
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-shell">
        {/* Painel esquerdo: identidade visual */}
        <aside className="auth-showcase">
          <div className="auth-showcase-brand">
            <div className="auth-showcase-logo">R$</div>
            <strong>Minhas Finanças</strong>
          </div>

          <div className="auth-showcase-copy">
            <h2>Seu dinheiro organizado em um só lugar.</h2>
            <p>
              Visualize exatamente quanto sobra no mês, acompanhe parcelas no calendário e planeje suas metas sem planilhas complicadas.
            </p>
          </div>

          <ul className="auth-showcase-list">
            <li>
              <span className="showcase-check">✓</span>
              <span>Saldo real, carteiras e calendário do mês</span>
            </li>
            <li>
              <span className="showcase-check">✓</span>
              <span>Dívidas parceladas e projeção de 12 meses</span>
            </li>
            <li>
              <span className="showcase-check">✓</span>
              <span>Acesse pelo computador ou celular</span>
            </li>
          </ul>
        </aside>

        {/* Painel direito: formulário */}
        <div className="auth-card">
          <div className="auth-card-topbar">
            {onVoltar ? (
              <button type="button" className="btn-link" onClick={onVoltar}>
                ← Voltar ao início
              </button>
            ) : (
              <span />
            )}

            {onAlternarTema && (
              <button
                type="button"
                className="btn-theme-icon small"
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
            )}
          </div>

          <div className="auth-header">
            <div className="logo-badge mobile-only">R$</div>
            <h1>
              {modo === 'recuperar'
                ? 'Recuperar senha'
                : modo === 'cadastro'
                  ? 'Criar sua conta'
                  : 'Bem-vindo de volta'}
            </h1>
            <p>
              {modo === 'recuperar'
                ? etapaReset === 'email'
                  ? 'Digite seu e-mail para receber um código de 6 dígitos'
                  : 'Digite o código recebido no e-mail e escolha uma nova senha'
                : modo === 'cadastro'
                  ? 'Comece grátis em menos de 1 minuto'
                  : 'Entre com seu e-mail e senha para continuar'}
            </p>
          </div>

          {modo !== 'recuperar' && (
            <div className="auth-tabs">
              <button
                type="button"
                className={modo === 'login' ? 'tab active' : 'tab'}
                onClick={() => trocarModo('login')}
              >
                Entrar
              </button>
              <button
                type="button"
                className={modo === 'cadastro' ? 'tab active' : 'tab'}
                onClick={() => trocarModo('cadastro')}
              >
                Criar conta
              </button>
            </div>
          )}

          {/* ==================== ENTRAR / CRIAR CONTA ==================== */}
          {modo !== 'recuperar' && (
            <form onSubmit={handleSubmitAuth} className="auth-form">
              {modo === 'cadastro' && (
                <label className="field">
                  <span>Seu nome</span>
                  <input
                    type="text"
                    autoComplete="name"
                    placeholder="Ex.: Pedro Morais"
                    value={nome}
                    onChange={(e) => setNome(e.target.value)}
                    required
                  />
                </label>
              )}

              <label className="field">
                <span>E-mail</span>
                <input
                  type="email"
                  autoComplete="email"
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder="seu@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </label>

              <div className="field">
                <div className="field-label-split">
                  <span>Senha</span>
                  {modo === 'login' && (
                    <button
                      type="button"
                      className="btn-link accent"
                      onClick={() => trocarModo('recuperar')}
                    >
                      Esqueci minha senha
                    </button>
                  )}
                </div>
                <div className="password-wrap">
                  <input
                    type={mostrarSenha ? 'text' : 'password'}
                    autoComplete={
                      modo === 'login' ? 'current-password' : 'new-password'
                    }
                    placeholder="Mínimo 6 caracteres"
                    value={senha}
                    onChange={(e) => setSenha(e.target.value)}
                    minLength={6}
                    required
                  />
                  <button
                    type="button"
                    className="btn-eye"
                    onClick={() => setMostrarSenha((v) => !v)}
                    aria-label={mostrarSenha ? 'Ocultar senha' : 'Mostrar senha'}
                    title={mostrarSenha ? 'Ocultar senha' : 'Mostrar senha'}
                  >
                    <EyeIcon aberto={mostrarSenha} />
                  </button>
                </div>
              </div>

              {erro && <div className="alert-error">{erro}</div>}
              {avisoSucesso && <div className="alert-success">{avisoSucesso}</div>}

              <button type="submit" className="btn-primary" disabled={carregando}>
                {carregando
                  ? 'Aguarde...'
                  : modo === 'login'
                    ? 'Entrar'
                    : 'Criar minha conta'}
              </button>
            </form>
          )}

          {/* ==================== RECUPERAR SENHA — PASSO 1 (E-MAIL) ==================== */}
          {modo === 'recuperar' && etapaReset === 'email' && (
            <form onSubmit={handleSolicitarCodigo} className="auth-form">
              <label className="field">
                <span>Seu e-mail cadastrado</span>
                <input
                  type="email"
                  autoComplete="email"
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder="seu@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoFocus
                  required
                />
              </label>

              {erro && <div className="alert-error">{erro}</div>}

              <button type="submit" className="btn-primary" disabled={carregando}>
                {carregando ? 'Enviando...' : 'Enviar código'}
              </button>

              <button
                type="button"
                className="btn-outline"
                onClick={() => trocarModo('login')}
              >
                Voltar para o login
              </button>
            </form>
          )}

          {/* ==================== RECUPERAR SENHA — PASSO 2 (CÓDIGO + NOVA SENHA) ==================== */}
          {modo === 'recuperar' && etapaReset === 'codigo' && (
            <form onSubmit={handleRedefinirSenha} className="auth-form">
              {avisoSucesso && <div className="alert-success">{avisoSucesso}</div>}

              {codigoDev && (
                <div className="unassigned-note">
                  Modo local (sem e-mail configurado): use o código{' '}
                  <strong>{codigoDev}</strong>
                </div>
              )}

              <label className="field">
                <span>Código de 6 dígitos</span>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  className="code-input"
                  placeholder="000000"
                  value={codigoReset}
                  onChange={(e) =>
                    setCodigoReset(e.target.value.replace(/\D/g, '').slice(0, 6))
                  }
                  autoFocus
                  required
                />
              </label>

              <div className="field">
                <span>Nova senha</span>
                <div className="password-wrap">
                  <input
                    type={mostrarSenha ? 'text' : 'password'}
                    autoComplete="new-password"
                    placeholder="Mínimo 6 caracteres"
                    value={novaSenha}
                    onChange={(e) => setNovaSenha(e.target.value)}
                    minLength={6}
                    required
                  />
                  <button
                    type="button"
                    className="btn-eye"
                    onClick={() => setMostrarSenha((v) => !v)}
                    aria-label={mostrarSenha ? 'Ocultar senha' : 'Mostrar senha'}
                  >
                    <EyeIcon aberto={mostrarSenha} />
                  </button>
                </div>
              </div>

              <label className="field">
                <span>Confirmar nova senha</span>
                <input
                  type={mostrarSenha ? 'text' : 'password'}
                  autoComplete="new-password"
                  placeholder="Repita a nova senha"
                  value={confirmarNovaSenha}
                  onChange={(e) => setConfirmarNovaSenha(e.target.value)}
                  minLength={6}
                  required
                />
              </label>

              {erro && <div className="alert-error">{erro}</div>}

              <button type="submit" className="btn-primary" disabled={carregando}>
                {carregando ? 'Salvando...' : 'Redefinir senha'}
              </button>

              <div className="reset-footer-links">
                <button
                  type="button"
                  className="btn-link"
                  onClick={() => setEtapaReset('email')}
                >
                  Reenviar código
                </button>
                <button
                  type="button"
                  className="btn-link"
                  onClick={() => trocarModo('login')}
                >
                  Voltar ao login
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
