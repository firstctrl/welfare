import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { IInvestmentRow, PaginatedResult } from '@welfare/shared';
import { Investment, InvestmentDocument } from './schemas/investment.schema';

function r2(n: number) { return Math.round(n * 100) / 100; }

export interface CreateInvestmentDto {
  purchaseDate: string;
  description: string;
  cost: number;
  maturityDate: string;
  faceValue: number;
  instruction: 'One-Time' | 'Roll-Over';
}

export interface UpdateInvestmentDto {
  purchaseDate?: string;
  description?: string;
  cost?: number;
  maturityDate?: string;
  faceValue?: number;
  instruction?: 'One-Time' | 'Roll-Over';
}

@Injectable()
export class InvestmentsService {
  constructor(
    @InjectModel(Investment.name) private readonly model: Model<InvestmentDocument>,
  ) {}

  computeStatus(maturityDate: Date): 'Active' | 'Matured' {
    return maturityDate <= new Date() ? 'Matured' : 'Active';
  }

  private toRow(doc: InvestmentDocument): IInvestmentRow {
    const toDate = (v: unknown): Date => (v instanceof Date ? v : new Date(v as string));
    const purchaseDate = doc.purchaseDate ? toDate(doc.purchaseDate) : new Date(0);
    const maturityDate = doc.maturityDate ? toDate(doc.maturityDate) : new Date(0);
    return {
      id: doc._id?.toString() ?? '',
      purchaseDate: purchaseDate.toISOString(),
      description: doc.description ?? '',
      cost: doc.cost ?? 0,
      maturityDate: maturityDate.toISOString(),
      faceValue: doc.faceValue ?? 0,
      interest: doc.interest ?? 0,
      rate: doc.rate ?? 0,
      status: this.computeStatus(maturityDate),
      instruction: doc.instruction ?? 'One-Time',
    };
  }

  async create(dto: CreateInvestmentDto, actorId: string): Promise<IInvestmentRow> {
    const interest = r2(dto.faceValue - dto.cost);
    const rate = r2((interest / dto.cost) * 100);
    const doc = await this.model.create({
      purchaseDate: new Date(dto.purchaseDate),
      description: dto.description,
      cost: dto.cost,
      maturityDate: new Date(dto.maturityDate),
      faceValue: dto.faceValue,
      interest,
      rate,
      instruction: dto.instruction,
      recordedBy: actorId,
    });
    return this.toRow(doc);
  }

  async findAll(page = 1, limit = 20): Promise<PaginatedResult<IInvestmentRow>> {
    const skip = (page - 1) * limit;
    const filter = { deletedAt: { $exists: false } };
    const [docs, total] = await Promise.all([
      this.model.find(filter).sort({ purchaseDate: -1 }).skip(skip).limit(limit).exec(),
      this.model.countDocuments(filter).exec(),
    ]);
    return {
      data: docs.map(d => this.toRow(d)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async update(
    id: string,
    dto: UpdateInvestmentDto,
    reason: string,
    actorId: string,
  ): Promise<IInvestmentRow> {
    if (!reason?.trim()) throw new BadRequestException('reason is required for edits');

    const doc = await this.model.findOne({ _id: id, deletedAt: { $exists: false } }).exec();
    if (!doc) throw new NotFoundException('Investment not found');

    const snapshot: Record<string, unknown> = {
      purchaseDate: doc.purchaseDate,
      description: doc.description,
      cost: doc.cost,
      maturityDate: doc.maturityDate,
      faceValue: doc.faceValue,
      interest: doc.interest,
      rate: doc.rate,
      instruction: doc.instruction,
    };

    if (dto.purchaseDate) doc.purchaseDate = new Date(dto.purchaseDate);
    if (dto.description) doc.description = dto.description;
    if (dto.cost !== undefined) doc.cost = dto.cost;
    if (dto.maturityDate) doc.maturityDate = new Date(dto.maturityDate);
    if (dto.faceValue !== undefined) doc.faceValue = dto.faceValue;
    if (dto.instruction) doc.instruction = dto.instruction;

    doc.interest = r2(doc.faceValue - doc.cost);
    doc.rate = r2((doc.interest / doc.cost) * 100);

    doc.editHistory.push({ editedBy: actorId, editedAt: new Date(), reason: reason.trim(), snapshot });
    await doc.save();
    return this.toRow(doc);
  }

  async softDelete(id: string, reason: string, actorId: string): Promise<void> {
    if (!reason?.trim()) throw new BadRequestException('reason is required for deletion');

    const doc = await this.model.findOne({ _id: id, deletedAt: { $exists: false } }).exec();
    if (!doc) throw new NotFoundException('Investment not found');

    await this.model.updateOne(
      { _id: id },
      { deletedAt: new Date(), deletedBy: actorId, deletionReason: reason.trim() },
    );
  }
}
