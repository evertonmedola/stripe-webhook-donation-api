import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { AuditLogService, AuditLogEntry } from './audit-log.service';

describe('AuditLogService', () => {
  let service: AuditLogService;
  let dataSource: { query: jest.Mock };

  beforeEach(async () => {
    dataSource = { query: jest.fn().mockResolvedValue(undefined) };
    const module = await Test.createTestingModule({
      providers: [AuditLogService, { provide: DataSource, useValue: dataSource }],
    }).compile();
    service = module.get(AuditLogService);
  });

  it('writes only allowlisted fields to detail, dropping anything else', async () => {
    await service.record({
      eventId: 'evt_1',
      orderId: 'order_1',
      action: 'order_transitioned',
      status: 'paid',
      reason: 'test-reason',
      secretCardNumber: '4242424242424242',
    } as any);

    expect(dataSource.query).toHaveBeenCalledTimes(1);
    const [, params] = dataSource.query.mock.calls[0];
    const detailJson = JSON.stringify(params[3]);
    expect(detailJson).not.toContain('secretCardNumber');
    expect(detailJson).not.toContain('4242424242424242');
  });

  it('never throws when the underlying write fails', async () => {
    dataSource.query.mockRejectedValue(new Error('db down'));
    await expect(
      service.record({ action: 'signature_invalid' }),
    ).resolves.toBeUndefined();
  });

  it('never throws when entry is malformed (null or undefined)', async () => {
    await expect(
      service.record(undefined as unknown as AuditLogEntry),
    ).resolves.toBeUndefined();

    await expect(
      service.record(null as unknown as AuditLogEntry),
    ).resolves.toBeUndefined();
  });
});
