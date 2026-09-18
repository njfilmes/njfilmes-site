// Envio de e-mail transacional (usado hoje só pela recuperação de senha por e-mail, pedido do
// usuário em 18/09/2026). Usa a API HTTP da Resend (https://resend.com) direto com fetch nativo
// do Node - sem instalar nenhuma biblioteca nova, seguindo o estilo "sem framework" do resto do
// projeto. Precisa de duas variáveis de ambiente no Render:
//   RESEND_API_KEY   — chave de API da conta Resend (grátis até 3000 e-mails/mês)
//   RESEND_FROM_EMAIL — remetente, ex.: "NJFILMES <onboarding@resend.dev>" (o endereço de teste
//                       da Resend só entrega pro e-mail cadastrado na conta; pra mandar pra
//                       qualquer e-mail é preciso verificar um domínio próprio na Resend)
// Se essas variáveis não estiverem configuradas, sendEmail retorna { ok: false } em vez de
// quebrar a página - quem chamar decide o que mostrar pro usuário nesse caso.
export async function sendEmail({ to, subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from) {
    console.error('[mailer] RESEND_API_KEY ou RESEND_FROM_EMAIL não configurados - e-mail não enviado.');
    return { ok: false, reason: 'not_configured' };
  }
  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to, subject, html }),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      console.error(`[mailer] Falha ao enviar e-mail (${resp.status}): ${body}`);
      return { ok: false, reason: 'send_failed' };
    }
    return { ok: true };
  } catch (err) {
    console.error('[mailer] Erro ao enviar e-mail:', err);
    return { ok: false, reason: 'exception' };
  }
}
