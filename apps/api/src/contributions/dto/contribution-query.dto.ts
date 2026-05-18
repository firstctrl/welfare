import { IsEnum, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ContributionStatus } from '@welfare/shared';

export class ContributionQueryDto {
  @IsOptional() @IsString() staffId?: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(1) @Max(12) month?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(2000) year?: number;
  @IsOptional() @IsEnum(ContributionStatus) status?: ContributionStatus;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(1) limit?: number = 20;
}
