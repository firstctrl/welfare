import {
  IsDateString,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { StaffStatus } from '@welfare/shared';

export class CreateStaffDto {
  @IsString() @IsNotEmpty() fullName!: string;
  @IsString() @IsNotEmpty() staffId!: string;
  @IsString() @IsOptional() pfNo?: string;
  @IsDateString() dateOfBirth!: string;
  @IsString() @IsNotEmpty() phoneNumber!: string;
  @IsEmail() email!: string;
  @IsDateString() dateOfEmployment!: string;
  @IsDateString() @IsOptional() dateOfFirstContribution?: string;
  @IsString() @IsOptional() level?: string;
  @IsNumber() @Min(0) @IsOptional() @Type(() => Number) point?: number;
  @IsEnum(StaffStatus) @IsOptional() status?: StaffStatus;
}
