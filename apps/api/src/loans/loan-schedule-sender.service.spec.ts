import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { LoanScheduleSenderService } from './loan-schedule-sender.service';
import { LoanRepayment } from './schemas/loan-repayment.schema';
import { Staff } from '../staff/schemas/staff.schema';
import { EmailService } from '../email/email.service';
import { SystemConfigService } from '../system-config/system-config.service';

describe('LoanScheduleSenderService.sendGuarantorCapNotice', () => {
  let service: LoanScheduleSenderService;
  let staffModel: any;
  let emailService: any;
  let configService: any;

  beforeEach(async () => {
    staffModel = { findById: jest.fn() };
    emailService = { send: jest.fn().mockResolvedValue(undefined) };
    configService = { getAll: jest.fn().mockResolvedValue({ EMAIL_FROM_NAME: { value: 'Test Union' } }) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LoanScheduleSenderService,
        { provide: getModelToken(LoanRepayment.name), useValue: { find: jest.fn() } },
        { provide: getModelToken(Staff.name), useValue: staffModel },
        { provide: EmailService, useValue: emailService },
        { provide: SystemConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<LoanScheduleSenderService>(LoanScheduleSenderService);
  });

  it('emails the guarantor when they have just reached the cap', async () => {
    staffModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue({ _id: { toString: () => 'guarantor-1' }, fullName: 'Ama Owusu', email: 'ama@example.com' }) });

    await service.sendGuarantorCapNotice('guarantor-1', 3, 3, 'ABC123');

    expect(emailService.send).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the guarantor is still below the cap', async () => {
    await service.sendGuarantorCapNotice('guarantor-1', 2, 3, 'ABC123');

    expect(staffModel.findById).not.toHaveBeenCalled();
    expect(emailService.send).not.toHaveBeenCalled();
  });

  it('does nothing when the cap is unset (0 = unlimited)', async () => {
    await service.sendGuarantorCapNotice('guarantor-1', 5, 0, 'ABC123');

    expect(emailService.send).not.toHaveBeenCalled();
  });
});
