<<<<<<< Updated upstream
﻿import { ResourceType } from './resource.enum';
import { Role } from './role.enum';
export interface MenuItem { label: string; icon: string; route: string; resource?: ResourceType; allowedRoles?: Role[]; }
=======
import { ResourceType } from './resource.enum';
import { Role } from './role.enum';

export interface MenuItem {
  label: string;
  icon: string;
  route: string;
  resource?: ResourceType;
  allowedRoles?: Role[];
  children?: MenuItem[];
}
>>>>>>> Stashed changes
