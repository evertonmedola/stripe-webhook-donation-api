import { Inject, Injectable, Logger } from '@nestjs/common';
import { DataSource, QueryRunner } from 'typeorm';
import Stripe from 'stripe';
import { STRIPE_CLIENT } from '../checkout/stripe.provider';
import { STRIPE_WEBHOOK_SECRET } from './webhook-secret.provider';
import { AuditLogService } from '../audit-log/audit-log.service';

export type EventHandler = (
  queryRunner: QueryRunner,
  event: Stripe.Event,
) => Promise<{ orderId: string | null }>;

@Injectable()
export class StripeWebhookService {
  private readonly logger = new Logger(StripeWebhookService.name);

  /** Populated by handler registration in Task 13; unregistered types fall through to the default no-op. */
  public readonly EVENT_HANDLERS: Record<string, EventHandler> = {};

  constructor(
    @Inject(STRIPE_CLIENT) private readonly stripe: Stripe,
    private readonly dataSource: DataSource,
    private readonly auditLog: AuditLogService,
    @Inject(STRIPE_WEBHOOK_SECRET) private readonly webhookSecret: string,
  ) {}

  async handleRawEvent(
    rawBody: Buffer,
    signatureHeader: string,
  ): Promise<{ outcome: 'processed' | 'rejected' | 'duplicate' }> {
    // Signature verification happens strictly before any DataSource/QueryRunner
    // is created — an invalid signature must never cause a DB connection to be
    // opened. `rawBody` is passed to Stripe's SDK completely unparsed (no
    // JSON.parse anywhere on this path); constructEvent() re-computes the HMAC
    // over the exact raw bytes, which is the whole point of using rawBody in
    // the first place — parsing/re-serializing first would break signature
    // verification for any payload whose JSON formatting isn't byte-identical
    // to what Stripe sent.
    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(rawBody, signatureHeader, this.webhookSecret);
    } catch (err) {
      await this.auditLog.record({
        action: 'signature_invalid',
        reason: (err as Error).message,
      });
      return { outcome: 'rejected' };
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const insertResult = await queryRunner.query(
        `INSERT INTO processed_stripe_events (event_id, event_type, outcome)
         VALUES ($1, $2, 'processed') ON CONFLICT (event_id) DO NOTHING
         RETURNING event_id`,
        [event.id, event.type],
      );
      const rowsAffected = extractInsertedRowCount(insertResult);

      if (rowsAffected === 0) {
        // Duplicate event_id: roll back immediately. Nothing else has been
        // written in this transaction yet, so the rollback here is really
        // just releasing the transaction cleanly, but we still route through
        // rollbackTransaction (rather than commit) so a duplicate never
        // leaves any trace of a "processed" write behind.
        await queryRunner.rollbackTransaction();
        await this.auditLog.record({ action: 'duplicate', eventId: event.id, eventType: event.type });
        return { outcome: 'duplicate' };
      }

      const handler = this.EVENT_HANDLERS[event.type];
      let orderId: string | null = null;

      if (handler) {
        const handlerResult = await handler(queryRunner, event);
        orderId = handlerResult.orderId;
      } else {
        await this.auditLog.record({ action: 'event_type_ignored', eventId: event.id, eventType: event.type });
      }
      void orderId; // reserved for use once handlers are registered (Task 13)

      await queryRunner.commitTransaction();
      return { outcome: 'processed' };
    } catch (err) {
      // Roll back the ENTIRE transaction, including the idempotency INSERT
      // above. Because the INSERT and the handler's writes share this single
      // transaction, rollbackTransaction() undoes both together — there is no
      // code path where a handler failure leaves the idempotency row
      // committed on its own. A rolled-back event must NOT be recorded as
      // processed, so Stripe can safely retry delivery.
      await queryRunner.rollbackTransaction();
      await this.auditLog.record({
        action: 'processing_error',
        eventId: event.id,
        eventType: event.type,
        reason: (err as Error).message,
      });
      throw err;
    } finally {
      await queryRunner.release();
    }
  }
}

/**
 * TypeORM's pg driver QueryRunner.query() shapes its return value based on
 * the SQL command it detects (see node_modules/typeorm/driver/postgres/
 * PostgresQueryRunner.js `query()`):
 *   - For UPDATE/DELETE it returns a 2-element tuple `[rows, rowCount]`.
 *   - For every other command (including INSERT) it returns *only* `rows`
 *     (the array from `RETURNING`, or `[]` if there is no RETURNING clause).
 *
 * This was verified independently for this repo's installed
 * typeorm@^0.3.20/pg@^8.12.0 against a live Postgres instance: an
 * `INSERT ... ON CONFLICT DO NOTHING` with no RETURNING clause returns `[]`
 * unconditionally (so `result[1]` is always `undefined`, which would make
 * every insert look like a duplicate) — this is a materially different shape
 * from the UPDATE case Task 6 resolved. Adding `RETURNING event_id` fixes
 * this: the query then returns one row per successfully inserted event, and
 * zero rows when ON CONFLICT DO NOTHING skipped the insert, so the row
 * array's length is the true "was this a new event" signal.
 *
 * The unit tests in stripe-webhook.service.spec.ts mock `query()` to return
 * the UPDATE-style tuple shape `[[], rowCount]` (mirroring Task 6's UPDATE
 * mocks). This helper supports both real shapes it can encounter:
 *   - `result[1]` when it is a number, as in the test's `[[], N]` mocks
 *     (and would also cover an UPDATE/DELETE-shaped result if ever reused).
 *   - `result.length` otherwise, which is correct for the real
 *     `RETURNING`-based INSERT result against Postgres.
 */
function extractInsertedRowCount(result: unknown): number {
  if (!Array.isArray(result)) return 0;
  return typeof result[1] === 'number' ? result[1] : result.length;
}
