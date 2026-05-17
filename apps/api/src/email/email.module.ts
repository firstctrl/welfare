import { Module, Global } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

export const EMAIL_TRANSPORTER = 'EMAIL_TRANSPORTER';

@Global()
@Module({
  providers: [
    {
      provide: EMAIL_TRANSPORTER,
      useFactory: (configService: ConfigService): nodemailer.Transporter => {
        const provider = configService.get<string>('email.provider');

        if (provider === 'resend') {
          return nodemailer.createTransport({
            host: 'smtp.resend.com',
            port: 465,
            secure: true,
            auth: {
              user: 'resend',
              pass: configService.get<string>('email.resendApiKey'),
            },
          });
        }

        // SMTP (e.g. Outlook 365)
        return nodemailer.createTransport({
          host: configService.get<string>('email.smtp.host'),
          port: configService.get<number>('email.smtp.port'),
          secure: false,
          auth: {
            user: configService.get<string>('email.smtp.user'),
            pass: configService.get<string>('email.smtp.pass'),
          },
        });
      },
      inject: [ConfigService],
    },
  ],
  exports: [EMAIL_TRANSPORTER],
})
export class EmailModule {}
