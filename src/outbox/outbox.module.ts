import { Module } from '@nestjs/common';
import { EmailOutboxService } from './email-outbox.service';
import { EmailOutboxProcessor } from './email-outbox.processor';
import { mailTransportProvider } from './mail.provider';

@Module({
  providers: [EmailOutboxService, EmailOutboxProcessor, mailTransportProvider],
})
export class OutboxModule {}
