const TOKEN_KEY = 'financeiro_token';

export function salvarToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function obterToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function removerToken() {
  localStorage.removeItem(TOKEN_KEY);
}

/**
 * Função auxiliar para conversar com a nossa API Node.js.
 * Sempre envia o token JWT no cabeçalho Authorization se o usuário estiver logado.
 */
async function requisicao(caminho, opcoes = {}) {
  const token = obterToken();

  const headers = {
    'Content-Type': 'application/json',
    ...(opcoes.headers || {}),
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const resposta = await fetch(`/api${caminho}`, {
    ...opcoes,
    headers,
  });

  const dados = await resposta.json().catch(() => ({}));

  if (!resposta.ok) {
    throw new Error(dados.erro || 'Erro ao comunicar com o servidor.');
  }

  return dados;
}

export const api = {
  registrar: (nome, email, senha) =>
    requisicao('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ nome, email, senha }),
    }),

  login: (email, senha) =>
    requisicao('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, senha }),
    }),

  me: () => requisicao('/auth/me'),

  listarLancamentos: (mes) =>
    requisicao(`/lancamentos?mes=${encodeURIComponent(mes)}`),

  criarLancamento: (dados) =>
    requisicao('/lancamentos', {
      method: 'POST',
      body: JSON.stringify(dados),
    }),

  atualizarStatus: (id, status) =>
    requisicao(`/lancamentos/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),

  excluirLancamento: (id) =>
    requisicao(`/lancamentos/${id}`, {
      method: 'DELETE',
    }),
};
