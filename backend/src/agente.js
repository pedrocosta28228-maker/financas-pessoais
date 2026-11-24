import { db as dbPadrao } from './db.js';
import { obterDataBrasilia } from './notificacoes.js';
import {
  DECLARACOES_FERRAMENTAS,
  FERRAMENTAS_PROPOSTA,
  executarFerramentaLeitura,
  criarPropostaAcao,
  serializarAcao,
} from './agente-tools.js';

const MODELO_PADRAO = 'gemini-3.5-flash';
const MAX_ITERACOES_LOOP = 5;
const MAX_PROPOSTAS_POR_TURNO = 5;
const MAX_MENSAGENS_CONTEXTO = 14;
const TIMEOUT_GEMINI_MS = 35000;

function criarErroHttp(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

export function obterStatusAgente(env = process.env) {
  const apiKey = (env?.GEMINI_API_KEY || '').trim();
  const modelo = (env?.GEMINI_MODEL || '').trim() || MODELO_PADRAO;
  return {
    configurado: Boolean(apiKey),
    modelo,
  };
}

function montarSystemPrompt(hojeIso) {
  const mesAtual = hojeIso.slice(0, 7);
  return [
    'Você é o Assistente Financeiro do aplicativo "Minhas Finanças".',
    `Data de hoje (horário de Brasília): ${hojeIso} (mês atual: ${mesAtual}).`,
    'Responda sempre em português do Brasil (pt-BR), de forma clara, direta, amigável e prática, usando valores formatados em Real (R$).',
    'REGRAS OBRIGATÓRIAS:',
    '1. NUNCA invente ou estime valores das finanças do usuário. Sempre consulte as ferramentas de leitura antes de informar saldos, gastos, dívidas, metas ou projeções.',
    '2. Para registrar qualquer coisa (lançamento, dívida parcelada, marcar como pago, meta ou despesa fixa), use as ferramentas "propor_*". Elas geram um cartão para o usuário confirmar em 1 clique — diga claramente que preparou a proposta para confirmação.',
    '3. Se o usuário mencionar o nome de uma carteira/banco (ex.: Nubank, Inter, Carteira), chame "listar_carteiras" antes de propor o lançamento para obter o conta_id correto.',
    '4. Em compras parceladas (tipo = "divida" e parcelas > 1), sempre preencha "modo_valor_parcela" com "total" (quando o usuário informou o valor total, ex.: 1200 em 6x) ou "parcela" (quando informou o valor de cada parcela, ex.: 6x de 200).',
    '5. Para marcar uma conta como paga, chame "listar_lancamentos" com status = "pendente" antes para descobrir o lancamento_id exato.',
    '6. SEGURANÇA: você NUNCA exclui lançamentos e NUNCA faz ou altera transferências entre carteiras. Se o usuário pedir isso, explique educadamente que por segurança essas ações devem ser feitas manualmente nas abas do aplicativo.',
    '7. Você pode propor no máximo 5 ações por resposta.',
  ].join('\n');
}

async function chamarGeminiPadrao({ apiKey, modelo, systemInstruction, contents, tools }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelo)}:generateContent`;

  let resposta;
  try {
    resposta = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: systemInstruction }],
        },
        contents,
        tools: [{ functionDeclarations: tools }],
        generationConfig: {
          temperature: 0.3,
        },
      }),
      signal: AbortSignal.timeout(TIMEOUT_GEMINI_MS),
    });
  } catch (err) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      throw criarErroHttp(502, 'A IA demorou demais para responder. Tente novamente em instantes.');
    }
    throw criarErroHttp(502, 'Não consegui conectar ao serviço de IA agora. Tente novamente em instantes.');
  }

  if (resposta.status === 429) {
    throw criarErroHttp(
      429,
      'Limite gratuito da IA atingido no momento. Aguarde um minuto e tente novamente.'
    );
  }

  if (resposta.status === 401 || resposta.status === 403) {
    throw criarErroHttp(
      502,
      'A chave GEMINI_API_KEY configurada no servidor foi recusada pelo Google Gemini.'
    );
  }

  const dados = await resposta.json().catch(() => null);
  if (!resposta.ok || !dados) {
    const detalhe = dados?.error?.message || `HTTP ${resposta.status}`;
    throw criarErroHttp(502, `Erro ao consultar a IA (${detalhe}).`);
  }

  return dados;
}

function extrairTextoDasPartes(parts = []) {
  return parts
    .filter((p) => !p?.thought && typeof p?.text === 'string' && p.text.trim())
    .map((p) => p.text.trim())
    .join('\n\n');
}

/**
 * Carrega as últimas mensagens do chat do usuário com suas ações vinculadas (1:N).
 */
export async function carregarHistoricoAgente(
  usuarioId,
  { db = dbPadrao, limite = 50 } = {}
) {
  const limiteSeguro = Math.max(1, Math.min(100, Math.floor(Number(limite) || 50)));
  const rows = await db.all(
    `SELECT id, papel, conteudo, criado_em
     FROM agente_mensagens
     WHERE usuario_id = ?
     ORDER BY id DESC
     LIMIT ?`,
    usuarioId,
    limiteSeguro
  );

  const ordenadas = rows.reverse();
  if (ordenadas.length === 0) return [];

  const ids = ordenadas.map((m) => Number(m.id));
  const placeholders = ids.map(() => '?').join(', ');
  const acoesRows = await db.all(
    `SELECT * FROM agente_acoes_pendentes
     WHERE usuario_id = ? AND mensagem_id IN (${placeholders})
     ORDER BY id ASC`,
    usuarioId,
    ...ids
  );

  const acoesPorMsg = new Map();
  for (const row of acoesRows) {
    const mid = Number(row.mensagem_id);
    if (!acoesPorMsg.has(mid)) acoesPorMsg.set(mid, []);
    acoesPorMsg.get(mid).push(serializarAcao(row));
  }

  return ordenadas.map((m) => ({
    id: Number(m.id),
    papel: m.papel,
    conteudo: m.conteudo,
    criadoEm: m.criado_em || null,
    acoes: acoesPorMsg.get(Number(m.id)) || [],
  }));
}

/**
 * Limpa o histórico de conversa do usuário e cancela eventuais propostas ainda pendentes.
 */
export async function limparHistoricoAgente(usuarioId, { db = dbPadrao } = {}) {
  await db.run(
    "UPDATE agente_acoes_pendentes SET status = 'cancelada', resolvido_em = ? WHERE usuario_id = ? AND status = 'pendente'",
    new Date().toISOString(),
    usuarioId
  );
  await db.run('DELETE FROM agente_mensagens WHERE usuario_id = ?', usuarioId);
  return { ok: true };
}

/**
 * Processa uma mensagem do usuário rodando o loop de function calling com o Google Gemini.
 */
export async function processarMensagemAgente({
  usuarioId,
  mensagem,
  db = dbPadrao,
  chamarGemini = chamarGeminiPadrao,
  env = process.env,
  hojeIso = obterDataBrasilia().dataIso,
}) {
  const textoLimpo = String(mensagem || '').trim();
  if (!textoLimpo) {
    throw criarErroHttp(400, 'Digite uma mensagem para o assistente.');
  }
  if (textoLimpo.length > 1500) {
    throw criarErroHttp(400, 'A mensagem pode ter no máximo 1500 caracteres.');
  }

  const status = obterStatusAgente(env);
  if (!status.configurado) {
    throw criarErroHttp(
      503,
      'Assistente de IA desativado: configure a variável GEMINI_API_KEY no servidor para ativar.'
    );
  }

  const apiKey = (env?.GEMINI_API_KEY || '').trim();
  const historicoRecente = await carregarHistoricoAgente(usuarioId, {
    db,
    limite: MAX_MENSAGENS_CONTEXTO,
  });

  const contents = historicoRecente.map((m) => ({
    role: m.papel === 'usuario' ? 'user' : 'model',
    parts: [{ text: m.conteudo }],
  }));
  contents.push({
    role: 'user',
    parts: [{ text: textoLimpo }],
  });

  const systemInstruction = montarSystemPrompt(hojeIso);
  const acoesCriadasNoTurno = [];
  let textoFinal = '';

  try {
    for (let iteracao = 0; iteracao < MAX_ITERACOES_LOOP; iteracao++) {
      const resposta = await chamarGemini({
        apiKey,
        modelo: status.modelo,
        systemInstruction,
        contents,
        tools: DECLARACOES_FERRAMENTAS,
      });

      const candidato = resposta?.candidates?.[0];
      const parts = candidato?.content?.parts || [];
      const functionCalls = parts.filter((p) => p?.functionCall);

      if (functionCalls.length === 0) {
        textoFinal = extrairTextoDasPartes(parts);
        break;
      }

      // Anexa a resposta do modelo contendo os functionCalls ao contexto do turno
      contents.push({
        role: 'model',
        parts,
      });

      const functionResponses = [];
      for (const part of functionCalls) {
        const { name, args } = part.functionCall;
        let resultadoFerramenta;

        try {
          if (FERRAMENTAS_PROPOSTA.has(name)) {
            if (acoesCriadasNoTurno.length >= MAX_PROPOSTAS_POR_TURNO) {
              resultadoFerramenta = {
                erro: `Limite de ${MAX_PROPOSTAS_POR_TURNO} ações propostas por mensagem atingido. Peça ao usuário para confirmar estas primeiro.`,
              };
            } else {
              const { acao, resumoParaModelo } = await criarPropostaAcao(
                name,
                args || {},
                usuarioId,
                { db, hojeIso }
              );
              acoesCriadasNoTurno.push(acao);
              resultadoFerramenta = resumoParaModelo;
            }
          } else {
            resultadoFerramenta = await executarFerramentaLeitura(
              name,
              args || {},
              usuarioId,
              { db, hojeIso }
            );
          }
        } catch (errFerramenta) {
          resultadoFerramenta = {
            erro: errFerramenta?.message || 'Não foi possível executar esta consulta/proposta.',
          };
        }

        functionResponses.push({
          functionResponse: {
            name,
            response: resultadoFerramenta,
          },
        });
      }

      contents.push({
        role: 'user',
        parts: functionResponses,
      });
    }
  } catch (err) {
    // Limpa propostas criadas neste turno se a chamada ao Gemini falhou no meio
    for (const a of acoesCriadasNoTurno) {
      await db.run('DELETE FROM agente_acoes_pendentes WHERE id = ? AND usuario_id = ?', a.id, usuarioId);
    }
    throw err;
  }

  if (!textoFinal) {
    textoFinal =
      acoesCriadasNoTurno.length > 0
        ? 'Preparei os itens abaixo para você revisar e confirmar em 1 clique.'
        : 'Consultei seus dados, mas precisei encerrar o processamento para não exceder o limite de etapas. Pode reformular ou pedir algo mais específico?';
  }

  const msgUserId = await db.insert(
    "INSERT INTO agente_mensagens (usuario_id, papel, conteudo) VALUES (?, 'usuario', ?)",
    usuarioId,
    textoLimpo
  );
  const msgAssistId = await db.insert(
    "INSERT INTO agente_mensagens (usuario_id, papel, conteudo) VALUES (?, 'assistente', ?)",
    usuarioId,
    textoFinal
  );

  for (const acao of acoesCriadasNoTurno) {
    await db.run(
      'UPDATE agente_acoes_pendentes SET mensagem_id = ? WHERE id = ? AND usuario_id = ?',
      msgAssistId,
      acao.id,
      usuarioId
    );
    acao.mensagemId = msgAssistId;
  }

  const msgUserRow = await db.get('SELECT id, papel, conteudo, criado_em FROM agente_mensagens WHERE id = ?', msgUserId);
  const msgAssistRow = await db.get('SELECT id, papel, conteudo, criado_em FROM agente_mensagens WHERE id = ?', msgAssistId);

  return {
    mensagemUsuario: {
      id: Number(msgUserRow.id),
      papel: msgUserRow.papel,
      conteudo: msgUserRow.conteudo,
      criadoEm: msgUserRow.criado_em || null,
      acoes: [],
    },
    mensagemAssistente: {
      id: Number(msgAssistRow.id),
      papel: msgAssistRow.papel,
      conteudo: msgAssistRow.conteudo,
      criadoEm: msgAssistRow.criado_em || null,
      acoes: acoesCriadasNoTurno,
    },
    acoesPendentes: acoesCriadasNoTurno,
  };
}
