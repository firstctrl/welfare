import { StaffStatus } from '../enums/staff-status.enum';

export interface CreateStaffDto {
  fullName: string;
  staffId: string;
  pfNo: string;
  dateOfBirth: string;
  phoneNumber: string;
  email?: string;
  photoKey?: string;
  dateOfEmployment: string;
  dateOfFirstContribution: string;
  level: string;
  point: number;
  status?: StaffStatus;
}

export interface UpdateStaffDto {
  fullName?: string;
  pfNo?: string;
  dateOfBirth?: string;
  phoneNumber?: string;
  email?: string;
  photoKey?: string;
  dateOfEmployment?: string;
  dateOfFirstContribution?: string;
  level?: string;
  point?: number;
  status?: StaffStatus;
}

export interface StaffResponseDto {
  _id: string;
  fullName: string;
  staffId: string;
  pfNo: string;
  dateOfBirth: string;
  phoneNumber: string;
  email?: string;
  photoKey?: string;
  dateOfEmployment: string;
  dateOfFirstContribution: string;
  level: string;
  point: number;
  status: StaffStatus;
  createdAt: string;
  updatedAt: string;
}
