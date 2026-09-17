import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

export const MAIL_TRANSPORT = 'MAIL_TRANSPORT';

export const mailTransportProvider = {
  provide: MAIL_TRANSPORT,
  inject: [ConfigService],
  useFactory: (config: ConfigService) =>
    nodemailer.createTransport({
      host: config.get<string>('SMTP_HOST'),
      port: config.get<number>('SMTP_PORT'),
      auth: config.get<string>('SMTP_USER')
        ? { user: config.get<string>('SMTP_USER'), pass: config.get<string>('SMTP_PASS') }
        : undefined,
    }),
};
