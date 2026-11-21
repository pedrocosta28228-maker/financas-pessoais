/**
 * Módulo de envio de e-mail transacional (Recuperação de senha).
 * Suporta duas APIs HTTPS gratuitas (funcionam no Render sem precisar de porta SMTP):
 * 1) Brevo (BREVO_API_KEY + EMAIL_REMETENTE) — 300 e-mails/dia grátis, aceita remetente Gmail/Outlook verificado
 * 2) Resend (RESEND_API_KEY + EMAIL_REMETENTE) — 3.000 e-mails/mês grátis
 *
 * No ambiente local (sem chave configurada), exibe o código no terminal para você testar na hora.
 */
export function emailConfigurado() {
  return Boolean(
    (process.env.BREVO_API_KEY && process.env.EMAIL_REMETENTE) ||
      process.env.RESEND_API_KEY
  );
}

function montarHtmlCodigo({ nome, codigo }) {
  const primeiroNome = (nome || 'olá').trim().split(/\s+/)[0];
  return `
    <div style="font-family: Inter, Segoe UI, Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; color: #0f172a;">
      <div style="background: #0052d4; color: #ffffff; width: 42px; height: 42px; border-radius: 12px; display: inline-block; text-align: center; line-height: 42px; font-weight: 800; font-size: 16px;">R$</div>
      <h2 style="margin: 16px 0 8px; font-size: 20px;">Recuperação de senha</h2>
      <p style="color: #475569; line-height: 1.5; margin: 0 0 18px;">
        Olá, <strong>${primeiroNome}</strong>! Use o código abaixo no <strong>Minhas Finanças</strong> para criar uma nova senha. Ele vale por <strong>15 minutos</strong>:
      </p>
      <div style="background: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 14px; padding: 18px; text-align: center; letter-spacing: 8px; font-size: 28px; font-weight: 800; color: #0052d4;">
        ${codigo}
      </div>
      <p style="color: #64748b; font-size: 13px; margin-top: 18px;">
        Se você não pediu para redefinir sua senha, basta ignorar este e-mail.
      </p>
    </div>
  `;
}

export async function enviarCodigoRecuperacao({ para, nome, codigo }) {
  const brevoKey = (process.env.BREVO_API_KEY || '').trim();
  const resendKey = (process.env.RESEND_API_KEY || '').trim();
  const remetente = (process.env.EMAIL_REMETENTE || '').trim();
  const html = montarHtmlCodigo({ nome, codigo });
  const assunto = `${codigo} é seu código para redefinir a senha — Minhas Finanças`;

  if (brevoKey && remetente) {
    const resp = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': brevoKey,
      },
      body: JSON.stringify({
        sender: { name: 'Minhas Finanças', email: remetente },
        to: [{ email: para, name: nome || para }],
        subject: assunto,
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
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${resendKey}`,
      },
      body: JSON.stringify({
        from: remetente || 'Minhas Finanças <onboarding@resend.dev>',
        to: [para],
        subject: assunto,
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
    console.log(`\n[DEV] Código de recuperação para ${para}: ${codigo} (expira em 15 min)\n`);
    return { modo: 'dev' };
  }

  throw new Error(
    'O envio de e-mail ainda não foi configurado no servidor (defina BREVO_API_KEY e EMAIL_REMETENTE).'
  );
}
