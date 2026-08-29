import { IsEnum, IsNumber, IsOptional, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ClaimType, ClaimStatus } from '@welfare/shared';

export class ClaimQueryDto {
  @IsOptional() staffId?: string;
  @IsOptional() @IsEnum(ClaimType) claimType?: ClaimType;
  @IsOptional() @IsEnum(ClaimStatus) status?: ClaimStatus;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(2000) year?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(1) limit?: number = 20;
}
