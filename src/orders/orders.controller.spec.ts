import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

describe('OrdersController', () => {
  let controller: OrdersController;
  let service: { getStatus: jest.Mock };

  beforeEach(async () => {
    service = { getStatus: jest.fn() };
    const module = await Test.createTestingModule({
      controllers: [OrdersController],
      providers: [{ provide: OrdersService, useValue: service }],
    }).compile();
    controller = module.get(OrdersController);
  });

  it('returns only the status field for a known order', async () => {
    service.getStatus.mockResolvedValue('paid');
    const result = await controller.getStatus('11111111-1111-1111-1111-111111111111');
    expect(result).toEqual({ status: 'paid' });
  });

  it('throws NotFoundException for an unknown order', async () => {
    service.getStatus.mockResolvedValue(null);
    await expect(
      controller.getStatus('11111111-1111-1111-1111-111111111111'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
