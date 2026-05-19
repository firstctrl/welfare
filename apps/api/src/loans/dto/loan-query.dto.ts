import { IsOptional, IsString, IsEnum, IsNumber, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { LoanStatus } from '@welfare/shared';

export class LoanQueryDto {
  @IsString() @IsOptional() staffId?: string;
  @IsEnum(LoanStatus) @IsOptional() status?: LoanStatus;
  @IsNumber() @Min(1) @Type(() => Number) @IsOptional() page?: number;
  @IsNumber() @Min(1) @Type(() => Number) @IsOptional() limit?: number;
}
