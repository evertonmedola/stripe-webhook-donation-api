interface DonationConfirmationParams {
  amountCents: number;
  orderId: string;
  createdAt: Date;
}

function formatReais(amountCents: number): string {
  return (amountCents / 100).toFixed(2).replace('.', ',');
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  }).format(date);
}

export function buildDonationConfirmationEmail(params: DonationConfirmationParams): {
  subject: string;
  text: string;
  html: string;
} {
  const amount = formatReais(params.amountCents);
  const reference = params.orderId.slice(0, 8).toUpperCase();
  const date = formatDate(params.createdAt);

  const subject = `Doação confirmada - R$ ${amount}`;

  const text = [
    'Sua doação foi confirmada.',
    '',
    `Valor: R$ ${amount}`,
    `Referência: #${reference}`,
    `Data: ${date}`,
    '',
    'Obrigado por apoiar a causa.',
    '',
    '-- ',
    'Catraca Financeira',
    'Desenvolvido por Everton Medola - https://github.com/evertonmedola',
  ].join('\n');

  const html = `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${subject}</title>
  </head>
  <body style="margin:0; padding:0; background-color:#eef0f0; font-family:Arial, Helvetica, sans-serif;">
    <span style="display:none; font-size:0; line-height:0; max-height:0; max-width:0; opacity:0; overflow:hidden;">
      Sua doação de R$ ${amount} foi confirmada.
    </span>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#eef0f0; padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px; width:100%; background-color:#202226; border:1px solid #46494f; border-radius:8px; overflow:hidden;">
            <tr>
              <td style="padding:28px 32px 4px; border-bottom:1px solid #3d4147;">
                <p style="margin:0 0 24px; font-size:13px; letter-spacing:0.08em; text-transform:uppercase; color:#b8874f; font-weight:bold;">
                  Catraca Financeira
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 8px;">
                <p style="margin:0; font-size:16px; color:#eef0f0;">Sua doação foi confirmada.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:12px 32px 24px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#121315; border-radius:6px;">
                  <tr>
                    <td style="padding:20px 24px;">
                      <p style="margin:0 0 4px; font-size:12px; letter-spacing:0.05em; text-transform:uppercase; color:#b3b8bd;">Valor doado</p>
                      <p style="margin:0; font-size:32px; font-weight:bold; color:#f0b45a; font-variant-numeric:tabular-nums;">R$ ${amount}</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 28px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="padding:4px 0; font-size:13px; color:#b3b8bd;">Referência</td>
                    <td style="padding:4px 0; font-size:13px; color:#eef0f0; text-align:right; font-family:'Courier New', monospace;">#${reference}</td>
                  </tr>
                  <tr>
                    <td style="padding:4px 0; font-size:13px; color:#b3b8bd;">Data</td>
                    <td style="padding:4px 0; font-size:13px; color:#eef0f0; text-align:right;">${date}</td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px; background-color:#34383d; border-top:1px solid #46494f;">
                <p style="margin:0 0 8px; font-size:13px; color:#b3b8bd;">Obrigado por apoiar a causa.</p>
                <a href="https://github.com/evertonmedola" style="font-size:12px; color:#b8874f; text-decoration:none;">
                  Desenvolvido por Everton Medola
                </a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, text, html };
}
