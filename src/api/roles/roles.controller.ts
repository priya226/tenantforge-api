import { Controller, Get } from '@nestjs/common';

import type { RoleName } from '../../roles/role-name.js';
import { FeatureFlagFacade } from '../feature-flag.facade.js';

export interface RoleResponse {
  name: RoleName;
  description: string | null;
}

@Controller('roles')
export class RolesController {
  constructor(private readonly facade: FeatureFlagFacade) {}

  @Get()
  async findAll(): Promise<RoleResponse[]> {
    const roles = await this.facade.listRoles();
    return roles.map(({ name, description }) => ({ name, description }));
  }
}
