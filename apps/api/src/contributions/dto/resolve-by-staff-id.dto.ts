import { IsMongoId, IsString } from 'class-validator';

export class ResolveByStaffIdDto {
  @IsString() originalStaffId!: string;
  @IsMongoId() resolvedStaffMongoId!: string;
}
