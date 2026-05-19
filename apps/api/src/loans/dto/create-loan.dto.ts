import { IsString, IsNotEmpty, IsNumber, IsDateString, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateLoanDto {
  @IsString() @IsNotEmpty() staffId!: string;
  @IsString() @IsNotEmpty() guarantorId!: string;
  @IsNumber() @Min(1) @Type(() => Number) principalAmount!: number;
  @IsNumber() @Min(1) @Max(12) @Type(() => Number) tenureMonths!: number;
  @IsDateString() disbursedDate!: string;
}
