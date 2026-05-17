import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { User, UserDocument } from './schemas/user.schema';

@Injectable()
export class UsersService {
  constructor(@InjectModel(User.name) private readonly userModel: Model<UserDocument>) {}

  async findByUsername(username: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ username }).exec();
  }

  async findByUsernameWithPassword(username: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ username }).select('+passwordHash').exec();
  }

  async findById(id: string): Promise<UserDocument | null> {
    return this.userModel.findById(id).exec();
  }

  async findAll(): Promise<UserDocument[]> {
    return this.userModel.find().exec();
  }

  async provisionFromLdap(ldapUser: { username: string; displayName: string; email?: string }): Promise<UserDocument> {
    const existing = await this.findByUsername(ldapUser.username);
    if (existing) {
      existing.lastLogin = new Date();
      return existing.save();
    }
    const user = new this.userModel({
      username: ldapUser.username,
      displayName: ldapUser.displayName,
      email: ldapUser.email,
      role: 'WELFARE_OFFICER',
      source: 'ldap',
      isActive: true,
    });
    return user.save();
  }

  async createLocal(dto: { username: string; displayName: string; email?: string; password: string }): Promise<UserDocument> {
    const exists = await this.findByUsername(dto.username);
    if (exists) throw new ConflictException('Username already exists');
    const passwordHash = await bcrypt.hash(dto.password, 12);
    const user = new this.userModel({
      username: dto.username,
      displayName: dto.displayName,
      email: dto.email,
      role: 'WELFARE_OFFICER',
      source: 'local',
      passwordHash,
      isActive: true,
    });
    return user.save();
  }

  async updateUser(id: string, dto: { displayName?: string; email?: string; isActive?: boolean }): Promise<UserDocument> {
    const user = await this.userModel.findByIdAndUpdate(id, { $set: dto }, { new: true }).exec();
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async validatePassword(user: UserDocument, password: string): Promise<boolean> {
    if (!user.passwordHash) return false;
    return bcrypt.compare(password, user.passwordHash);
  }

  async seedAdminIfEmpty(): Promise<void> {
    const count = await this.userModel.countDocuments().exec();
    if (count === 0) {
      await this.createLocal({
        username: 'admin',
        displayName: 'System Administrator',
        password: 'Admin@123',
      });
      console.log('Seeded default admin user: admin / Admin@123');
    }
  }
}
