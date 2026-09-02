import { IsEnum, IsNumber, IsOptional, IsString, Max, Min, ValidateIf } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ClaimType, CessationReason } from '@welfare/shared';

export class UpdateClaimDto {
  @IsEnum(ClaimType) claimType!: ClaimType;
  @Transform(({ value }) => (value === '' ? undefined : value))
  @ValidateIf((o) => o.claimType === ClaimType.Cessation)
  @IsEnum(CessationReason)
  subReason?: CessationReason;
  @IsNumber() @Min(1) @Max(12) @Type(() => Number) month!: number;
  @IsNumber() @Min(2000) @Type(() => Number) year!: number;
  @IsNumber() @Min(0) @Type(() => Number) amount!: number;
  @IsOptional() @IsString() reason?: string;
}
