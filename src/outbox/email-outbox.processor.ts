import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EmailOutboxService } from './email-outbox.service';

@Injectable()
export class EmailOutboxProcessor {
  private readonly logger = new Logger(EmailOutboxProcessor.name);

  constructor(private readonly outboxService: EmailOutboxService) {}

  @Cron(CronExpression.EVERY_10_SECONDS)
  async handleCron() {
    const result = await this.outboxService.processPendingBatch();
    if (result.sent > 0 || result.failed > 0) {
      this.logger.log(`email outbox batch: sent=${result.sent} failed=${result.failed}`);
    }
  }
}
