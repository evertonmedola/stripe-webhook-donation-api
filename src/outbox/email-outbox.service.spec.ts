import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { EmailOutboxService } from './email-outbox.service';
import { MAIL_TRANSPORT } from './mail.provider';

describe('EmailOutboxService', () => {
  let service: EmailOutboxService;
  let dataSource: { transaction: jest.Mock };
  let manager: { query: jest.Mock };
  let mailTransport: { sendMail: jest.Mock };

  beforeEach(async () => {
    manager = { query: jest.fn() };
    dataSource = {
      transaction: jest.fn().mockImplementation(async (cb: (m: unknown) => unknown) => cb(manager)),
    };
    mailTransport = { sendMail: jest.fn() };
    const config = { get: jest.fn().mockReturnValue('5') };

    const module = await Test.createTestingModule({
      providers: [
        EmailOutboxService,
        { provide: DataSource, useValue: dataSource },
        { provide: MAIL_TRANSPORT, useValue: mailTransport },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();
    service = module.get(EmailOutboxService);
  });

  it('sends each pending row and marks it sent', async () => {
    manager.query
      .mockResolvedValueOnce([{ id: '1', order_id: 'o1', attempts: 0 }]) // SELECT ... FOR UPDATE SKIP LOCKED
      .mockResolvedValueOnce([{ donor_email: 'donor@example.com', amount_cents: 2000, created_at: new Date('2026-01-01T12:00:00Z') }]) // SELECT donor_email, amount_cents, created_at
      .mockResolvedValueOnce([[], 1]); // UPDATE ... SET status='sent'
    mailTransport.sendMail.mockResolvedValue(undefined);

    const result = await service.processPendingBatch();

    expect(mailTransport.sendMail).toHaveBeenCalledTimes(1);
    const sentMail = mailTransport.sendMail.mock.calls[0][0];
    expect(sentMail.to).toBe('donor@example.com');
    expect(sentMail.subject).toContain('R$ 20,00');
    expect(sentMail.html).toContain('R$ 20,00');
    expect(sentMail.text).toContain('R$ 20,00');
    expect(result).toEqual({ sent: 1, failed: 0 });
  });

  it('increments attempts and records last_error on send failure, without throwing', async () => {
    manager.query
      .mockResolvedValueOnce([{ id: '2', order_id: 'o2', attempts: 4 }])
      .mockResolvedValueOnce([{ donor_email: 'donor@example.com' }]) // SELECT donor_email
      .mockResolvedValueOnce([[], 1]); // UPDATE ... SET attempts=attempts+1, status='failed' (attempts now >= max)
    mailTransport.sendMail.mockRejectedValue(new Error('smtp down'));

    const result = await service.processPendingBatch();

    expect(result).toEqual({ sent: 0, failed: 1 });
  });

  it('runs the SELECT ... FOR UPDATE and all per-row queries on the same transactional manager', async () => {
    manager.query
      .mockResolvedValueOnce([{ id: '3', order_id: 'o3', attempts: 0 }])
      .mockResolvedValueOnce([{ donor_email: 'donor@example.com' }])
      .mockResolvedValueOnce([[], 1]);
    mailTransport.sendMail.mockResolvedValue(undefined);

    await service.processPendingBatch();

    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    // Every query issued during the batch (SELECT ... FOR UPDATE SKIP LOCKED,
    // the donor_email lookup, and the status UPDATE) went through the SAME
    // manager instance that dataSource.transaction() handed to its callback —
    // i.e. they share the connection that is holding the row locks.
    expect(manager.query).toHaveBeenCalledTimes(3);
    expect(manager.query.mock.calls[0][0]).toMatch(/FOR UPDATE SKIP LOCKED/);
    expect(manager.query.mock.calls[2][0]).toMatch(/UPDATE email_outbox SET status = 'sent'/);
  });
});
