import { describe, expect, it } from 'vitest';
import { canGrantOrganizationRole, canOrganization } from './organizationPolicy';

describe('organization authorization',()=>{
  it('denies ordinary users all organizational actions',()=>{for(const action of ['view','map','review','manage','verify'] as const)expect(canOrganization(null,false,action)).toBe(false);});
  it('separates mapper, reviewer, admin, and verification authority',()=>{
    expect(canOrganization('mapper',false,'review')).toBe(false);
    expect(canOrganization('reviewer',false,'map')).toBe(false);
    expect(canOrganization('reviewer',false,'review')).toBe(true);
    expect(canOrganization('organization_admin',false,'manage')).toBe(true);
    expect(canOrganization('organization_admin',false,'verify')).toBe(false);
    expect(canOrganization(null,true,'verify')).toBe(true);
    expect(canGrantOrganizationRole(false,'organization_admin')).toBe(false);
  });
});
