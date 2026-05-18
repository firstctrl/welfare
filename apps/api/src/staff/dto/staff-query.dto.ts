import { IsEnum, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { StaffStatus } from '@welfare/shared';

export class StaffQueryDto {
  @IsOptional() @IsEnum(StaffStatus) status?: StaffStatus;
  @IsOptional() @IsString() level?: string;
  @IsOptional() @IsString() q?: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(1) limit?: number = 20;
}
