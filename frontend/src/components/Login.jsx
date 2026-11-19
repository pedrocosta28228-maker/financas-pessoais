import { useState } from 'react';
import { api, salvarToken } from '../api.js';

/**
 * Componente da tela de Login e Cadastro.
 * Recebe "onAutenticado" (uma função do App.jsx) para avisar quando o login der certo.
 */
export default function Login({ onAutenticado }) {
  // useState guarda dados que mudam na tela (estado do componente)
  const [modo, setModo] = useState('login'); // 'login' ou 'cadastro'
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault(); // Evita recarregar a página inteira
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
              : 'Crie sua conta local para proteger seus dados'}
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
              placeholder="seu@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>

          <label className="field">
            <span>Senha</span>
            <input
              type="password"
              placeholder="Mínimo 6 caracteres"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              minLength={6}
              required
            />
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
          Seus dados ficam salvos localmente no seu computador em SQLite com senha criptografada.
        </p>
      </div>
    </div>
  );
}
