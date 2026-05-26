import { IsInt, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';

export class RemittanceQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() fromMonth?: number;
  @IsOptional() @Type(() => Number) @IsInt() fromYear?: number;
  @IsOptional() @Type(() => Number) @IsInt() toMonth?: number;
  @IsOptional() @Type(() => Number) @IsInt() toYear?: number;
  @IsOptional() @IsString() format?: 'csv' | 'pdf';
}
