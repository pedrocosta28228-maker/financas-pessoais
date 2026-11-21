import { useEffect, useState } from 'react';
import { api, obterToken, removerToken } from './api.js';
import LandingPage from './components/LandingPage.jsx';
import Login from './components/Login.jsx';
import Dashboard from './components/Dashboard.jsx';

/**
 * Componente raiz da aplicação.
 * - Usuário logado: vai direto para o Dashboard.
 * - Visitante sem login: vê a Landing Page e escolhe Entrar ou Criar conta.
 */
export default function App() {
  const [usuario, setUsuario] = useState(null);
  const [verificandoSessao, setVerificandoSessao] = useState(true);
  const [telaPublica, setTelaPublica] = useState('landing'); // 'landing' | 'login' | 'cadastro'
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
    setTelaPublica('landing');
  }

  if (verificandoSessao) {
    return (
      <div className="auth-page">
        <p className="empty-state">Verificando sessão...</p>
      </div>
    );
  }

  if (!usuario) {
    if (telaPublica === 'landing') {
      return (
        <LandingPage
          tema={tema}
          onAlternarTema={alternarTema}
          onAbrirLogin={() => setTelaPublica('login')}
          onAbrirCadastro={() => setTelaPublica('cadastro')}
        />
      );
    }

    return (
      <Login
        modoInicial={telaPublica}
        onAutenticado={setUsuario}
        onVoltar={() => setTelaPublica('landing')}
        tema={tema}
        onAlternarTema={alternarTema}
      />
    );
  }

  return (
    <Dashboard
      usuario={usuario}
      onUsuarioAtualizado={setUsuario}
      onSair={handleSair}
      tema={tema}
      onAlternarTema={alternarTema}
    />
  );
}
