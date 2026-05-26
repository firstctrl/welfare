import { IsIn, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateInvestmentDto {
  @IsOptional() @IsString() purchaseDate?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0.01) cost?: number;
  @IsOptional() @IsString() maturityDate?: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0.01) faceValue?: number;
  @IsOptional() @IsIn(['One-Time', 'Roll-Over']) instruction?: 'One-Time' | 'Roll-Over';
  @IsString() reason!: string;
}
