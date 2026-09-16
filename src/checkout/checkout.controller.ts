import { Body, Controller, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CheckoutService } from './checkout.service';
import { CreateCheckoutSessionDto } from './dto/create-checkout-session.dto';

@Controller('checkout')
export class CheckoutController {
  constructor(private readonly checkoutService: CheckoutService) {}

  @Post('sessions')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  create(@Body() dto: CreateCheckoutSessionDto): Promise<{ checkoutUrl: string }> {
    return this.checkoutService.createSession(dto);
  }
}
