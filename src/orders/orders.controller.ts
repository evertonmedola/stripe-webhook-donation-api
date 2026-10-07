import { Controller, Get, NotFoundException, Param, ParseUUIDPipe } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { OrdersService } from './orders.service';

@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get(':id/status')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async getStatus(@Param('id', ParseUUIDPipe) id: string): Promise<{ status: string }> {
    const status = await this.ordersService.getStatus(id);
    if (!status) {
      throw new NotFoundException();
    }
    return { status };
  }
}
