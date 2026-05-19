import { IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class ExitSettlementDto {
  @IsNumber() @Min(0) @Type(() => Number) exitDeductionAmount!: number;
  @IsString() @IsOptional() notes?: string;
}
