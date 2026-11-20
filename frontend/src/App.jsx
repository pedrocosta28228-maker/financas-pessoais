import { useEffect, useState } from 'react';
import { api, obterToken, removerToken } from './api.js';
import Login from './components/Login.jsx';
import Dashboard from './components/Dashboard.jsx';

/**
 * Componente raiz da aplicação.
 * Decide se mostra a tela de Login ou o Painel Financeiro.
 */
export default function App() {
  const [usuario, setUsuario] = useState(null);
  const [verificandoSessao, setVerificandoSessao] = useState(true);
  const [tema, setTema] = useState(() => {
    const salvo = localStorage.getItem('financeiro_tema');
    return salvo === 'dark' ? 'dark' : 'light';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', tema);
    localStorage.setItem('financeiro_tema', tema);
  }, [tema]);

  function alternarTema() {
    setTema((atual) => (atual === 'light' ? 'dark' : 'light'));
  }

  // Ao abrir o site, confere se já existe um token válido salvo no navegador
  useEffect(() => {
    async function checarLogin() {
      if (!obterToken()) {
        setVerificandoSessao(false);
        return;
      }

      try {
        const dados = await api.me();
        setUsuario(dados.usuario);
      } catch {
        removerToken();
      } finally {
        setVerificandoSessao(false);
      }
    }

    checarLogin();
  }, []);

  function handleSair() {
    removerToken();
    setUsuario(null);
  }

  if (verificandoSessao) {
    return (
      <div className="auth-page">
        <p className="empty-state">Verificando sessão...</p>
      </div>
    );
  }

  if (!usuario) {
    return <Login onAutenticado={setUsuario} />;
  }

  return (
    <Dashboard
      usuario={usuario}
      onSair={handleSair}
      tema={tema}
      onAlternarTema={alternarTema}
    />
  );
}
