import { IsMongoId, IsString } from 'class-validator';

export class ResolveLoanByStaffIdDto {
  @IsString() originalStaffId!: string;
  @IsMongoId() resolvedLoanId!: string;
}
