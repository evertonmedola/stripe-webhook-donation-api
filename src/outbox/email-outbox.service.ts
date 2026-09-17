import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { MAIL_TRANSPORT } from './mail.provider';
import type { Transporter } from 'nodemailer';

interface PendingRow {
  id: string;
  order_id: string;
  attempts: number;
}

@Injectable()
export class EmailOutboxService {
  private readonly logger = new Logger(EmailOutboxService.name);
  private readonly maxAttempts: number;

  constructor(
    private readonly dataSource: DataSource,
    @Inject(MAIL_TRANSPORT) private readonly mailTransport: Transporter,
    private readonly config: ConfigService,
  ) {
    this.maxAttempts = Number(this.config.get<string>('OUTBOX_MAX_ATTEMPTS'));
  }

  async processPendingBatch(): Promise<{ sent: number; failed: number }> {
    const rows: PendingRow[] = await this.dataSource.query(
      `SELECT id, order_id, attempts FROM email_outbox
       WHERE status = 'pending' AND attempts < $1
       ORDER BY created_at ASC
       FOR UPDATE SKIP LOCKED
       LIMIT 20`,
      [this.maxAttempts],
    );

    let sent = 0;
    let failed = 0;

    for (const row of rows) {
      try {
        const [orderRow] = await this.dataSource.query(
          `SELECT donor_email FROM orders WHERE id = $1`,
          [row.order_id],
        );
        await this.mailTransport.sendMail({
          to: orderRow?.donor_email,
          from: this.config.get<string>('SMTP_FROM'),
          subject: 'Confirmação de doação',
          text: 'Obrigado pela sua doação! Seu pagamento foi confirmado.',
        });
        await this.dataSource.query(
          `UPDATE email_outbox SET status = 'sent', sent_at = now() WHERE id = $1`,
          [row.id],
        );
        sent += 1;
      } catch (err) {
        const nextAttempts = row.attempts + 1;
        const nextStatus = nextAttempts >= this.maxAttempts ? 'failed' : 'pending';
        await this.dataSource.query(
          `UPDATE email_outbox SET attempts = $2, status = $3, last_error = $4 WHERE id = $1`,
          [row.id, nextAttempts, nextStatus, (err as Error).message],
        );
        this.logger.warn(`email_outbox send failed for row ${row.id}: ${(err as Error).message}`);
        failed += 1;
      }
    }

    return { sent, failed };
  }
}
