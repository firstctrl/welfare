# Phase 3 — Staff Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Full staff profile management with photo upload (MinIO), Meilisearch indexing, paginated list, and detail page with status lifecycle.

**Architecture:** NestJS StaffModule owns schema + service + controller; photo stored in MinIO at `staff-photos/{staffId}/photo.{ext}`; Meilisearch synced fire-and-forget on write. Next.js pages use TanStack Query v5 for data fetching, TanStack Table v8 for the list, react-hook-form + zod for forms.

**Tech Stack:** NestJS 10, Mongoose, MinIO (`MINIO_CLIENT` token), Meilisearch (`MEILISEARCH_CLIENT` token), class-validator/transformer, Next.js 14 App Router, TanStack Query v5, TanStack Table v8, react-hook-form, zod, sonner.

---

## File Structure

### New — API
- `apps/api/src/staff/schemas/staff.schema.ts` — Mongoose schema + document type
- `apps/api/src/staff/dto/create-staff.dto.ts` — class-validator create DTO
- `apps/api/src/staff/dto/update-staff.dto.ts` — PartialType of create DTO
- `apps/api/src/staff/dto/change-status.dto.ts` — status change with effectiveDate + notes
- `apps/api/src/staff/dto/staff-query.dto.ts` — page/limit/status/level/q filters
- `apps/api/src/staff/staff.service.ts` — all business logic
- `apps/api/src/staff/staff.service.spec.ts` — unit tests
- `apps/api/src/staff/staff.controller.ts` — HTTP routes
- `apps/api/src/staff/staff.module.ts` — module wiring
- `apps/api/src/search/search.controller.ts` — GET /search proxy
- `apps/api/src/search/search.module.ts` — thin module

### Modified — API
- `apps/api/src/app.module.ts` — add StaffModule + SearchModule
- `apps/api/package.json` — add jest, ts-jest, @types/jest devDeps
- `apps/api/jest.config.js` — jest config for NestJS

### New — Web
- `apps/web/src/lib/staff.ts` — typed API functions
- `apps/web/src/app/(dashboard)/staff/page.tsx` — server shell
- `apps/web/src/app/(dashboard)/staff/staff-list-client.tsx` — TanStack Table + filters
- `apps/web/src/app/(dashboard)/staff/add-staff-modal.tsx` — react-hook-form modal
- `apps/web/src/app/(dashboard)/staff/[id]/page.tsx` — server shell
- `apps/web/src/app/(dashboard)/staff/[id]/staff-detail-client.tsx` — tabs + profile edit + status change modal

---

## Task 1: API Test Infrastructure

**Files:**
- Modify: `apps/api/package.json`
- Create: `apps/api/jest.config.js`

- [ ] **Step 1: Add jest devDependencies**

Run from `apps/api/`:
```bash
npm install --save-dev jest ts-jest @types/jest
```

- [ ] **Step 2: Create jest.config.js**

```js
// apps/api/jest.config.js
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: { '^.+\\.(t|j)s$': 'ts-jest' },
  collectCoverageFrom: ['**/*.(t|j)s'],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@welfare/shared(.*)$': '<rootDir>/../../../packages/shared/src$1',
  },
};
```

- [ ] **Step 3: Update test script in apps/api/package.json**

Change:
```json
"test": "echo 'no tests yet' && exit 0"
```
To:
```json
"test": "jest",
"test:watch": "jest --watch",
"test:cov": "jest --coverage"
```

- [ ] **Step 4: Verify jest runs**

```bash
cd apps/api && npx jest --passWithNoTests
```
Expected: `Test Suites: 0 skipped` — no error.

---

## Task 2: Staff Mongoose Schema

**Files:**
- Create: `apps/api/src/staff/schemas/staff.schema.ts`

- [ ] **Step 1: Create schema file**

```typescript
// apps/api/src/staff/schemas/staff.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { StaffStatus } from '@welfare/shared';

export type StaffDocument = HydratedDocument<Staff>;

@Schema({ timestamps: true, collection: 'staff' })
export class Staff {
  @Prop({ required: true, trim: true }) fullName: string;
  @Prop({ required: true, unique: true, trim: true }) staffId: string;
  @Prop({ required: true, trim: true }) pfNo: string;
  @Prop({ required: true }) dateOfBirth: Date;
  @Prop({ required: true, trim: true }) phoneNumber: string;
  @Prop({ trim: true, sparse: true }) email?: string;
  @Prop() photoKey?: string;
  @Prop({ required: true }) dateOfEmployment: Date;
  @Prop({ required: true }) dateOfFirstContribution: Date;
  @Prop({ required: true, trim: true }) level: string;
  @Prop({ required: true, min: 0, default: 0 }) point: number;
  @Prop({ required: true, enum: StaffStatus, default: StaffStatus.Active })
  status: StaffStatus;
}

export const StaffSchema = SchemaFactory.createForClass(Staff);

StaffSchema.index({ status: 1 });
StaffSchema.index({ level: 1 });
StaffSchema.index({ fullName: 'text', staffId: 'text', pfNo: 'text' });
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/staff/schemas/staff.schema.ts apps/api/jest.config.js apps/api/package.json
git commit -m "feat(api): staff schema + jest infrastructure"
```

---

## Task 3: Staff DTOs

**Files:**
- Create: `apps/api/src/staff/dto/create-staff.dto.ts`
- Create: `apps/api/src/staff/dto/update-staff.dto.ts`
- Create: `apps/api/src/staff/dto/change-status.dto.ts`
- Create: `apps/api/src/staff/dto/staff-query.dto.ts`

- [ ] **Step 1: Create create-staff.dto.ts**

```typescript
// apps/api/src/staff/dto/create-staff.dto.ts
import {
  IsDateString, IsEmail, IsEnum, IsNotEmpty,
  IsNumber, IsOptional, IsString, Min,
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
```

- [ ] **Step 2: Create update-staff.dto.ts**

```typescript
// apps/api/src/staff/dto/update-staff.dto.ts
import { PartialType } from '@nestjs/mapped-types';
import { CreateStaffDto } from './create-staff.dto';

export class UpdateStaffDto extends PartialType(CreateStaffDto) {}
```

- [ ] **Step 3: Create change-status.dto.ts**

```typescript
// apps/api/src/staff/dto/change-status.dto.ts
import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';
import { StaffStatus } from '@welfare/shared';

export class ChangeStatusDto {
  @IsEnum(StaffStatus) status: StaffStatus;
  @IsDateString() effectiveDate: string;
  @IsString() @IsOptional() notes?: string;
}
```

- [ ] **Step 4: Create staff-query.dto.ts**

```typescript
// apps/api/src/staff/dto/staff-query.dto.ts
import { IsEnum, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { StaffStatus } from '@welfare/shared';

export class StaffQueryDto {
  @IsOptional() @IsEnum(StaffStatus) status?: StaffStatus;
  @IsOptional() @IsString() level?: string;
  @IsOptional() @IsString() q?: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(1) limit?: number = 20;
}
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/staff/dto/
git commit -m "feat(api): staff DTOs with class-validator"
```

---

## Task 4: StaffService — Create + Read + Tests

**Files:**
- Create: `apps/api/src/staff/staff.service.ts`
- Create: `apps/api/src/staff/staff.service.spec.ts`

- [ ] **Step 1: Write failing tests for create and findAll**

```typescript
// apps/api/src/staff/staff.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { StaffService } from './staff.service';
import { Staff } from './schemas/staff.schema';
import { AuditService } from '../audit/audit.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { StaffStatus } from '@welfare/shared';

const mockStaff = {
  _id: 'staff-id-1',
  fullName: 'Aminu Tijani',
  staffId: 'STF001',
  pfNo: 'PF001',
  dateOfBirth: new Date('1990-01-01'),
  phoneNumber: '08012345678',
  dateOfEmployment: new Date('2020-01-01'),
  dateOfFirstContribution: new Date('2020-02-01'),
  level: 'GL 10',
  point: 0,
  status: StaffStatus.Active,
  save: jest.fn(),
  toObject: jest.fn(() => mockStaff),
};

const mockStaffModel = {
  create: jest.fn(),
  find: jest.fn(),
  findById: jest.fn(),
  findOne: jest.fn(),
  findByIdAndUpdate: jest.fn(),
  countDocuments: jest.fn(),
};

const mockAuditService = { log: jest.fn() };
const mockConfigService = {
  getAll: jest.fn().mockResolvedValue({
    ELIGIBILITY_MONTHS: { value: '6' },
  }),
};
const mockMeilisearchClient = {
  index: jest.fn(() => ({ addDocuments: jest.fn() })),
};
const mockMinioClient = { presignedGetObject: jest.fn(), putObject: jest.fn() };

describe('StaffService', () => {
  let service: StaffService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StaffService,
        { provide: getModelToken(Staff.name), useValue: mockStaffModel },
        { provide: AuditService, useValue: mockAuditService },
        { provide: SystemConfigService, useValue: mockConfigService },
        { provide: 'MEILISEARCH_CLIENT', useValue: mockMeilisearchClient },
        { provide: 'MINIO_CLIENT', useValue: mockMinioClient },
      ],
    }).compile();
    service = module.get<StaffService>(StaffService);
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('throws ConflictException when staffId already exists', async () => {
      const error = Object.assign(new Error('dup'), { code: 11000 });
      mockStaffModel.create.mockRejectedValue(error);
      await expect(
        service.create(
          { fullName: 'Test', staffId: 'STF001', pfNo: 'PF001', dateOfBirth: '1990-01-01',
            phoneNumber: '08012345678', dateOfEmployment: '2020-01-01',
            dateOfFirstContribution: '2020-02-01', level: 'GL 10', point: 0 },
          'actor-id', 'Actor Name',
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('creates staff and returns document', async () => {
      mockStaffModel.create.mockResolvedValue(mockStaff);
      const result = await service.create(
        { fullName: 'Aminu Tijani', staffId: 'STF001', pfNo: 'PF001',
          dateOfBirth: '1990-01-01', phoneNumber: '08012345678',
          dateOfEmployment: '2020-01-01', dateOfFirstContribution: '2020-02-01',
          level: 'GL 10', point: 0 },
        'actor-id', 'Actor Name',
      );
      expect(result).toBeDefined();
      expect(mockAuditService.log).toHaveBeenCalled();
    });
  });

  describe('findById', () => {
    it('throws NotFoundException when staff not found', async () => {
      mockStaffModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
      await expect(service.findById('nonexistent-id')).rejects.toThrow(NotFoundException);
    });

    it('returns staff when found', async () => {
      mockStaffModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(mockStaff) });
      const result = await service.findById('staff-id-1');
      expect(result).toBe(mockStaff);
    });
  });

  describe('isLoanEligible', () => {
    it('returns false when employed fewer months than threshold', async () => {
      const recentStaff = {
        ...mockStaff,
        dateOfEmployment: new Date(),
        status: StaffStatus.Active,
      };
      mockStaffModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(recentStaff) });
      const result = await service.isLoanEligible('staff-id-1');
      expect(result.eligible).toBe(false);
      expect(result.reason).toMatch(/eligibility/i);
    });

    it('returns false when status is not Active', async () => {
      const resignedStaff = { ...mockStaff, status: StaffStatus.Resigned, dateOfEmployment: new Date('2020-01-01') };
      mockStaffModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(resignedStaff) });
      const result = await service.isLoanEligible('staff-id-1');
      expect(result.eligible).toBe(false);
    });
  });

  describe('changeStatus', () => {
    it('throws BadRequestException when changing from terminal status', async () => {
      const deceasedStaff = { ...mockStaff, status: StaffStatus.Deceased, save: jest.fn() };
      mockStaffModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(deceasedStaff) });
      await expect(
        service.changeStatus('staff-id-1',
          { status: StaffStatus.Active, effectiveDate: '2025-01-01' },
          'actor-id', 'Actor'),
      ).rejects.toThrow();
    });
  });
});
```

- [ ] **Step 2: Run tests — verify they all fail**

```bash
cd apps/api && npx jest staff.service.spec.ts --no-coverage
```
Expected: multiple `Cannot find module './staff.service'` errors.

- [ ] **Step 3: Create staff.service.ts**

```typescript
// apps/api/src/staff/staff.service.ts
import {
  BadRequestException, ConflictException, Inject,
  Injectable, NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Client as MinioClient } from 'minio';
import { MeiliSearch } from 'meilisearch';
import { AuditAction, AuditEntity, StaffStatus } from '@welfare/shared';
import { Staff, StaffDocument } from './schemas/staff.schema';
import { AuditService } from '../audit/audit.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { MINIO_CLIENT } from '../storage/minio.module';
import { MEILISEARCH_CLIENT } from '../search/meilisearch.module';
import { CreateStaffDto } from './dto/create-staff.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';
import { ChangeStatusDto } from './dto/change-status.dto';
import { StaffQueryDto } from './dto/staff-query.dto';
import { PaginatedResult } from '@welfare/shared';

const TERMINAL_STATUSES: StaffStatus[] = [
  StaffStatus.Resigned,
  StaffStatus.Retired,
  StaffStatus.Dismissed,
  StaffStatus.Deceased,
];

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
const PHOTO_BUCKET = 'staff-photos';
const PHOTO_PRESIGN_TTL = 15 * 60;

@Injectable()
export class StaffService {
  constructor(
    @InjectModel(Staff.name) private readonly staffModel: Model<StaffDocument>,
    private readonly auditService: AuditService,
    private readonly configService: SystemConfigService,
    @Inject(MINIO_CLIENT) private readonly minioClient: MinioClient,
    @Inject(MEILISEARCH_CLIENT) private readonly meiliClient: MeiliSearch,
  ) {}

  async create(dto: CreateStaffDto, actorId: string, actorName: string, ip?: string): Promise<StaffDocument> {
    let staff: StaffDocument;
    try {
      staff = await this.staffModel.create({
        ...dto,
        status: dto.status ?? StaffStatus.Active,
        dateOfBirth: new Date(dto.dateOfBirth),
        dateOfEmployment: new Date(dto.dateOfEmployment),
        dateOfFirstContribution: new Date(dto.dateOfFirstContribution),
      });
    } catch (err: any) {
      if (err?.code === 11000) throw new ConflictException(`Staff ID '${dto.staffId}' already exists`);
      throw err;
    }
    this.auditService.log(actorId, actorName, AuditAction.Create, AuditEntity.Staff, staff._id.toString(), undefined, staff.toObject(), ip);
    this.syncToMeilisearch(staff);
    return staff;
  }

  async findAll(query: StaffQueryDto): Promise<PaginatedResult<StaffDocument>> {
    const { page = 1, limit = 20, status, level, q } = query;
    const filter: Record<string, unknown> = {};
    if (status) filter.status = status;
    if (level) filter.level = level;
    if (q) filter.$text = { $search: q };
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.staffModel.find(filter).sort({ fullName: 1 }).skip(skip).limit(limit).exec(),
      this.staffModel.countDocuments(filter).exec(),
    ]);
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findById(id: string): Promise<StaffDocument> {
    const staff = await this.staffModel.findById(id).exec();
    if (!staff) throw new NotFoundException(`Staff ${id} not found`);
    return staff;
  }

  async update(id: string, dto: UpdateStaffDto, actorId: string, actorName: string, ip?: string): Promise<StaffDocument> {
    const before = await this.findById(id);
    const patch: Partial<Staff> = { ...dto } as any;
    if (dto.dateOfBirth) patch.dateOfBirth = new Date(dto.dateOfBirth) as any;
    if (dto.dateOfEmployment) patch.dateOfEmployment = new Date(dto.dateOfEmployment) as any;
    if (dto.dateOfFirstContribution) patch.dateOfFirstContribution = new Date(dto.dateOfFirstContribution) as any;
    delete (patch as any).staffId;
    const after = await this.staffModel
      .findByIdAndUpdate(id, { $set: patch }, { new: true, runValidators: true })
      .exec();
    if (!after) throw new NotFoundException(`Staff ${id} not found`);
    this.auditService.log(actorId, actorName, AuditAction.Update, AuditEntity.Staff, id, before.toObject(), after.toObject(), ip);
    this.syncToMeilisearch(after);
    return after;
  }

  async changeStatus(
    id: string, dto: ChangeStatusDto, actorId: string, actorName: string, ip?: string,
  ): Promise<{ staff: StaffDocument; requiresSettlement: boolean }> {
    const staff = await this.findById(id);
    if (TERMINAL_STATUSES.includes(staff.status)) {
      throw new BadRequestException(`Cannot change status from terminal state '${staff.status}'`);
    }
    if (staff.status === dto.status) {
      throw new BadRequestException(`Staff already has status '${dto.status}'`);
    }
    const before = staff.toObject();
    staff.status = dto.status;
    await staff.save();
    this.auditService.log(actorId, actorName, AuditAction.Update, AuditEntity.Staff, id, before, staff.toObject(), ip);
    this.syncToMeilisearch(staff);
    const requiresSettlement = [StaffStatus.Resigned, StaffStatus.Dismissed].includes(dto.status);
    return { staff, requiresSettlement };
  }

  async isLoanEligible(id: string): Promise<{ eligible: boolean; reason?: string }> {
    const staff = await this.findById(id);
    if (staff.status !== StaffStatus.Active) {
      return { eligible: false, reason: 'Staff is not active' };
    }
    const config = await this.configService.getAll();
    const threshold = parseInt(config['ELIGIBILITY_MONTHS']?.value ?? '6', 10);
    const employedMs = Date.now() - new Date(staff.dateOfEmployment).getTime();
    const employedMonths = employedMs / (1000 * 60 * 60 * 24 * 30.44);
    if (employedMonths < threshold) {
      return { eligible: false, reason: `Eligibility requires ${threshold} months of employment` };
    }
    // Phase 5 will add: check no active loan
    return { eligible: true };
  }

  async uploadPhoto(id: string, buffer: Buffer, mimetype: string): Promise<StaffDocument> {
    if (!ALLOWED_IMAGE_TYPES.includes(mimetype)) {
      throw new BadRequestException('Only JPEG, PNG, and WebP images are allowed');
    }
    if (buffer.length > MAX_PHOTO_BYTES) {
      throw new BadRequestException('Photo must be 2 MB or smaller');
    }
    const staff = await this.findById(id);
    const ext = mimetype.split('/')[1].replace('jpeg', 'jpg');
    const key = `${staff.staffId}/photo.${ext}`;
    await this.minioClient.putObject(PHOTO_BUCKET, key, buffer, buffer.length, { 'Content-Type': mimetype });
    return this.update(id, { photoKey: key } as UpdateStaffDto, 'system', 'system');
  }

  async getPhotoUrl(id: string): Promise<string> {
    const staff = await this.findById(id);
    if (!staff.photoKey) throw new NotFoundException('Staff has no photo');
    return this.minioClient.presignedGetObject(PHOTO_BUCKET, staff.photoKey, PHOTO_PRESIGN_TTL);
  }

  private syncToMeilisearch(staff: StaffDocument): void {
    const doc = {
      id: staff._id.toString(),
      fullName: staff.fullName,
      staffId: staff.staffId,
      pfNo: staff.pfNo,
      phoneNumber: staff.phoneNumber,
      level: staff.level,
      status: staff.status,
    };
    this.meiliClient
      .index('staff')
      .addDocuments([doc])
      .catch(() => { /* fire-and-forget */ });
  }
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd apps/api && npx jest staff.service.spec.ts --no-coverage
```
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/staff/staff.service.ts apps/api/src/staff/staff.service.spec.ts
git commit -m "feat(api): StaffService with CRUD, photo upload, eligibility helper"
```

---

## Task 5: StaffController + StaffModule + AppModule

**Files:**
- Create: `apps/api/src/staff/staff.controller.ts`
- Create: `apps/api/src/staff/staff.module.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Create staff.controller.ts**

```typescript
// apps/api/src/staff/staff.controller.ts
import {
  Body, Controller, Get, Param, Patch, Post,
  Req, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';
import { StaffService } from './staff.service';
import { CreateStaffDto } from './dto/create-staff.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';
import { ChangeStatusDto } from './dto/change-status.dto';
import { StaffQueryDto } from './dto/staff-query.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('staff')
export class StaffController {
  constructor(private readonly staffService: StaffService) {}

  @Post()
  create(@Body() dto: CreateStaffDto, @CurrentUser() user: any, @Req() req: Request) {
    return this.staffService.create(dto, user.sub, user.displayName, req.ip);
  }

  @Get()
  findAll(@Body() query: StaffQueryDto) {
    return this.staffService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.staffService.findById(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateStaffDto, @CurrentUser() user: any, @Req() req: Request) {
    return this.staffService.update(id, dto, user.sub, user.displayName, req.ip);
  }

  @Patch(':id/status')
  changeStatus(@Param('id') id: string, @Body() dto: ChangeStatusDto, @CurrentUser() user: any, @Req() req: Request) {
    return this.staffService.changeStatus(id, dto, user.sub, user.displayName, req.ip);
  }

  @Post(':id/photo')
  @UseInterceptors(FileInterceptor('photo'))
  uploadPhoto(@Param('id') id: string, @UploadedFile() file: Express.Multer.File) {
    return this.staffService.uploadPhoto(id, file.buffer, file.mimetype);
  }

  @Get(':id/photo')
  getPhoto(@Param('id') id: string) {
    return this.staffService.getPhotoUrl(id);
  }
}
```

**Note:** `GET /staff` uses `@Body()` for query params here as a placeholder — correct approach uses `@Query()`. Fix:

Replace `@Body() query: StaffQueryDto` with `@Query() query: StaffQueryDto` in the `findAll` method.

Corrected `findAll`:
```typescript
  @Get()
  findAll(@Query() query: StaffQueryDto) {
    return this.staffService.findAll(query);
  }
```

Add `Query` to the import from `@nestjs/common`.

- [ ] **Step 2: Create staff.module.ts**

```typescript
// apps/api/src/staff/staff.module.ts
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MulterModule } from '@nestjs/platform-express';
import { StaffController } from './staff.controller';
import { StaffService } from './staff.service';
import { Staff, StaffSchema } from './schemas/staff.schema';
import { SystemConfigModule } from '../system-config/system-config.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Staff.name, schema: StaffSchema }]),
    MulterModule.register({ storage: undefined }),
    SystemConfigModule,
  ],
  controllers: [StaffController],
  providers: [StaffService],
  exports: [StaffService],
})
export class StaffModule {}
```

- [ ] **Step 3: Add @nestjs/platform-express multer types**

Multer types are included in `@nestjs/platform-express`. Verify:
```bash
cd apps/api && node -e "require('@nestjs/platform-express')" && echo "ok"
```
Expected: `ok`. If missing: `npm install @nestjs/platform-express`.

- [ ] **Step 4: Add StaffModule to app.module.ts**

Open `apps/api/src/app.module.ts`. Add to the imports array (after `SystemConfigModule`):
```typescript
import { StaffModule } from './staff/staff.module';
// ...
StaffModule,
```

- [ ] **Step 5: Build to verify no TypeScript errors**

```bash
cd apps/api && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/staff/ apps/api/src/app.module.ts
git commit -m "feat(api): StaffController, StaffModule, registered in AppModule"
```

---

## Task 6: Search Endpoint (Meilisearch Proxy)

**Files:**
- Create: `apps/api/src/search/search.controller.ts`
- Create: `apps/api/src/search/search.module.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Create search.controller.ts**

```typescript
// apps/api/src/search/search.controller.ts
import { Controller, Get, Inject, Query } from '@nestjs/common';
import { MeiliSearch } from 'meilisearch';
import { MEILISEARCH_CLIENT } from './meilisearch.module';

@Controller('search')
export class SearchController {
  constructor(
    @Inject(MEILISEARCH_CLIENT) private readonly meili: MeiliSearch,
  ) {}

  @Get()
  async search(
    @Query('q') q: string = '',
    @Query('type') type: string = 'staff',
    @Query('status') status?: string,
    @Query('level') level?: string,
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '20',
  ) {
    const index = this.meili.index(type);
    const filter: string[] = [];
    if (status) filter.push(`status = "${status}"`);
    if (level) filter.push(`level = "${level}"`);
    const result = await index.search(q, {
      filter: filter.length ? filter.join(' AND ') : undefined,
      limit: parseInt(limit, 10),
      offset: (parseInt(page, 10) - 1) * parseInt(limit, 10),
    });
    return {
      data: result.hits,
      total: result.estimatedTotalHits ?? 0,
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
    };
  }
}
```

- [ ] **Step 2: Create search.module.ts**

```typescript
// apps/api/src/search/search.module.ts
import { Module } from '@nestjs/common';
import { SearchController } from './search.controller';

@Module({
  controllers: [SearchController],
})
export class SearchModule {}
```

**Note:** `MEILISEARCH_CLIENT` is from the existing `apps/api/src/search/meilisearch.module.ts` (which is `@Global()`). The SearchModule imports from the same file.

- [ ] **Step 3: Add Meilisearch index settings on StaffService init**

In `apps/api/src/staff/staff.service.ts`, add `OnModuleInit` setup:

```typescript
// Add to imports at top:
import { Injectable, OnModuleInit, ... } from '@nestjs/common';

// Add to class after constructor:
  async onModuleInit() {
    const index = this.meiliClient.index('staff');
    await index.updateSettings({
      searchableAttributes: ['fullName', 'staffId', 'pfNo', 'phoneNumber'],
      filterableAttributes: ['level', 'status'],
      sortableAttributes: ['fullName'],
    }).catch(() => { /* non-fatal if Meilisearch not running */ });
  }
```

- [ ] **Step 4: Register SearchModule in app.module.ts**

Add `SearchModule` to imports in `apps/api/src/app.module.ts`:
```typescript
import { SearchModule } from './search/search.module';
// ...
SearchModule,
```

- [ ] **Step 5: Build**

```bash
cd apps/api && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/search/search.controller.ts apps/api/src/search/search.module.ts apps/api/src/staff/staff.service.ts apps/api/src/app.module.ts
git commit -m "feat(api): search endpoint + Meilisearch staff index settings"
```

---

## Task 7: Web — lib/staff.ts

**Files:**
- Create: `apps/web/src/lib/staff.ts`

- [ ] **Step 1: Create lib/staff.ts**

```typescript
// apps/web/src/lib/staff.ts
import apiClient from './api-client';
import type { IStaff, PaginatedResult, StaffStatus } from '@welfare/shared';

export interface StaffFilters {
  page?: number;
  limit?: number;
  status?: StaffStatus;
  level?: string;
}

export interface CreateStaffPayload {
  fullName: string;
  staffId: string;
  pfNo: string;
  dateOfBirth: string;
  phoneNumber: string;
  email?: string;
  dateOfEmployment: string;
  dateOfFirstContribution: string;
  level: string;
  point: number;
}

export interface ChangeStatusPayload {
  status: StaffStatus;
  effectiveDate: string;
  notes?: string;
}

export interface ChangeStatusResult {
  staff: IStaff;
  requiresSettlement: boolean;
}

export async function listStaff(filters: StaffFilters = {}): Promise<PaginatedResult<IStaff>> {
  const { data } = await apiClient.get('/staff', { params: filters });
  return data;
}

export async function searchStaff(
  q: string,
  filters: Omit<StaffFilters, 'page' | 'limit'> & { page?: number; limit?: number } = {},
): Promise<PaginatedResult<IStaff>> {
  const { data } = await apiClient.get('/search', { params: { q, type: 'staff', ...filters } });
  return data;
}

export async function getStaff(id: string): Promise<IStaff> {
  const { data } = await apiClient.get(`/staff/${id}`);
  return data;
}

export async function createStaff(payload: CreateStaffPayload): Promise<IStaff> {
  const { data } = await apiClient.post('/staff', payload);
  return data;
}

export async function updateStaff(id: string, payload: Partial<CreateStaffPayload>): Promise<IStaff> {
  const { data } = await apiClient.patch(`/staff/${id}`, payload);
  return data;
}

export async function changeStaffStatus(id: string, payload: ChangeStatusPayload): Promise<ChangeStatusResult> {
  const { data } = await apiClient.patch(`/staff/${id}/status`, payload);
  return data;
}

export async function uploadStaffPhoto(id: string, file: File): Promise<IStaff> {
  const form = new FormData();
  form.append('photo', file);
  const { data } = await apiClient.post(`/staff/${id}/photo`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
}

export async function getStaffPhotoUrl(id: string): Promise<string> {
  const { data } = await apiClient.get(`/staff/${id}/photo`);
  return data;
}

export async function getLoanEligibility(id: string): Promise<{ eligible: boolean; reason?: string }> {
  const { data } = await apiClient.get(`/staff/${id}/eligibility`);
  return data;
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/lib/staff.ts
git commit -m "feat(web): staff API client lib"
```

---

## Task 8: Staff List Page

**Files:**
- Create: `apps/web/src/app/(dashboard)/staff/page.tsx`
- Create: `apps/web/src/app/(dashboard)/staff/staff-list-client.tsx`

- [ ] **Step 1: Create page.tsx (server shell)**

```tsx
// apps/web/src/app/(dashboard)/staff/page.tsx
import { Suspense } from 'react';
import StaffListClient from './staff-list-client';

export const metadata = { title: 'Staff Registry' };

export default function StaffPage() {
  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">Staff Registry</h1>
      </div>
      <Suspense fallback={<div className="text-sm text-gray-500">Loading staff...</div>}>
        <StaffListClient />
      </Suspense>
    </div>
  );
}
```

- [ ] **Step 2: Create staff-list-client.tsx**

```tsx
// apps/web/src/app/(dashboard)/staff/staff-list-client.tsx
'use client';

import { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import type { IStaff } from '@welfare/shared';
import { StaffStatus } from '@welfare/shared';
import { listStaff, searchStaff } from '@/lib/staff';
import AddStaffModal from './add-staff-modal';

const STATUS_BADGE: Record<StaffStatus, string> = {
  [StaffStatus.Active]:   'bg-green-100 text-green-800',
  [StaffStatus.Resigned]: 'bg-gray-100 text-gray-600',
  [StaffStatus.Retired]:  'bg-blue-100 text-blue-700',
  [StaffStatus.Dismissed]:'bg-red-100 text-red-700',
  [StaffStatus.Deceased]: 'bg-black text-white',
};

const col = createColumnHelper<IStaff>();

const columns = [
  col.accessor('photoKey', {
    header: 'Photo',
    cell: () => (
      <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-xs text-gray-500">
        ?
      </div>
    ),
  }),
  col.accessor('fullName', { header: 'Full Name' }),
  col.accessor('staffId', { header: 'Staff ID' }),
  col.accessor('level', { header: 'Level' }),
  col.accessor('status', {
    header: 'Status',
    cell: (info) => (
      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[info.getValue()]}`}>
        {info.getValue()}
      </span>
    ),
  }),
  col.accessor('dateOfEmployment', {
    header: 'Employed',
    cell: (info) => new Date(info.getValue()).toLocaleDateString('en-GB'),
  }),
  col.display({
    id: 'actions',
    header: 'Actions',
    cell: () => null,
  }),
];

export default function StaffListClient() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<StaffStatus | ''>('');
  const [level, setLevel] = useState('');
  const [q, setQ] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);

  const limit = 20;

  const { data, isLoading, error } = useQuery({
    queryKey: ['staff', { page, status, level, q }],
    queryFn: () =>
      q
        ? searchStaff(q, { page, limit, status: status || undefined, level: level || undefined })
        : listStaff({ page, limit, status: status || undefined, level: level || undefined }),
  });

  const handleSearch = useCallback(() => {
    setQ(searchInput);
    setPage(1);
  }, [searchInput]);

  const table = useReactTable({
    data: data?.data ?? [],
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    pageCount: data ? Math.ceil(data.total / limit) : 0,
    state: { pagination: { pageIndex: page - 1, pageSize: limit } },
    onPaginationChange: (updater) => {
      if (typeof updater === 'function') {
        const next = updater({ pageIndex: page - 1, pageSize: limit });
        setPage(next.pageIndex + 1);
      }
    },
  });

  if (error) {
    toast.error('Failed to load staff');
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <select
          value={status}
          onChange={(e) => { setStatus(e.target.value as StaffStatus | ''); setPage(1); }}
          className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All Statuses</option>
          {Object.values(StaffStatus).map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <input
          placeholder="Level (e.g. GL 10)"
          value={level}
          onChange={(e) => { setLevel(e.target.value); setPage(1); }}
          className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <div className="flex">
          <input
            placeholder="Search name, staff ID, PF No..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            className="border border-gray-300 rounded-l-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-64"
          />
          <button
            onClick={handleSearch}
            className="border border-l-0 border-gray-300 rounded-r-md px-3 py-1.5 text-sm bg-gray-50 hover:bg-gray-100"
          >
            Search
          </button>
        </div>
        <div className="ml-auto">
          <button
            onClick={() => setShowAddModal(true)}
            className="px-4 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700"
          >
            + Add Staff
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => (
                  <th
                    key={h.id}
                    className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                  >
                    {flexRender(h.column.columnDef.header, h.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody className="bg-white divide-y divide-gray-100">
            {isLoading ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-8 text-center text-sm text-gray-500">
                  Loading...
                </td>
              </tr>
            ) : table.getRowModel().rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-8 text-center text-sm text-gray-400">
                  No staff found.
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  className="hover:bg-gray-50 cursor-pointer"
                  onClick={() => router.push(`/staff/${row.original._id}`)}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-4 py-3 text-sm text-gray-700">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-gray-600">
          <span>
            Showing {(page - 1) * limit + 1}–{Math.min(page * limit, data.total)} of {data.total}
          </span>
          <div className="flex gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="px-3 py-1 border rounded-md disabled:opacity-40 hover:bg-gray-50"
            >
              Previous
            </button>
            <button
              disabled={page >= data.totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="px-3 py-1 border rounded-md disabled:opacity-40 hover:bg-gray-50"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {showAddModal && (
        <AddStaffModal
          onClose={() => setShowAddModal(false)}
          onSuccess={() => setShowAddModal(false)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/\(dashboard\)/staff/
git commit -m "feat(web): staff list page with TanStack Table, filters, pagination"
```

---

## Task 9: Add Staff Modal

**Files:**
- Create: `apps/web/src/app/(dashboard)/staff/add-staff-modal.tsx`

- [ ] **Step 1: Create add-staff-modal.tsx**

```tsx
// apps/web/src/app/(dashboard)/staff/add-staff-modal.tsx
'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { createStaff } from '@/lib/staff';

const schema = z.object({
  fullName:                z.string().min(1, 'Required'),
  staffId:                 z.string().min(1, 'Required'),
  pfNo:                    z.string().min(1, 'Required'),
  dateOfBirth:             z.string().min(1, 'Required'),
  phoneNumber:             z.string().min(1, 'Required'),
  email:                   z.string().email().optional().or(z.literal('')),
  dateOfEmployment:        z.string().min(1, 'Required'),
  dateOfFirstContribution: z.string().min(1, 'Required'),
  level:                   z.string().min(1, 'Required'),
  point:                   z.coerce.number().min(0).default(0),
});

type FormValues = z.infer<typeof schema>;

interface Props {
  onClose: () => void;
  onSuccess: () => void;
}

const Field = ({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) => (
  <div className="space-y-1">
    <label className="text-sm font-medium text-gray-700">{label}</label>
    {children}
    {error && <p className="text-xs text-red-600">{error}</p>}
  </div>
);

export default function AddStaffModal({ onClose, onSuccess }: Props) {
  const qc = useQueryClient();
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
  });

  async function onSubmit(values: FormValues) {
    try {
      await createStaff({ ...values, email: values.email || undefined });
      await qc.invalidateQueries({ queryKey: ['staff'] });
      toast.success('Staff member added');
      onSuccess();
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'Failed to add staff');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Add Staff Member</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>
        <form onSubmit={handleSubmit(onSubmit)} className="px-6 py-4 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Full Name *" error={errors.fullName?.message}>
              <input {...register('fullName')} className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </Field>
            <Field label="Staff ID *" error={errors.staffId?.message}>
              <input {...register('staffId')} className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </Field>
            <Field label="PF Number *" error={errors.pfNo?.message}>
              <input {...register('pfNo')} className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </Field>
            <Field label="Phone Number *" error={errors.phoneNumber?.message}>
              <input {...register('phoneNumber')} className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </Field>
            <Field label="Email" error={errors.email?.message}>
              <input {...register('email')} type="email" className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </Field>
            <Field label="Level *" error={errors.level?.message}>
              <input {...register('level')} placeholder="e.g. GL 10" className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </Field>
            <Field label="Date of Birth *" error={errors.dateOfBirth?.message}>
              <input {...register('dateOfBirth')} type="date" className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </Field>
            <Field label="Date of Employment *" error={errors.dateOfEmployment?.message}>
              <input {...register('dateOfEmployment')} type="date" className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </Field>
            <Field label="Date of First Contribution *" error={errors.dateOfFirstContribution?.message}>
              <input {...register('dateOfFirstContribution')} type="date" className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </Field>
            <Field label="Points" error={errors.point?.message}>
              <input {...register('point')} type="number" min="0" defaultValue={0} className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </Field>
          </div>
          <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50">
              Cancel
            </button>
            <button type="submit" disabled={isSubmitting} className="px-4 py-2 text-sm text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-60">
              {isSubmitting ? 'Saving...' : 'Add Staff'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Install zod resolver if not already present**

```bash
cd apps/web && node -e "require('@hookform/resolvers/zod')" 2>/dev/null || npm install @hookform/resolvers
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/\(dashboard\)/staff/add-staff-modal.tsx
git commit -m "feat(web): add staff modal with react-hook-form + zod validation"
```

---

## Task 10: Staff Detail Page

**Files:**
- Create: `apps/web/src/app/(dashboard)/staff/[id]/page.tsx`
- Create: `apps/web/src/app/(dashboard)/staff/[id]/staff-detail-client.tsx`

- [ ] **Step 1: Create [id]/page.tsx**

```tsx
// apps/web/src/app/(dashboard)/staff/[id]/page.tsx
import { Suspense } from 'react';
import StaffDetailClient from './staff-detail-client';

export default function StaffDetailPage({ params }: { params: { id: string } }) {
  return (
    <div className="p-6">
      <Suspense fallback={<div className="text-sm text-gray-500">Loading staff profile...</div>}>
        <StaffDetailClient id={params.id} />
      </Suspense>
    </div>
  );
}
```

- [ ] **Step 2: Create staff-detail-client.tsx**

```tsx
// apps/web/src/app/(dashboard)/staff/[id]/staff-detail-client.tsx
'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { StaffStatus } from '@welfare/shared';
import type { IStaff } from '@welfare/shared';
import { getStaff, updateStaff, changeStaffStatus, uploadStaffPhoto } from '@/lib/staff';

const STATUS_BADGE: Record<StaffStatus, string> = {
  [StaffStatus.Active]:    'bg-green-100 text-green-800',
  [StaffStatus.Resigned]:  'bg-gray-100 text-gray-600',
  [StaffStatus.Retired]:   'bg-blue-100 text-blue-700',
  [StaffStatus.Dismissed]: 'bg-red-100 text-red-700',
  [StaffStatus.Deceased]:  'bg-black text-white',
};

const TABS = ['Profile', 'Contributions', 'Loans', 'Guaranteeing'] as const;
type Tab = typeof TABS[number];

const profileSchema = z.object({
  fullName:                z.string().min(1),
  pfNo:                    z.string().min(1),
  phoneNumber:             z.string().min(1),
  email:                   z.string().email().optional().or(z.literal('')),
  dateOfBirth:             z.string().min(1),
  dateOfEmployment:        z.string().min(1),
  dateOfFirstContribution: z.string().min(1),
  level:                   z.string().min(1),
  point:                   z.coerce.number().min(0),
});
type ProfileForm = z.infer<typeof profileSchema>;

const statusSchema = z.object({
  status:        z.nativeEnum(StaffStatus),
  effectiveDate: z.string().min(1),
  notes:         z.string().optional(),
});
type StatusForm = z.infer<typeof statusSchema>;

const TERMINAL_STATUSES: StaffStatus[] = [
  StaffStatus.Resigned, StaffStatus.Retired, StaffStatus.Dismissed, StaffStatus.Deceased,
];

function toDateInput(d: string) { return d.substring(0, 10); }

export default function StaffDetailClient({ id }: { id: string }) {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<Tab>('Profile');
  const [editing, setEditing] = useState(false);
  const [showStatusModal, setShowStatusModal] = useState(false);

  const { data: staff, isLoading } = useQuery({
    queryKey: ['staff', id],
    queryFn: () => getStaff(id),
  });

  const profileForm = useForm<ProfileForm>({ resolver: zodResolver(profileSchema) });
  const statusForm = useForm<StatusForm>({ resolver: zodResolver(statusSchema) });

  const updateMutation = useMutation({
    mutationFn: (values: ProfileForm) => updateStaff(id, { ...values, email: values.email || undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['staff', id] });
      setEditing(false);
      toast.success('Profile updated');
    },
    onError: (err: any) => toast.error(err?.response?.data?.message ?? 'Update failed'),
  });

  const statusMutation = useMutation({
    mutationFn: (values: StatusForm) => changeStaffStatus(id, values),
    onSuccess: ({ requiresSettlement }) => {
      qc.invalidateQueries({ queryKey: ['staff', id] });
      setShowStatusModal(false);
      if (requiresSettlement) {
        toast.warning('Status updated. Outstanding loans require exit settlement (Phase 5).');
      } else {
        toast.success('Status updated');
      }
    },
    onError: (err: any) => toast.error(err?.response?.data?.message ?? 'Status change failed'),
  });

  const photoMutation = useMutation({
    mutationFn: (file: File) => uploadStaffPhoto(id, file),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['staff', id] }); toast.success('Photo updated'); },
    onError: (err: any) => toast.error(err?.response?.data?.message ?? 'Photo upload failed'),
  });

  function startEdit(staff: IStaff) {
    profileForm.reset({
      fullName: staff.fullName,
      pfNo: staff.pfNo,
      phoneNumber: staff.phoneNumber,
      email: staff.email ?? '',
      dateOfBirth: toDateInput(staff.dateOfBirth),
      dateOfEmployment: toDateInput(staff.dateOfEmployment),
      dateOfFirstContribution: toDateInput(staff.dateOfFirstContribution),
      level: staff.level,
      point: staff.point,
    });
    setEditing(true);
  }

  if (isLoading) return <div className="text-sm text-gray-500">Loading...</div>;
  if (!staff) return <div className="text-sm text-red-500">Staff not found.</div>;

  const isTerminal = TERMINAL_STATUSES.includes(staff.status);

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-start gap-6">
        <div className="relative group">
          <div className="w-20 h-20 rounded-full bg-gray-200 flex items-center justify-center text-2xl text-gray-400 overflow-hidden">
            {staff.photoKey ? (
              <img src={`/api/staff/${id}/photo-proxy`} alt="" className="w-full h-full object-cover" />
            ) : (
              <span>{staff.fullName.charAt(0)}</span>
            )}
          </div>
          <label className="absolute inset-0 rounded-full flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 cursor-pointer text-white text-xs">
            Upload
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && photoMutation.mutate(e.target.files[0])}
            />
          </label>
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold text-gray-900">{staff.fullName}</h1>
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[staff.status]}`}>
              {staff.status}
            </span>
            {!staff.email && (
              <span className="px-2 py-0.5 rounded-full text-xs bg-yellow-100 text-yellow-800">
                Email missing
              </span>
            )}
          </div>
          <p className="text-sm text-gray-500 mt-1">
            {staff.staffId} &middot; PF: {staff.pfNo} &middot; {staff.level}
          </p>
          <div className="flex gap-2 mt-3">
            {!isTerminal && (
              <button
                onClick={() => setShowStatusModal(true)}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Change Status
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex gap-6">
          {TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab}
            </button>
          ))}
        </nav>
      </div>

      {/* Profile Tab */}
      {activeTab === 'Profile' && (
        <div>
          {!editing ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                {[
                  ['Full Name', staff.fullName],
                  ['Staff ID', staff.staffId],
                  ['PF Number', staff.pfNo],
                  ['Phone', staff.phoneNumber],
                  ['Email', staff.email || '—'],
                  ['Level', staff.level],
                  ['Points', String(staff.point)],
                  ['Date of Birth', new Date(staff.dateOfBirth).toLocaleDateString('en-GB')],
                  ['Date of Employment', new Date(staff.dateOfEmployment).toLocaleDateString('en-GB')],
                  ['First Contribution', new Date(staff.dateOfFirstContribution).toLocaleDateString('en-GB')],
                ].map(([label, value]) => (
                  <div key={label}>
                    <p className="text-gray-500">{label}</p>
                    <p className="font-medium text-gray-900">{value}</p>
                  </div>
                ))}
              </div>
              <button
                onClick={() => startEdit(staff)}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700"
              >
                Edit Profile
              </button>
            </div>
          ) : (
            <form onSubmit={profileForm.handleSubmit((v) => updateMutation.mutate(v))} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                {([
                  ['fullName', 'Full Name', 'text'],
                  ['pfNo', 'PF Number', 'text'],
                  ['phoneNumber', 'Phone Number', 'text'],
                  ['email', 'Email', 'email'],
                  ['level', 'Level', 'text'],
                  ['point', 'Points', 'number'],
                  ['dateOfBirth', 'Date of Birth', 'date'],
                  ['dateOfEmployment', 'Date of Employment', 'date'],
                  ['dateOfFirstContribution', 'Date of First Contribution', 'date'],
                ] as [keyof ProfileForm, string, string][]).map(([field, label, type]) => (
                  <div key={field} className="space-y-1">
                    <label className="text-xs font-medium text-gray-600">{label}</label>
                    <input
                      {...profileForm.register(field)}
                      type={type}
                      className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    {profileForm.formState.errors[field] && (
                      <p className="text-xs text-red-600">{profileForm.formState.errors[field]?.message}</p>
                    )}
                  </div>
                ))}
              </div>
              <div className="flex gap-3">
                <button type="submit" disabled={updateMutation.isPending} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-60">
                  {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
                </button>
                <button type="button" onClick={() => setEditing(false)} className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50">
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {activeTab === 'Contributions' && (
        <div className="text-sm text-gray-400">Contributions ledger — Phase 4.</div>
      )}
      {activeTab === 'Loans' && (
        <div className="text-sm text-gray-400">Loan history — Phase 5.</div>
      )}
      {activeTab === 'Guaranteeing' && (
        <div className="text-sm text-gray-400">Co-signed loans — Phase 5.</div>
      )}

      {/* Status Change Modal */}
      {showStatusModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">Change Status</h2>
              <button onClick={() => setShowStatusModal(false)} className="text-gray-400 hover:text-gray-600">&times;</button>
            </div>
            <form
              onSubmit={statusForm.handleSubmit((v) => statusMutation.mutate(v))}
              className="px-6 py-4 space-y-4"
            >
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700">New Status *</label>
                <select
                  {...statusForm.register('status')}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select status...</option>
                  {TERMINAL_STATUSES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
                {statusForm.formState.errors.status && (
                  <p className="text-xs text-red-600">{statusForm.formState.errors.status.message}</p>
                )}
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700">Effective Date *</label>
                <input
                  {...statusForm.register('effectiveDate')}
                  type="date"
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700">Notes</label>
                <textarea
                  {...statusForm.register('notes')}
                  rows={3}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowStatusModal(false)} className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50">
                  Cancel
                </button>
                <button type="submit" disabled={statusMutation.isPending} className="px-4 py-2 text-sm bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-60">
                  {statusMutation.isPending ? 'Updating...' : 'Confirm Change'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/\(dashboard\)/staff/
git commit -m "feat(web): staff detail page with profile tab, status change modal"
```

---

## Task 11: Wire photo serving + sidebar link

**Files:**
- Modify: `apps/web/src/app/(dashboard)/staff/[id]/staff-detail-client.tsx` — photo proxy
- Modify: `apps/web/src/components/nav/sidebar.tsx` — verify Staff link exists

- [ ] **Step 1: Add photo proxy route**

Create `apps/web/src/app/api/staff/[id]/photo-proxy/route.ts`:

```typescript
// apps/web/src/app/api/staff/[id]/photo-proxy/route.ts
import { NextRequest, NextResponse } from 'next/server';
import apiClient from '@/lib/api-client';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { data: url } = await apiClient.get(`/staff/${params.id}/photo`);
    return NextResponse.redirect(url);
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
```

- [ ] **Step 2: Verify Staff nav link exists in sidebar.tsx**

Open `apps/web/src/components/nav/sidebar.tsx`. Confirm it has `{ href: '/staff', label: 'Staff' }` in `navLinks`. If the label is different, update the href to match `/staff`.

- [ ] **Step 3: TypeScript check**

```bash
cd apps/web && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/api/staff/
git commit -m "feat(web): photo proxy route for staff detail page"
```

---

## Self-Review

### Spec Coverage

| Requirement | Task |
|---|---|
| POST /staff | Task 5 (controller) |
| GET /staff paginated with status/level/search filters | Task 4 (service), Task 5 (controller) |
| GET /staff/:id | Task 4 + 5 |
| PATCH /staff/:id | Task 4 + 5 |
| PATCH /staff/:id/status with terminal guard + requiresSettlement flag | Task 4 + 5 |
| isLoanEligible helper | Task 4 |
| POST /staff/:id/photo (MinIO, 2MB, image-only) | Task 4 (service) |
| GET /staff/:id/photo (presigned 15min) | Task 4 (service) |
| Meilisearch sync on create/update | Task 6 |
| GET /search?q=&type=staff | Task 6 |
| Staff list page with TanStack Table | Task 8 |
| Status badge colour coding | Task 8 |
| Filter bar + search | Task 8 |
| Pagination server-side | Task 8 |
| Add Staff modal | Task 9 |
| Staff detail page with header + photo | Task 10 |
| Profile tab with inline edit + email missing warning | Task 10 |
| Status change modal with outlet settlement notice | Task 10 |
| Contributions/Loans/Guaranteeing tab stubs | Task 10 |
| Indexes: staffId unique, status, level, text | Task 2 |

### Gaps Addressed
- Photo serving: added proxy route (Task 11) since presigned MinIO URLs are not served through Next.js directly
- Meilisearch filter attributes need to be configured before filtering works — added `onModuleInit` setup in Task 6
- `GET /staff` uses `@Query()` not `@Body()` — noted and corrected inline in Task 5
- `staffId` is immutable (not in `UpdateStaffDto` patch) — enforced in `update()` with `delete patch.staffId`

### Type Consistency Check
- `StaffDocument` returned from service, `IStaff` used in web — consistent (IStaff mirrors Staff schema fields)
- `PaginatedResult<T>` used in both service and lib/staff.ts — consistent with `packages/shared/src/dto/pagination.dto.ts`
- `MEILISEARCH_CLIENT` token string matches health controller import
- `MINIO_CLIENT` token matches existing minio.module.ts export
