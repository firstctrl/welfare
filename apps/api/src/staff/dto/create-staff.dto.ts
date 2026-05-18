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
  @IsString() @IsNotEmpty() fullName: string;
  @IsString() @IsNotEmpty() staffId: string;
  @IsString() @IsNotEmpty() pfNo: string;
  @IsDateString() dateOfBirth: string;
  @IsString() @IsNotEmpty() phoneNumber: string;
  @IsEmail() @IsOptional() email?: string;
  @IsDateString() dateOfEmployment: string;
  @IsDateString() dateOfFirstContribution: string;
  @IsString() @IsNotEmpty() level: string;
  @IsNumber() @Min(0) @Type(() => Number) point: number;
  @IsEnum(StaffStatus) @IsOptional() status?: StaffStatus;
}
