import { IsEnum, IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class ReportQueryDto {
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(12)
  @Type(() => Number)
  month?: number;

  @IsOptional()
  @IsNumber()
  @Min(2000)
  @Max(2100)
  @Type(() => Number)
  year?: number;

  @IsOptional()
  @IsNumber()
  @Min(2000)
  @Max(2100)
  @Type(() => Number)
  fromYear?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(12)
  @Type(() => Number)
  fromMonth?: number;

  @IsOptional()
  @IsNumber()
  @Min(2000)
  @Max(2100)
  @Type(() => Number)
  toYear?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(12)
  @Type(() => Number)
  toMonth?: number;

  @IsOptional()
  @IsEnum(['json', 'pdf', 'csv'])
  format?: 'json' | 'pdf' | 'csv';

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  page?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(1000)
  @Type(() => Number)
  limit?: number;
}

export class FundSummaryQueryDto {
  @IsNumber()
  @Min(2000)
  @Max(2100)
  @Type(() => Number)
  year!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  @Type(() => Number)
  fromMonth?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  @Type(() => Number)
  toMonth?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(4)
  @Type(() => Number)
  quarter?: number;

  @IsOptional()
  @IsEnum(['json', 'pdf', 'csv'])
  format?: 'json' | 'pdf' | 'csv';
}
