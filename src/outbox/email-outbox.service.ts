import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { MAIL_TRANSPORT } from './mail.provider';
import { buildDonationConfirmationEmail } from './email-templates';
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
    let sent = 0;
    let failed = 0;

    await this.dataSource.transaction(async (manager) => {
      const rows: PendingRow[] = await manager.query(
        `SELECT id, order_id, attempts FROM email_outbox
         WHERE status = 'pending' AND attempts < $1
         ORDER BY created_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 20`,
        [this.maxAttempts],
      );

      for (const row of rows) {
        try {
          const [orderRow] = await manager.query(
            `SELECT donor_email, amount_cents, created_at FROM orders WHERE id = $1`,
            [row.order_id],
          );
          const { subject, text, html } = buildDonationConfirmationEmail({
            amountCents: orderRow?.amount_cents ?? 0,
            orderId: row.order_id,
            createdAt: orderRow?.created_at ?? new Date(),
          });
          await this.mailTransport.sendMail({
            to: orderRow?.donor_email,
            from: this.config.get<string>('SMTP_FROM'),
            subject,
            text,
            html,
          });
          await manager.query(
            `UPDATE email_outbox SET status = 'sent', sent_at = now() WHERE id = $1`,
            [row.id],
          );
          sent += 1;
        } catch (err) {
          const nextAttempts = row.attempts + 1;
          const nextStatus = nextAttempts >= this.maxAttempts ? 'failed' : 'pending';
          await manager.query(
            `UPDATE email_outbox SET attempts = $2, status = $3, last_error = $4 WHERE id = $1`,
            [row.id, nextAttempts, nextStatus, (err as Error).message],
          );
          this.logger.warn(`email_outbox send failed for row ${row.id}: ${(err as Error).message}`);
          failed += 1;
        }
      }
    });

    return { sent, failed };
  }
}
