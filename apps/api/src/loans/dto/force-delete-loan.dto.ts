import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class ForceDeleteLoanDto {
  @IsBoolean()
  @IsOptional()
  forceDelete?: boolean;

  @IsString()
  @IsOptional()
  reason?: string;
}
