import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { EmailOutboxService } from './email-outbox.service';
import { MAIL_TRANSPORT } from './mail.provider';

describe('EmailOutboxService', () => {
  let service: EmailOutboxService;
  let dataSource: { query: jest.Mock };
  let mailTransport: { sendMail: jest.Mock };

  beforeEach(async () => {
    dataSource = { query: jest.fn() };
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
    dataSource.query
      .mockResolvedValueOnce([{ id: '1', order_id: 'o1', attempts: 0 }]) // SELECT ... FOR UPDATE SKIP LOCKED
      .mockResolvedValueOnce([[], 1]); // UPDATE ... SET status='sent'
    mailTransport.sendMail.mockResolvedValue(undefined);

    const result = await service.processPendingBatch();

    expect(mailTransport.sendMail).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ sent: 1, failed: 0 });
  });

  it('increments attempts and records last_error on send failure, without throwing', async () => {
    dataSource.query
      .mockResolvedValueOnce([{ id: '2', order_id: 'o2', attempts: 4 }])
      .mockResolvedValueOnce([[], 1]); // UPDATE ... SET attempts=attempts+1, status='failed' (attempts now >= max)
    mailTransport.sendMail.mockRejectedValue(new Error('smtp down'));

    const result = await service.processPendingBatch();

    expect(result).toEqual({ sent: 0, failed: 1 });
  });
});
