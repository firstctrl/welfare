import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';
import { StaffStatus } from '@welfare/shared';

export class ChangeStatusDto {
  @IsEnum(StaffStatus) status!: StaffStatus;
  @IsDateString() effectiveDate!: string;
  @IsString() @IsOptional() notes?: string;
}
