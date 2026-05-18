import { IsMongoId, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class ManualEntryDto {
  @IsMongoId() staffId!: string;
  @IsNumber() @Min(0) @Type(() => Number) amount!: number;
  @IsNumber() @Min(1) @Max(12) @Type(() => Number) month!: number;
  @IsNumber() @Min(2000) @Type(() => Number) year!: number;
  @IsString() @IsOptional() note?: string;
}
