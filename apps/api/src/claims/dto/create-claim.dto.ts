import { IsEnum, IsMongoId, IsNumber, Max, Min, ValidateIf } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ClaimType, CessationReason } from '@welfare/shared';

export class CreateClaimDto {
  @IsMongoId() staffId!: string;
  @IsEnum(ClaimType) claimType!: ClaimType;
  // Empty-string values reach here from cleared/unselected form fields — normalize to
  // undefined so a non-Cessation submission never forwards '' into the Mongoose enum.
  @Transform(({ value }) => (value === '' ? undefined : value))
  @ValidateIf((o) => o.claimType === ClaimType.Cessation)
  @IsEnum(CessationReason)
  subReason?: CessationReason;
  @IsNumber() @Min(1) @Max(12) @Type(() => Number) month!: number;
  @IsNumber() @Min(2000) @Type(() => Number) year!: number;
  @IsNumber() @Min(0) @Type(() => Number) amount!: number;
}
