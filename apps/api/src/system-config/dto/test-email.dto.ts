import { IsEmail, IsIn } from 'class-validator';

export class TestEmailDto {
  @IsIn(['resend', 'outlook365'])
  provider!: 'resend' | 'outlook365';

  @IsEmail()
  to!: string;
}
