import { IsInt, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateRemittanceDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(12) month!: number;
  @Type(() => Number) @IsInt() @Min(2000) year!: number;
  @IsString() receiptDate!: string;
}
