import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ImportProgressController } from './import-progress.controller';
import { ImportProgressService } from './import-progress.service';

describe('ImportProgressController', () => {
  let controller: ImportProgressController;
  const mockService = { get: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ImportProgressController],
      providers: [{ provide: ImportProgressService, useValue: mockService }],
    }).compile();
    controller = module.get(ImportProgressController);
    jest.clearAllMocks();
  });

  it('returns progress when found', () => {
    mockService.get.mockReturnValue({ processed: 3, total: 10, done: false });
    expect(controller.get('job-1')).toEqual({ processed: 3, total: 10, done: false });
    expect(mockService.get).toHaveBeenCalledWith('job-1');
  });

  it('throws NotFoundException when not found', () => {
    mockService.get.mockReturnValue(null);
    expect(() => controller.get('missing')).toThrow(NotFoundException);
  });
});
