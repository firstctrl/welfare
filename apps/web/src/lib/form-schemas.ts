import { z } from 'zod';

export const staffSchema = z.object({
  fullName:                z.string().min(1, 'Required'),
  staffId:                 z.string().min(1, 'Required'),
  pfNo:                    z.string().min(1, 'Required'),
  dateOfBirth:             z.string().min(1, 'Required'),
  phoneNumber:             z.string().min(1, 'Required'),
  email:                   z.string().email('Invalid email').optional().or(z.literal('')),
  dateOfEmployment:        z.string().min(1, 'Required'),
  dateOfFirstContribution: z.string().min(1, 'Required'),
  level:                   z.string().min(1, 'Required'),
  point:                   z.coerce.number().min(0).default(0),
});

export const loanSchema = z.object({
  staffId:         z.string().min(1, 'Select a staff member'),
  guarantorId:     z.string().min(1, 'Select a guarantor'),
  principalAmount: z.coerce.number().min(1, 'Required'),
  tenureMonths:    z.coerce.number().min(1).max(12),
  disbursedDate:   z.string().min(1, 'Required'),
});

export const contributionSchema = z.object({
  staffId: z.string().min(24, 'Select a staff member'),
  amount:  z.coerce.number().min(1, 'Amount must be > 0'),
  month:   z.coerce.number().min(1).max(12),
  year:    z.coerce.number().min(2000),
  note:    z.string().optional(),
});

export const loginSchema = z.object({
  username: z.string().min(1, 'Required'),
  password: z.string().min(1, 'Required'),
});

export type StaffFormValues = z.infer<typeof staffSchema>;
export type LoanFormValues = z.infer<typeof loanSchema>;
export type ContributionFormValues = z.infer<typeof contributionSchema>;
export type LoginFormValues = z.infer<typeof loginSchema>;
