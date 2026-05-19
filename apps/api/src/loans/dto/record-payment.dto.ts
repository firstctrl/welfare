import { IsNumber, IsDateString, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class RecordPaymentDto {
  @IsNumber() @Min(0.01) @Type(() => Number) amount!: number;
  @IsDateString() paidDate!: string;
  @IsString() @IsOptional() notes?: string;
}
