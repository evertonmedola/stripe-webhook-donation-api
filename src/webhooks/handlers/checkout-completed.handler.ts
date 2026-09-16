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

  await queryRunner.query(
    `UPDATE orders
     SET status = 'paid', donor_email = $2, stripe_payment_intent_id = $3, amount_cents = $4, updated_at = now()
     WHERE id = $1 AND status = 'pending'`,
    [orderRow.id, donorEmail, paymentIntentId, chargedAmountCents],
  );

  await queryRunner.query(
    `INSERT INTO email_outbox (order_id, status) VALUES ($1, 'pending')`,
    [orderRow.id],
  );

  return { orderId: orderRow.id as string };
};
