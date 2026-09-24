import { ArrayMaxSize, ArrayNotEmpty, ArrayUnique, IsMongoId } from 'class-validator';

export class BulkDeleteDto {
  @ArrayNotEmpty()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsMongoId({ each: true })
  ids!: string[];
}
