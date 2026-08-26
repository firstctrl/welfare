import { ArrayNotEmpty, IsMongoId } from 'class-validator';

export class BulkDeleteDto {
  @ArrayNotEmpty()
  @IsMongoId({ each: true })
  ids!: string[];
}
