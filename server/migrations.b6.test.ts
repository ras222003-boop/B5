import { beforeEach, describe, expect, it, vi } from 'vitest';

const b6Columns=['organization_id','official_map_source','official_approved_by','official_reviewed_at'];
const state=vi.hoisted(()=>({existing:false,b6Installed:false,statements:[] as string[]}));
vi.mock('./auth',()=>({pool:{getConnection:async()=>({query:async(sql:string,params:unknown[]=[])=>{
  state.statements.push(sql);
  if(!/information_schema\./i.test(sql))return [[]];
  if(sql.includes('basira_buildings')&&sql.includes('column_name=?')&&b6Columns.includes(String(params[0])))return [state.b6Installed?[{found:1}]:[]];
  if(sql.includes('building_organization_idx')||['building_organization_fk','building_official_approver_fk'].includes(String(params[1])))return [state.b6Installed?[{found:1}]:[]];
  return [state.existing?[{found:1}]:[]];
},release:()=>{}})}}));
import { ensureSchema } from './migrations';

describe('B6 additive migration orchestration (simulated SQL connection)',()=>{
  beforeEach(()=>{state.statements=[];state.existing=false;state.b6Installed=false;});
  function expectB6Order(){
    const sql=state.statements;
    const organization=sql.findIndex(statement=>statement.startsWith('CREATE TABLE IF NOT EXISTS basira_organizations'));
    const columns=b6Columns.map(column=>sql.findIndex(statement=>statement.includes(`ALTER TABLE basira_buildings ADD COLUMN ${column}`)));
    const foreignKeys=['building_organization_fk','building_official_approver_fk'].map(name=>sql.findIndex(statement=>statement.includes(`ALTER TABLE basira_buildings ADD CONSTRAINT ${name}`)));
    expect(organization).toBeGreaterThanOrEqual(0);
    for(const index of [...columns,...foreignKeys])expect(index).toBeGreaterThan(organization);
    for(const key of foreignKeys)expect(key).toBeGreaterThan(Math.max(...columns));
  }
  it('orders fresh B1/B3/B5 tables before B6 organization tables and building columns',async()=>{
    await ensureSchema();
    const text=state.statements.join('\n');
    expect(text.indexOf('CREATE TABLE IF NOT EXISTS basira_buildings')).toBeLessThan(text.indexOf('CREATE TABLE IF NOT EXISTS basira_organizations'));
    expect(text.indexOf('CREATE TABLE IF NOT EXISTS basira_map_versions')).toBeLessThan(text.indexOf('CREATE TABLE IF NOT EXISTS basira_official_map_imports'));
    expectB6Order();
    expect(text).toContain('CREATE INDEX building_organization_idx');
  });
  it('adds all B6 columns and foreign keys to an existing B1–B5 building table',async()=>{
    state.existing=true;await ensureSchema();
    expect(state.statements.some(sql=>sql.includes('CREATE TABLE IF NOT EXISTS basira_organizations'))).toBe(true);
    expectB6Order();
  });
  it('does not add already installed B6 columns or constraints again',async()=>{
    state.existing=true;state.b6Installed=true;await ensureSchema();
    expect(state.statements.some(sql=>sql.includes('ALTER TABLE basira_buildings ADD COLUMN'))).toBe(false);
    expect(state.statements.some(sql=>sql.includes('CREATE INDEX building_organization_idx'))).toBe(false);
    expect(state.statements.some(sql=>sql.includes('ALTER TABLE basira_buildings ADD CONSTRAINT'))).toBe(false);
  });
});
