import {
  IsIn,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

interface CheckoutSessionShape {
  productType?: 'fixed' | 'custom';
  priceId?: unknown;
  amountCents?: unknown;
}

/**
 * Cross-field rule for `priceId`:
 *  - required (non-empty string) when productType === 'fixed'
 *  - forbidden (must be absent) when productType === 'custom'
 *
 * This is a security boundary: it prevents a client from attaching a
 * `priceId` to a "custom amount" checkout, which would otherwise let a
 * fixed-price catalog item be smuggled in alongside a client-chosen amount.
 */
@ValidatorConstraint({ name: 'priceIdCrossField', async: false })
class PriceIdCrossFieldConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    const obj = args.object as CheckoutSessionShape;
    if (obj.productType === 'fixed') {
      return typeof value === 'string' && value.trim().length > 0;
    }
    if (obj.productType === 'custom') {
      return value === undefined;
    }
    // productType itself is invalid; let @IsIn on productType report that.
    return true;
  }

  defaultMessage(args: ValidationArguments): string {
    const obj = args.object as CheckoutSessionShape;
    if (obj.productType === 'custom') {
      return 'priceId must not be provided when productType is custom';
    }
    return 'priceId is required and must be a non-empty string when productType is fixed';
  }
}

/**
 * Cross-field rule for `amountCents`:
 *  - required (integer) when productType === 'custom'
 *  - forbidden (must be absent) when productType === 'fixed'
 *
 * This is the other half of the security boundary: it prevents a client
 * from smuggling a client-chosen `amountCents` into a fixed-price checkout,
 * which would let the client dictate the charged amount instead of the
 * server-trusted price.
 */
@ValidatorConstraint({ name: 'amountCentsCrossField', async: false })
class AmountCentsCrossFieldConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    const obj = args.object as CheckoutSessionShape;
    if (obj.productType === 'custom') {
      return typeof value === 'number' && Number.isInteger(value);
    }
    if (obj.productType === 'fixed') {
      return value === undefined;
    }
    // productType itself is invalid; let @IsIn on productType report that.
    return true;
  }

  defaultMessage(args: ValidationArguments): string {
    const obj = args.object as CheckoutSessionShape;
    if (obj.productType === 'fixed') {
      return 'amountCents must not be provided when productType is fixed';
    }
    return 'amountCents is required and must be an integer when productType is custom';
  }
}

export class CreateCheckoutSessionDto {
  @IsIn(['fixed', 'custom'])
  productType!: 'fixed' | 'custom';

  @Validate(PriceIdCrossFieldConstraint)
  priceId?: string;

  @Validate(AmountCentsCrossFieldConstraint)
  amountCents?: number;
}
