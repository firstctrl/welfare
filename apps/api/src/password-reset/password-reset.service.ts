import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';
import { EmailLogType, EmailTriggerSource } from '@welfare/shared';
import { PasswordResetToken, PasswordResetTokenDocument } from './schemas/password-reset-token.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { EmailService } from '../email/email.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { renderPasswordResetTemplate } from '../email/templates/password-reset.template';

const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

@Injectable()
export class PasswordResetService {
  constructor(
    @InjectModel(PasswordResetToken.name) private readonly tokenModel: Model<PasswordResetTokenDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly emailService: EmailService,
    private readonly configService: SystemConfigService,
  ) {}

  async requestReset(user: UserDocument, opts: { triggeredByAdmin: boolean }): Promise<void> {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const userId = user._id.toString();

    await this.tokenModel.create({
      userId,
      tokenHash,
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
    });

    const config = await this.configService.getAll() as unknown as Record<string, { value: string }>;
    const organisationName = config['EMAIL_FROM_NAME']?.value ?? 'Welfare System';
    const baseUrl = process.env.APP_URL ?? process.env.CORS_ORIGIN ?? '';
    const resetUrl = `${baseUrl}/reset-password?token=${rawToken}`;

    const html = renderPasswordResetTemplate({
      displayName: user.displayName,
      resetUrl,
      organisationName,
      expiresInHours: 1,
      triggeredByAdmin: opts.triggeredByAdmin,
    });

    await this.emailService.send(
      { staffId: userId, staffName: user.displayName, email: user.email! },
      EmailLogType.PasswordReset,
      'Reset Your Password',
      html,
      EmailTriggerSource.Manual,
    );
  }

  async consumeToken(rawToken: string, newPassword: string): Promise<void> {
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const record = await this.tokenModel.findOne({ tokenHash }).exec();

    const invalid =
      !record ||
      record.usedAt !== undefined ||
      record.expiresAt.getTime() < Date.now();
    if (invalid) {
      throw new BadRequestException('Reset link is invalid or has expired');
    }

    const user = await this.userModel.findById(record!.userId).select('+passwordHash').exec();
    if (!user) throw new BadRequestException('Reset link is invalid or has expired');

    user.passwordHash = await bcrypt.hash(newPassword, 12);
    await user.save();

    record!.usedAt = new Date();
    await record!.save();

    await this.tokenModel
      .updateMany(
        { userId: record!.userId, usedAt: { $exists: false } },
        { $set: { usedAt: new Date() } },
      )
      .exec();
  }
}
