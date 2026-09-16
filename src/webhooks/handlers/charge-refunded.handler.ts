import { QueryRunner } from 'typeorm';
import Stripe from 'stripe';
import { EventHandler } from '../stripe-webhook.service';

export const chargeRefundedHandler: EventHandler = async (queryRunner: QueryRunner, event: Stripe.Event) => {
  const charge = event.data.object as Stripe.Charge;
  const paymentIntentId =
    typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;

  const [orderRow] = await queryRunner.query(
    `SELECT id, amount_cents FROM orders WHERE stripe_payment_intent_id = $1`,
    [paymentIntentId],
  );
  if (!orderRow) {
    return { orderId: null };
  }

  const isFullRefund = charge.amount_refunded >= orderRow.amount_cents;

  if (isFullRefund) {
    await queryRunner.query(
      `UPDATE orders
       SET status = 'refunded', refunded_amount_cents = $2, updated_at = now()
       WHERE id = $1 AND status = 'paid'`,
      [orderRow.id, charge.amount_refunded],
    );
  } else {
    await queryRunner.query(
      `UPDATE orders SET refunded_amount_cents = $2, updated_at = now() WHERE id = $1`,
      [orderRow.id, charge.amount_refunded],
    );
  }

  return { orderId: orderRow.id as string };
};
