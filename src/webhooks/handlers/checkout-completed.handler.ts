import { QueryRunner } from 'typeorm';
import Stripe from 'stripe';
import { EventHandler } from '../stripe-webhook.service';

export const checkoutCompletedHandler: EventHandler = async (queryRunner: QueryRunner, event: Stripe.Event) => {
  const session = event.data.object as Stripe.Checkout.Session;
  const donorEmail = session.customer_details?.email ?? null;
  const paymentIntentId =
    typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id ?? null;
  const chargedAmountCents = session.amount_total ?? 0;

  const [orderRow] = await queryRunner.query(`SELECT id FROM orders WHERE stripe_session_id = $1`, [session.id]);
  if (!orderRow) {
    return { orderId: null };
  }

  const updateResult = await queryRunner.query(
    `UPDATE orders
     SET status = 'paid', donor_email = $2, stripe_payment_intent_id = $3, amount_cents = $4, updated_at = now()
     WHERE id = $1 AND status = 'pending'`,
    [orderRow.id, donorEmail, paymentIntentId, chargedAmountCents],
  );

  // Only queue the payment-confirmation email when the UPDATE actually
  // transitioned this order (pending -> paid). Stripe does not guarantee
  // delivery order across event types for the same session (e.g.
  // checkout.session.expired could be delivered after this event), so the
  // order may already be in 'failed' or 'refunded' by the time this runs —
  // in that case the WHERE matches 0 rows and queuing a confirmation email
  // would mislead the donor about the true state of their payment.
  if (extractUpdatedRowCount(updateResult) === 1) {
    await queryRunner.query(
      `INSERT INTO email_outbox (order_id, status) VALUES ($1, 'pending')`,
      [orderRow.id],
    );
  } else if (donorEmail) {
    // payment_intent.succeeded can win the pending -> paid race before this
    // event arrives. Its PaymentIntent.receipt_email is null for Checkout
    // Sessions (Stripe never populates it there), so the order ends up
    // 'paid' with no donor_email. Backfill it here from customer_details,
    // which Checkout always collects. The email_outbox row that
    // paymentIntentSucceededHandler already queued will pick this up on its
    // next retry (it reads donor_email live, not from an insert-time copy).
    await queryRunner.query(
      `UPDATE orders SET donor_email = $2, updated_at = now() WHERE id = $1 AND status = 'paid' AND donor_email IS NULL`,
      [orderRow.id, donorEmail],
    );
  }

  return { orderId: orderRow.id as string };
};

/**
 * TypeORM's pg driver QueryRunner.query() for an UPDATE statement returns an
 * array `[rows, rowCount]` where `rows` is `undefined` (no RETURNING clause)
 * and `rowCount` is the number of rows affected — same shape/behavior as
 * orders.service.ts's transitionAtomic helper of the same name.
 */
function extractUpdatedRowCount(result: unknown): number {
  if (Array.isArray(result) && typeof result[1] === 'number') {
    return result[1];
  }
  return 0;
}
