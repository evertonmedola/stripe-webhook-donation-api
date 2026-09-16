import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitSchema1700000000000 implements MigrationInterface {
  name = 'InitSchema1700000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);

    await queryRunner.query(`
      CREATE TABLE orders (
        id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        status                    varchar NOT NULL DEFAULT 'pending'
                                  CHECK (status IN ('pending','paid','failed','refunded')),
        amount_cents              integer NOT NULL,
        refunded_amount_cents     integer NOT NULL DEFAULT 0,
        currency                  varchar(3) NOT NULL DEFAULT 'brl',
        stripe_session_id         varchar UNIQUE NOT NULL,
        stripe_payment_intent_id  varchar UNIQUE NULL,
        donor_email               varchar NULL,
        created_at                timestamptz NOT NULL DEFAULT now(),
        updated_at                timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE processed_stripe_events (
        event_id      varchar PRIMARY KEY,
        event_type    varchar NOT NULL,
        order_id      uuid NULL REFERENCES orders(id),
        received_at   timestamptz NOT NULL DEFAULT now(),
        outcome       varchar NOT NULL CHECK (outcome IN ('processed','rejected','duplicate'))
      )
    `);

    await queryRunner.query(`
      CREATE TABLE audit_log (
        id          bigserial PRIMARY KEY,
        event_id    varchar NULL,
        order_id    uuid NULL REFERENCES orders(id),
        action      varchar NOT NULL,
        detail      jsonb NOT NULL,
        created_at  timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE email_outbox (
        id          bigserial PRIMARY KEY,
        order_id    uuid NOT NULL REFERENCES orders(id),
        status      varchar NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','sent','failed')),
        attempts    integer NOT NULL DEFAULT 0,
        last_error  text NULL,
        created_at  timestamptz NOT NULL DEFAULT now(),
        sent_at     timestamptz NULL
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE email_outbox`);
    await queryRunner.query(`DROP TABLE audit_log`);
    await queryRunner.query(`DROP TABLE processed_stripe_events`);
    await queryRunner.query(`DROP TABLE orders`);
  }
}
