import { ConfigKey } from '../enums/config-key.enum';
export interface IConfig {
    _id: string;
    key: ConfigKey;
    value: string;
    description?: string;
    updatedBy: string;
    updatedAt: string;
}
//# sourceMappingURL=config.interface.d.ts.map