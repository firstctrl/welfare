import { IsMongoId, IsString } from 'class-validator';

export class ResolveFlaggedDto {
  @IsString() originalStaffId!: string;
  @IsMongoId() resolvedStaffMongoId!: string;
}
