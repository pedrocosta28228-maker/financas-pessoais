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

  let resposta;
  try {
    resposta = await fetch(`/api${caminho}`, {
      ...opcoes,
      headers,
    });
  } catch {
    throw new Error(
      'Não foi possível conectar ao servidor. Verifique se a janela do iniciar-app.bat continua aberta.'
    );
  }

  const dados = await resposta.json().catch(() => ({}));

  if (!resposta.ok) {
    throw new Error(
      dados.erro || `Erro ${resposta.status} ao comunicar com o servidor. Reinicie o iniciar-app.bat se o servidor estiver desatualizado.`
    );
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
    requisicao(mes ? `/lancamentos?mes=${encodeURIComponent(mes)}` : '/lancamentos'),

  criarLancamento: (dados) =>
    requisicao('/lancamentos', {
      method: 'POST',
      body: JSON.stringify(dados),
    }),

  atualizarLancamento: (id, dados) =>
    requisicao(`/lancamentos/${id}`, {
      method: 'PUT',
      body: JSON.stringify(dados),
    }),

  atualizarStatus: (id, status, opcoes = {}) =>
    requisicao(`/lancamentos/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status, ...opcoes }),
    }),

  excluirGrupoParcelas: (grupoId) =>
    requisicao(`/lancamentos/grupo/${encodeURIComponent(grupoId)}`, {
      method: 'DELETE',
    }),

  excluirLancamento: (id) =>
    requisicao(`/lancamentos/${id}`, {
      method: 'DELETE',
    }),

  listarContas: () => requisicao('/contas'),

  criarConta: (dados) =>
    requisicao('/contas', {
      method: 'POST',
      body: JSON.stringify(dados),
    }),

  atualizarConta: (id, dados) =>
    requisicao(`/contas/${id}`, {
      method: 'PUT',
      body: JSON.stringify(dados),
    }),

  excluirConta: (id) =>
    requisicao(`/contas/${id}`, {
      method: 'DELETE',
    }),

  transferirEntreContas: (origemId, destinoId, valor) =>
    requisicao('/contas/transferir', {
      method: 'POST',
      body: JSON.stringify({ origemId, destinoId, valor }),
    }),

  obterSalario: () => requisicao('/salario'),

  salvarSalario: (dados) =>
    requisicao('/salario', {
      method: 'PUT',
      body: JSON.stringify(dados),
    }),

  removerSalario: () =>
    requisicao('/salario', {
      method: 'DELETE',
    }),
};
