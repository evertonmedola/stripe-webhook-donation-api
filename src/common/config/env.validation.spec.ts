import { envValidationSchema } from './env.validation';

describe('envValidationSchema', () => {
  const validEnv = {
    PORT: '3000',
    DATABASE_URL: 'postgres://u:p@localhost:5432/db',
    STRIPE_SECRET_KEY: 'sk_test_x',
    STRIPE_WEBHOOK_SECRET: 'whsec_x',
    STRIPE_ALLOWED_PRICE_IDS: 'price_a,price_b',
    MIN_DONATION_CENTS: '500',
    MAX_DONATION_CENTS: '100000',
    FRONTEND_ORIGIN: 'http://localhost:3000',
    OUTBOX_MAX_ATTEMPTS: '5',
    SMTP_HOST: 'localhost',
    SMTP_PORT: '1025',
    SMTP_FROM: 'a@b.com',
  };

  it('passes with all required vars present', () => {
    const { error } = envValidationSchema.validate(validEnv);
    expect(error).toBeUndefined();
  });

  it('fails when STRIPE_WEBHOOK_SECRET is missing', () => {
    const { STRIPE_WEBHOOK_SECRET, ...rest } = validEnv;
    const { error } = envValidationSchema.validate(rest);
    expect(error).toBeDefined();
    expect(error!.message).toContain('STRIPE_WEBHOOK_SECRET');
  });
});
