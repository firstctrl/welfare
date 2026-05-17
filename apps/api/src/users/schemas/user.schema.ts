import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { UserRole } from '../enums/user-role.enum';

export type UserDocument = HydratedDocument<User>;

@Schema({ timestamps: true })
export class User {
  @Prop({ required: true, unique: true, index: true })
  username!: string;

  @Prop({ required: true })
  displayName!: string;

  @Prop({ sparse: true, unique: true })
  email?: string;

  @Prop({ required: true, enum: Object.values(UserRole), default: UserRole.WelfareOfficer })
  role!: UserRole;

  @Prop({ required: true, enum: ['ldap', 'local'] })
  source!: 'ldap' | 'local';

  @Prop({ select: false })
  passwordHash?: string;

  @Prop({ default: true })
  isActive!: boolean;

  @Prop()
  lastLogin?: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);
