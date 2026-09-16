import 'reflect-metadata';
import { DataSource, DataSourceOptions } from 'typeorm';
import { OrderEntity } from '../orders/entities/order.entity';
import { ProcessedStripeEventEntity } from '../orders/entities/processed-stripe-event.entity';
import { AuditLogEntity } from '../audit-log/entities/audit-log.entity';
import { EmailOutboxEntity } from '../outbox/entities/email-outbox.entity';

export const buildDataSourceOptions = (databaseUrl: string): DataSourceOptions => ({
  type: 'postgres',
  url: databaseUrl,
  entities: [OrderEntity, ProcessedStripeEventEntity, AuditLogEntity, EmailOutboxEntity],
  migrations: [__dirname + '/migrations/*.{ts,js}'],
  synchronize: false,
});

export default new DataSource(
  buildDataSourceOptions(process.env.DATABASE_URL ?? 'postgres://payment_user:payment_pass@localhost:5434/payment_validation'),
);
