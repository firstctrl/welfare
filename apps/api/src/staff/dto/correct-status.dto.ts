import { IsDateString, IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { StaffStatus } from '@welfare/shared';

export class CorrectStatusDto {
  @IsEnum(StaffStatus) status!: StaffStatus;
  @IsDateString() effectiveDate!: string;
  @IsString() @IsNotEmpty() reason!: string;
}
