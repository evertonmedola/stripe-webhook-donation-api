import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateCheckoutSessionDto } from './create-checkout-session.dto';

async function validateDto(input: Record<string, unknown>) {
  const dto = plainToInstance(CreateCheckoutSessionDto, input);
  return validate(dto);
}

describe('CreateCheckoutSessionDto', () => {
  it('accepts a valid fixed-price payload', async () => {
    const errors = await validateDto({ productType: 'fixed', priceId: 'price_123' });
    expect(errors).toHaveLength(0);
  });

  it('accepts a valid custom-amount payload', async () => {
    const errors = await validateDto({ productType: 'custom', amountCents: 5000 });
    expect(errors).toHaveLength(0);
  });

  it('rejects fixed without priceId', async () => {
    const errors = await validateDto({ productType: 'fixed' });
    expect(errors.some((e) => e.property === 'priceId')).toBe(true);
  });

  it('rejects fixed with amountCents present', async () => {
    const errors = await validateDto({ productType: 'fixed', priceId: 'price_123', amountCents: 5000 });
    expect(errors.some((e) => e.property === 'amountCents')).toBe(true);
  });

  it('rejects custom without amountCents', async () => {
    const errors = await validateDto({ productType: 'custom' });
    expect(errors.some((e) => e.property === 'amountCents')).toBe(true);
  });

  it('rejects custom with priceId present', async () => {
    const errors = await validateDto({ productType: 'custom', amountCents: 5000, priceId: 'price_123' });
    expect(errors.some((e) => e.property === 'priceId')).toBe(true);
  });

  it('rejects a non-integer amountCents', async () => {
    const errors = await validateDto({ productType: 'custom', amountCents: 50.5 });
    expect(errors.some((e) => e.property === 'amountCents')).toBe(true);
  });
});
