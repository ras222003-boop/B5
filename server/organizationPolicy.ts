export type OrganizationRole = 'organization_admin' | 'mapper' | 'reviewer' | 'viewer';
export type OrganizationAction = 'view' | 'map' | 'review' | 'manage' | 'verify';

/** Global admin is the sole authority for organization verification and admin grants. */
export function canOrganization(role: OrganizationRole | null, globalAdmin: boolean, action: OrganizationAction): boolean {
  if (globalAdmin) return true;
  if (action === 'verify') return false;
  if (action === 'manage') return role === 'organization_admin';
  if (action === 'review') return role === 'organization_admin' || role === 'reviewer';
  if (action === 'map') return role === 'organization_admin' || role === 'mapper';
  return role !== null;
}

export function canGrantOrganizationRole(globalAdmin: boolean, role: OrganizationRole): boolean {
  return globalAdmin || role !== 'organization_admin';
}
