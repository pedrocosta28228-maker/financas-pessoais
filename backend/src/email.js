/**
 * Módulo de envio de e-mail transacional (Recuperação de senha + Lembretes financeiros).
 * Suporta duas APIs HTTPS gratuitas (funcionam no Render sem precisar de porta SMTP):
 * 1) Brevo (BREVO_API_KEY + EMAIL_REMETENTE) — 300 e-mails/dia grátis, aceita remetente Gmail/Outlook verificado
 * 2) Resend (RESEND_API_KEY + EMAIL_REMETENTE) — 3.000 e-mails/mês grátis
 *
 * No ambiente local (sem chave configurada), exibe um resumo no terminal para você testar na hora.
 */
export function emailConfigurado() {
  return Boolean(
    (process.env.BREVO_API_KEY && process.env.EMAIL_REMETENTE) ||
      process.env.RESEND_API_KEY
  );
}

export function escaparHtml(texto) {
  return String(texto ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatarMoedaBr(valor) {
  return Number(valor || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

function formatarDataCurtaBr(dataIso) {
  if (!dataIso || !/^\d{4}-\d{2}-\d{2}$/.test(dataIso)) return dataIso || '';
  const [, mes, dia] = dataIso.split('-');
  return `${dia}/${mes}`;
}

function formatarDataCompletaBr(dataIso) {
  if (!dataIso || !/^\d{4}-\d{2}-\d{2}$/.test(dataIso)) return dataIso || '';
  const [ano, mes, dia] = dataIso.split('-');
  return `${dia}/${mes}/${ano}`;
}

function obterPrimeiroNome(nome) {
  return escaparHtml((nome || 'olá').trim().split(/\s+/)[0]);
}

function montarBotaoApp(appUrl, texto = 'Abrir Minhas Finanças') {
  if (!appUrl || !/^https?:\/\//i.test(appUrl.trim())) return '';
  const urlSegura = escaparHtml(appUrl.trim().replace(/\/+$/, ''));
  return `
    <div style="margin: 24px 0 8px; text-align: center;">
      <a href="${urlSegura}" style="display: inline-block; background: #0052d4; color: #ffffff; text-decoration: none; font-weight: 700; font-size: 14px; padding: 12px 24px; border-radius: 999px;">
        ${escaparHtml(texto)}
      </a>
    </div>
  `;
}

function montarLayoutBase({ titulo, subtitulo, corpoHtml, rodapeHtml }) {
  return `
    <div style="background: #f8fafc; padding: 24px 12px; font-family: Inter, Segoe UI, Arial, sans-serif; color: #0f172a;">
      <div style="max-width: 560px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 18px; padding: 28px 24px;">
        <div style="margin-bottom: 18px;">
          <span style="display: inline-block; background: #0052d4; color: #ffffff; width: 40px; height: 40px; border-radius: 12px; text-align: center; line-height: 40px; font-weight: 800; font-size: 15px; vertical-align: middle;">R$</span>
          <span style="margin-left: 10px; font-weight: 800; font-size: 16px; color: #0f172a; vertical-align: middle;">Minhas Finanças</span>
        </div>
        <h2 style="margin: 0 0 8px; font-size: 21px; line-height: 1.3; color: #0f172a;">${titulo}</h2>
        ${subtitulo ? `<p style="margin: 0 0 20px; color: #475569; font-size: 14px; line-height: 1.55;">${subtitulo}</p>` : ''}
        ${corpoHtml}
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0 14px;" />
        <p style="margin: 0; color: #64748b; font-size: 12px; line-height: 1.5;">
          ${rodapeHtml}
        </p>
      </div>
    </div>
  `;
}

export async function enviarEmail({ para, nome, assunto, html, logDev }) {
  const brevoKey = (process.env.BREVO_API_KEY || '').trim();
  const resendKey = (process.env.RESEND_API_KEY || '').trim();
  const remetente = (process.env.EMAIL_REMETENTE || '').trim();
  const assuntoLimpo = String(assunto || '').replace(/[\r\n]+/g, ' ').trim();

  if (brevoKey && remetente) {
    const resp = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      signal: AbortSignal.timeout(15000),
      headers: {
        'Content-Type': 'application/json',
        'api-key': brevoKey,
      },
      body: JSON.stringify({
        sender: { name: 'Minhas Finanças', email: remetente },
        to: [{ email: para, name: nome || para }],
        subject: assuntoLimpo,
        htmlContent: html,
      }),
    });

    if (!resp.ok) {
      const detalhe = await resp.text().catch(() => '');
      throw new Error(`Falha ao enviar e-mail via Brevo (${resp.status}): ${detalhe}`);
    }
    return { modo: 'brevo' };
  }

  if (resendKey) {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      signal: AbortSignal.timeout(15000),
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${resendKey}`,
      },
      body: JSON.stringify({
        from: remetente || 'Minhas Finanças <onboarding@resend.dev>',
        to: [para],
        subject: assuntoLimpo,
        html,
      }),
    });

    if (!resp.ok) {
      const detalhe = await resp.text().catch(() => '');
      throw new Error(`Falha ao enviar e-mail via Resend (${resp.status}): ${detalhe}`);
    }
    return { modo: 'resend' };
  }

  // Sem provedor configurado
  if (process.env.NODE_ENV !== 'production') {
    console.log(`\n[DEV EMAIL] Para: ${para} | Assunto: ${assuntoLimpo}\n${logDev || ''}\n`);
    return { modo: 'dev' };
  }

  throw new Error(
    'O envio de e-mail ainda não foi configurado no servidor (defina BREVO_API_KEY e EMAIL_REMETENTE).'
  );
}

export function montarHtmlCodigo({ nome, codigo }) {
  const primeiroNome = obterPrimeiroNome(nome);
  const codigoSeguro = escaparHtml(codigo);
  return montarLayoutBase({
    titulo: 'Recuperação de senha',
    subtitulo: `Olá, <strong>${primeiroNome}</strong>! Use o código abaixo no <strong>Minhas Finanças</strong> para criar uma nova senha. Ele vale por <strong>15 minutos</strong>:`,
    corpoHtml: `
      <div style="background: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 14px; padding: 18px; text-align: center; letter-spacing: 8px; font-size: 28px; font-weight: 800; color: #0052d4;">
        ${codigoSeguro}
      </div>
    `,
    rodapeHtml: 'Se você não pediu para redefinir sua senha, basta ignorar este e-mail.',
  });
}

export async function enviarCodigoRecuperacao({ para, nome, codigo }) {
  return enviarEmail({
    para,
    nome,
    assunto: `${codigo} é seu código para redefinir a senha — Minhas Finanças`,
    html: montarHtmlCodigo({ nome, codigo }),
    logDev: `Código de recuperação: ${codigo} (expira em 15 min)`,
  });
}

function montarLinhasContasHtml(itens, mostrarData = false) {
  return itens
    .map((item) => {
      const tituloSeguro = escaparHtml(item.titulo);
      const detalhePartes = [];
      if (mostrarData && item.data) {
        detalhePartes.push(`Dia ${formatarDataCurtaBr(item.data)}`);
      }
      if (item.origem) {
        detalhePartes.push(`Para: ${escaparHtml(item.origem)}`);
      } else if (item.categoria) {
        detalhePartes.push(escaparHtml(item.categoria));
      }
      if (item.fonte === 'despesa_fixa') {
        detalhePartes.push('Despesa fixa');
      }

      const detalheTexto = detalhePartes.join(' • ');
      return `
        <tr>
          <td style="padding: 12px 0; border-bottom: 1px solid #e2e8f0; vertical-align: top;">
            <div style="font-weight: 700; font-size: 14px; color: #0f172a;">${tituloSeguro}</div>
            ${detalheTexto ? `<div style="font-size: 12px; color: #64748b; margin-top: 3px;">${detalheTexto}</div>` : ''}
          </td>
          <td style="padding: 12px 0 12px 12px; border-bottom: 1px solid #e2e8f0; text-align: right; white-space: nowrap; font-weight: 700; font-size: 14px; color: #dc2626; vertical-align: top;">
            ${formatarMoedaBr(item.valor)}
          </td>
        </tr>
      `;
    })
    .join('');
}

export function montarHtmlLembreteVencimento({
  nome,
  dataIso,
  ehAmanha = false,
  itens = [],
  total = 0,
  appUrl = '',
  ehTeste = false,
}) {
  const primeiroNome = obterPrimeiroNome(nome);
  const dataBr = formatarDataCompletaBr(dataIso);
  const qtd = itens.length;
  const palavraConta = qtd === 1 ? 'conta prevista' : 'contas previstas';
  const quandoTexto = ehAmanha ? `amanhã (${dataBr})` : `hoje (${dataBr})`;

  const bannerTeste = ehTeste
    ? `<div style="background: #eff6ff; border: 1px solid #bfdbfe; color: #1d4ed8; padding: 10px 14px; border-radius: 10px; font-size: 12px; margin-bottom: 16px;"><strong>E-mail de teste:</strong> este é um exemplo de como seu lembrete diário das 8h chega na sua caixa de entrada.</div>`
    : '';

  const corpoHtml = `
    ${bannerTeste}
    <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 14px; padding: 16px 18px; margin-bottom: 18px;">
      <div style="font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: #b91c1c;">
        Total para pagar ${ehAmanha ? 'amanhã' : 'hoje'}
      </div>
      <div style="font-size: 26px; font-weight: 800; color: #dc2626; margin-top: 4px;">
        ${formatarMoedaBr(total)}
      </div>
      <div style="font-size: 12px; color: #7f1d1d; margin-top: 4px;">
        ${qtd} ${palavraConta} para ${dataBr}
      </div>
    </div>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse: collapse;">
      ${montarLinhasContasHtml(itens, false)}
    </table>

    ${montarBotaoApp(appUrl, 'Marcar como paga no Minhas Finanças')}
  `;

  return montarLayoutBase({
    titulo: ehAmanha
      ? `Lembrete: você tem contas vencendo amanhã`
      : `Lembrete de pagamento para hoje`,
    subtitulo: `Bom dia, <strong>${primeiroNome}</strong>! Separamos ${qtd === 1 ? 'a conta que vence' : 'as contas que vencem'} <strong>${quandoTexto}</strong> para você não esquecer:`,
    corpoHtml,
    rodapeHtml:
      'Você recebe este aviso porque ativou os lembretes de vencimento. Para ajustar ou desativar, abra <strong>Minha conta</strong> no Minhas Finanças.',
  });
}

export async function enviarLembreteVencimento({
  para,
  nome,
  dataIso,
  ehAmanha = false,
  itens = [],
  total = 0,
  appUrl = '',
  ehTeste = false,
}) {
  const qtd = itens.length;
  const sufixoConta = qtd === 1 ? '1 conta' : `${qtd} contas`;
  const prefixo = ehTeste ? '[Teste] ' : '';
  const assunto = ehAmanha
    ? `${prefixo}Amanhã vence ${formatarMoedaBr(total)} (${sufixoConta}) — Minhas Finanças`
    : `${prefixo}Hoje vence ${formatarMoedaBr(total)} (${sufixoConta}) — Minhas Finanças`;

  const resumoDev = itens
    .map((i) => `  - ${i.titulo}: ${formatarMoedaBr(i.valor)}${i.origem ? ` (${i.origem})` : ''}`)
    .join('\n');

  return enviarEmail({
    para,
    nome,
    assunto,
    html: montarHtmlLembreteVencimento({
      nome,
      dataIso,
      ehAmanha,
      itens,
      total,
      appUrl,
      ehTeste,
    }),
    logDev: `Data: ${dataIso} | Total: ${formatarMoedaBr(total)}\n${resumoDev}`,
  });
}

export function montarHtmlResumoMensal({
  nome,
  nomeMes,
  diaSalario = null,
  salarioValor = null,
  itens = [],
  totalMes = 0,
  appUrl = '',
  ehTeste = false,
}) {
  const primeiroNome = obterPrimeiroNome(nome);
  const nomeMesSeguro = escaparHtml(nomeMes);
  const qtd = itens.length;
  const temSalario = typeof salarioValor === 'number' && salarioValor > 0;
  const sobraPrevista = temSalario ? salarioValor - totalMes : null;
  const corSobra = sobraPrevista !== null && sobraPrevista < 0 ? '#dc2626' : '#16a34a';

  const bannerTeste = ehTeste
    ? `<div style="background: #eff6ff; border: 1px solid #bfdbfe; color: #1d4ed8; padding: 10px 14px; border-radius: 10px; font-size: 12px; margin-bottom: 16px;"><strong>E-mail de teste:</strong> este é um exemplo do seu resumo mensal enviado perto do dia do salário.</div>`
    : '';

  const blocoResumoSalario = temSalario
    ? `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse: separate; border-spacing: 8px 0; margin: 0 -8px 18px;">
        <tr>
          <td width="33%" style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 12px; padding: 12px;">
            <div style="font-size: 11px; color: #166534; font-weight: 700;">SALÁRIO${diaSalario ? ` (DIA ${diaSalario})` : ''}</div>
            <div style="font-size: 16px; font-weight: 800; color: #15803d; margin-top: 4px;">${formatarMoedaBr(salarioValor)}</div>
          </td>
          <td width="33%" style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 12px; padding: 12px;">
            <div style="font-size: 11px; color: #991b1b; font-weight: 700;">CONTAS DO MÊS</div>
            <div style="font-size: 16px; font-weight: 800; color: #dc2626; margin-top: 4px;">${formatarMoedaBr(totalMes)}</div>
          </td>
          <td width="33%" style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 12px; padding: 12px;">
            <div style="font-size: 11px; color: #475569; font-weight: 700;">SOBRA PREVISTA</div>
            <div style="font-size: 16px; font-weight: 800; color: ${corSobra}; margin-top: 4px;">${formatarMoedaBr(sobraPrevista)}</div>
          </td>
        </tr>
      </table>
    `
    : `
      <div style="background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 14px; padding: 16px 18px; margin-bottom: 18px;">
        <div style="font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: #1d4ed8;">
          Total previsto para separar em ${nomeMesSeguro}
        </div>
        <div style="font-size: 26px; font-weight: 800; color: #0052d4; margin-top: 4px;">
          ${formatarMoedaBr(totalMes)}
        </div>
        <div style="font-size: 12px; color: #1e40af; margin-top: 4px;">
          ${qtd} ${qtd === 1 ? 'conta prevista' : 'contas previstas'} ao longo do mês
        </div>
      </div>
    `;

  const corpoHtml = `
    ${bannerTeste}
    ${blocoResumoSalario}
    <div style="font-size: 13px; font-weight: 700; color: #334155; margin-bottom: 6px;">
      Calendário de contas previstas (${qtd}):
    </div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse: collapse;">
      ${montarLinhasContasHtml(itens, true)}
    </table>
    ${montarBotaoApp(appUrl, 'Ver planejamento completo')}
  `;

  return montarLayoutBase({
    titulo: `Resumo das suas contas de ${nomeMesSeguro}`,
    subtitulo: `Olá, <strong>${primeiroNome}</strong>! Perto de receber é a melhor hora de separar o dinheiro das contas. Em <strong>${nomeMesSeguro}</strong> estão previstas <strong>${qtd} ${qtd === 1 ? 'conta' : 'contas'}</strong> somando <strong>${formatarMoedaBr(totalMes)}</strong>:`,
    corpoHtml,
    rodapeHtml:
      'Você recebe este resumo porque ativou o planejamento mensal por e-mail. Para ajustar quantos dias antes do salário ele chega ou desativar, abra <strong>Minha conta</strong> no Minhas Finanças.',
  });
}

export async function enviarResumoMensal({
  para,
  nome,
  nomeMes,
  diaSalario = null,
  salarioValor = null,
  itens = [],
  totalMes = 0,
  appUrl = '',
  ehTeste = false,
}) {
  const prefixo = ehTeste ? '[Teste] ' : '';
  const assunto = `${prefixo}Resumo de ${nomeMes}: ${formatarMoedaBr(totalMes)} em contas previstas — Minhas Finanças`;

  const resumoDev = itens
    .map(
      (i) =>
        `  - ${formatarDataCurtaBr(i.data)} | ${i.titulo}: ${formatarMoedaBr(i.valor)}${i.origem ? ` (${i.origem})` : ''}`
    )
    .join('\n');

  return enviarEmail({
    para,
    nome,
    assunto,
    html: montarHtmlResumoMensal({
      nome,
      nomeMes,
      diaSalario,
      salarioValor,
      itens,
      totalMes,
      appUrl,
      ehTeste,
    }),
    logDev: `Mês: ${nomeMes} | Total: ${formatarMoedaBr(totalMes)}\n${resumoDev}`,
  });
}
