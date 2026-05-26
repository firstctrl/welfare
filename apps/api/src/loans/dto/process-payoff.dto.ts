import { IsDateString, IsNumber, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class ProcessPayOffDto {
  @Type(() => Number) @IsNumber() @Min(0) amountReceived!: number;
  @IsDateString() paymentDate!: string;
}
