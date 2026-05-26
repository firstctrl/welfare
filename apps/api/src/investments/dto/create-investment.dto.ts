import { IsIn, IsNumber, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateInvestmentDto {
  @IsString() purchaseDate!: string;
  @IsString() description!: string;
  @Type(() => Number) @IsNumber() @Min(0.01) cost!: number;
  @IsString() maturityDate!: string;
  @Type(() => Number) @IsNumber() @Min(0.01) faceValue!: number;
  @IsIn(['One-Time', 'Roll-Over']) instruction!: 'One-Time' | 'Roll-Over';
}
