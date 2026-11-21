import { useState } from 'react';
import { api, salvarToken } from '../api.js';

/**
 * Componente da tela de Login e Cadastro.
 * Recebe "onAutenticado" (uma função do App.jsx) para avisar quando o login der certo.
 */
export default function Login({ onAutenticado }) {
  const [modo, setModo] = useState('login'); // 'login' ou 'cadastro'
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setErro('');
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

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-header">
          <div className="logo-badge">R$</div>
          <h1>Minhas Finanças</h1>
          <p>
            {modo === 'login'
              ? 'Entre na sua conta para ver seus saldos e dívidas'
              : 'Crie sua conta para organizar seu dinheiro'}
          </p>
        </div>

        <div className="auth-tabs">
          <button
            type="button"
            className={modo === 'login' ? 'tab active' : 'tab'}
            onClick={() => {
              setModo('login');
              setErro('');
            }}
          >
            Entrar
          </button>
          <button
            type="button"
            className={modo === 'cadastro' ? 'tab active' : 'tab'}
            onClick={() => {
              setModo('cadastro');
              setErro('');
            }}
          >
            Criar conta
          </button>
        </div>

        <form onSubmit={handleSubmit} className="auth-form">
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

          <label className="field">
            <span>Senha</span>
            <div className="password-wrap">
              <input
                type={mostrarSenha ? 'text' : 'password'}
                autoComplete={modo === 'login' ? 'current-password' : 'new-password'}
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
                {mostrarSenha ? (
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
                ) : (
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
                )}
              </button>
            </div>
          </label>

          {erro && <div className="alert-error">{erro}</div>}

          <button type="submit" className="btn-primary" disabled={carregando}>
            {carregando
              ? 'Aguarde...'
              : modo === 'login'
                ? 'Entrar no sistema'
                : 'Criar minha conta'}
          </button>
        </form>

        <p className="auth-footer">
          Sua senha é protegida com criptografia e cada conta acessa apenas os próprios dados.
        </p>
      </div>
    </div>
  );
}
