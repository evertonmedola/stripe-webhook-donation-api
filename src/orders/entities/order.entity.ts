import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type OrderStatus = 'pending' | 'paid' | 'failed' | 'refunded';

@Entity('orders')
export class OrderEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', default: 'pending' })
  status!: OrderStatus;

  @Column({ name: 'amount_cents', type: 'integer' })
  amountCents!: number;

  @Column({ name: 'refunded_amount_cents', type: 'integer', default: 0 })
  refundedAmountCents!: number;

  @Column({ type: 'varchar', length: 3, default: 'brl' })
  currency!: string;

  @Column({ name: 'stripe_session_id', type: 'varchar', unique: true })
  stripeSessionId!: string;

  @Column({ name: 'stripe_payment_intent_id', type: 'varchar', unique: true, nullable: true })
  stripePaymentIntentId!: string | null;

  @Column({ name: 'donor_email', type: 'varchar', nullable: true })
  donorEmail!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
