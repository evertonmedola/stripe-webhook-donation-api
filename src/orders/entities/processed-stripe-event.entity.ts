import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

export type ProcessedEventOutcome = 'processed' | 'rejected' | 'duplicate';

@Entity('processed_stripe_events')
export class ProcessedStripeEventEntity {
  @PrimaryColumn({ name: 'event_id', type: 'varchar' })
  eventId!: string;

  @Column({ name: 'event_type', type: 'varchar' })
  eventType!: string;

  @Column({ name: 'order_id', type: 'uuid', nullable: true })
  orderId!: string | null;

  @CreateDateColumn({ name: 'received_at', type: 'timestamptz' })
  receivedAt!: Date;

  @Column({ type: 'varchar' })
  outcome!: ProcessedEventOutcome;
}
