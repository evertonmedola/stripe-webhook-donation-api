import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  PORT: Joi.number().default(3000),
  DATABASE_URL: Joi.string().uri().required(),
  STRIPE_SECRET_KEY: Joi.string().required(),
  STRIPE_WEBHOOK_SECRET: Joi.string().required(),
  STRIPE_ALLOWED_PRICE_IDS: Joi.string().required(),
  MIN_DONATION_CENTS: Joi.number().integer().min(1).required(),
  MAX_DONATION_CENTS: Joi.number().integer().min(Joi.ref('MIN_DONATION_CENTS')).required(),
  FRONTEND_ORIGIN: Joi.string().uri().required(),
  OUTBOX_MAX_ATTEMPTS: Joi.number().integer().min(1).default(5),
  SMTP_HOST: Joi.string().required(),
  SMTP_PORT: Joi.number().required(),
  SMTP_USER: Joi.string().allow('').default(''),
  SMTP_PASS: Joi.string().allow('').default(''),
  SMTP_FROM: Joi.string().required(),
});
