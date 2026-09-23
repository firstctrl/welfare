import mongoose from 'mongoose';
import { LoanLegacyImportBatch, LoanLegacyImportBatchSchema } from './loan-legacy-import-batch.schema';
import { ImportBatchStatus } from '@welfare/shared';

describe('LoanLegacyImportBatch schema', () => {
  const Model =
    mongoose.models.LoanLegacyImportBatchSpec ??
    mongoose.model<LoanLegacyImportBatch>('LoanLegacyImportBatchSpec', LoanLegacyImportBatchSchema);

  it('validates a flagged entry whose Loan Ref is empty (the "Missing Loan Ref" case)', () => {
    const doc = new Model({
      fileName: 'legacy.xlsx',
      uploadedBy: 'Actor',
      totalRows: 1,
      flaggedEntries: [{ loanRef: '', staffId: '', guarantorId: '', principalAmount: 0, disbursedDate: '', reason: 'Missing Loan Ref' }],
      status: ImportBatchStatus.Pending,
    });

    const err = doc.validateSync();

    expect(err).toBeUndefined();
  });
});
