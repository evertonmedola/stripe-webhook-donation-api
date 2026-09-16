import { QueryRunner } from 'typeorm';
import Stripe from 'stripe';
import { EventHandler } from '../stripe-webhook.service';

export const paymentFailedHandler: EventHandler = async (queryRunner: QueryRunner, event: Stripe.Event) => {
  const object = event.data.object as { id: string };

  const [orderRow] = await queryRunner.query(`SELECT id FROM orders WHERE stripe_session_id = $1`, [object.id]);
  if (!orderRow) {
    return { orderId: null };
  }

  await queryRunner.query(
    `UPDATE orders SET status = 'failed', updated_at = now() WHERE id = $1 AND status = 'pending'`,
    [orderRow.id],
  );

  return { orderId: orderRow.id as string };
};
