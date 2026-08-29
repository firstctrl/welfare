import { IsInt, Min } from 'class-validator';

export class DismissFlaggedEntryDto {
  @IsInt() @Min(0) index!: number;
}
