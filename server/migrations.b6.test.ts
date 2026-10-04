import { beforeEach, describe, expect, it, vi } from 'vitest';

const state=vi.hoisted(()=>({existing:false,statements:[] as string[]}));
vi.mock('./auth',()=>({pool:{getConnection:async()=>({query:async(sql:string)=>{state.statements.push(sql);return [/information_schema\./i.test(sql)&&state.existing?[{found:1}]:[]];},release:()=>{}})}}));
import { ensureSchema } from './migrations';

describe('B6 additive migration orchestration (simulated SQL connection)',()=>{
  beforeEach(()=>{state.statements=[];state.existing=false;});
  it('orders fresh B1/B3/B5 tables before B6 organization tables and building columns',async()=>{
    await ensureSchema();
    const text=state.statements.join('\n');
    expect(text.indexOf('CREATE TABLE IF NOT EXISTS basira_buildings')).toBeLessThan(text.indexOf('CREATE TABLE IF NOT EXISTS basira_organizations'));
    expect(text.indexOf('CREATE TABLE IF NOT EXISTS basira_map_versions')).toBeLessThan(text.indexOf('CREATE TABLE IF NOT EXISTS basira_official_map_imports'));
    expect(text).toContain('ALTER TABLE basira_buildings ADD COLUMN organization_id');
    expect(text).toContain('CREATE INDEX building_organization_idx');
  });
  it('keeps existing B1 building columns on startup while running idempotent B6 table DDL',async()=>{
    state.existing=true;await ensureSchema();
    expect(state.statements.some(sql=>sql.includes('CREATE TABLE IF NOT EXISTS basira_organizations'))).toBe(true);
    expect(state.statements.some(sql=>sql.includes('ALTER TABLE basira_buildings ADD COLUMN'))).toBe(false);
    expect(state.statements.some(sql=>sql.includes('CREATE INDEX building_organization_idx'))).toBe(false);
  });
});
