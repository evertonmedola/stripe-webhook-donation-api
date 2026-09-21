import { QueryRunner } from 'typeorm';
import Stripe from 'stripe';
import { EventHandler } from '../stripe-webhook.service';

/**
 * Defensive complement to checkoutCompletedHandler: Stripe does not
 * guarantee delivery order between checkout.session.completed and
 * payment_intent.succeeded for the same Checkout Session, so this handler
 * can win the pending->paid race instead. Correlates via
 * payment_intent.metadata.orderId (set at Checkout Session creation via
 * payment_intent_data.metadata in checkout.service.ts) rather than
 * stripe_session_id/stripe_payment_intent_id, since neither column is
 * populated on the order until whichever of these two handlers wins the
 * race writes it.
 */
export const paymentIntentSucceededHandler: EventHandler = async (
  queryRunner: QueryRunner,
  event: Stripe.Event,
) => {
  const paymentIntent = event.data.object as Stripe.PaymentIntent;
  const orderId = paymentIntent.metadata?.orderId ?? null;
  if (!orderId) {
    return { orderId: null };
  }

  const donorEmail = paymentIntent.receipt_email ?? null;
  const chargedAmountCents = paymentIntent.amount_received ?? paymentIntent.amount ?? 0;

  const updateResult = await queryRunner.query(
    `UPDATE orders
     SET status = 'paid', donor_email = $2, stripe_payment_intent_id = $3, amount_cents = $4, updated_at = now()
     WHERE id = $1 AND status = 'pending'`,
    [orderId, donorEmail, paymentIntent.id, chargedAmountCents],
  );

  // Same gating as checkoutCompletedHandler: only queue the confirmation
  // email when this event is the one that actually transitioned the order.
  // If checkout.session.completed already won the race, the WHERE matches
  // 0 rows and that handler's own email_outbox insert is the only one.
  if (extractUpdatedRowCount(updateResult) === 1) {
    await queryRunner.query(
      `INSERT INTO email_outbox (order_id, status) VALUES ($1, 'pending')`,
      [orderId],
    );
  }

  return { orderId };
};

/**
 * Same TypeORM pg-driver UPDATE return shape as orders.service.ts's
 * transitionAtomic and checkout-completed.handler.ts: [rows, rowCount].
 */
function extractUpdatedRowCount(result: unknown): number {
  if (Array.isArray(result) && typeof result[1] === 'number') {
    return result[1];
  }
  return 0;
}
