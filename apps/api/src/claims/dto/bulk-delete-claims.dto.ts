import { ArrayNotEmpty, IsMongoId } from 'class-validator';

export class BulkDeleteClaimsDto {
  @ArrayNotEmpty()
  @IsMongoId({ each: true })
  ids!: string[];
}
