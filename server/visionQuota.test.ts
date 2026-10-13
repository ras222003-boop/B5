import {describe,expect,it} from 'vitest';
import type {Pool} from 'mysql2/promise';
import {MysqlVisionQuotaStore,type VisionLimits} from './visionQuota';

const limits:VisionLimits={userPerMinute:1,userPerDay:2,globalPerMinute:3,globalPerDay:4,concurrent:1};

function fakeDatabase(grant?:{enabled:number;minute_limit:number|null;daily_limit:number|null}){
  const counters=new Map<string,number>(),leases=new Set<string>();
  let queue=Promise.resolve();
  const pool={
    getConnection:async()=>{
      let unlock=()=>{};
      return {
        beginTransaction:async()=>{const previous=queue;queue=new Promise<void>(resolve=>{unlock=resolve;});await previous;},
        commit:async()=>unlock(),rollback:async()=>unlock(),release:()=>{},
        execute:async(sql:string,args:unknown[]=[])=>{
          if(sql.includes('quota_mutex'))return [[{id:1}]];
          if(sql.includes('now_ms'))return [[{now_ms:1_700_000_000_000}]];
          if(sql.includes('vision_entitlements'))return [[...(grant?[grant]:[])]];
          if(sql.startsWith('SELECT COUNT(*)'))return [[{count:leases.size}]];
          if(sql.startsWith('SELECT requests'))return [[{requests:counters.get(args.slice(0,3).join(':'))??0}]];
          if(sql.startsWith('INSERT INTO basira_vision_quota ')){const key=args.slice(0,3).join(':');counters.set(key,(counters.get(key)??0)+1);return [{}];}
          if(sql.startsWith('INSERT INTO basira_vision_leases')){leases.add(String(args[0]));return [{}];}
          if(sql.startsWith('DELETE FROM basira_vision_leases WHERE id=')){leases.delete(String(args[0]));return [{}];}
          return [{}];
        },
      };
    },
    execute:async(sql:string,args:unknown[])=>{if(sql.startsWith('DELETE FROM basira_vision_leases WHERE id='))leases.delete(String(args[0]));return [{}];},
  } as unknown as Pool;
  return {pool,counters,leases};
}

describe('central vision admission',()=>{
  it('serializes account quotas across separate app instances and releases the global lease',async()=>{
    const database=fakeDatabase();
    const a=new MysqlVisionQuotaStore(async()=>database.pool),b=new MysqlVisionQuotaStore(async()=>database.pool);
    const attempts=await Promise.allSettled([a.reserve('same-user',limits),b.reserve('same-user',limits)]);
    expect(attempts.filter(item=>item.status==='fulfilled')).toHaveLength(1);
    expect(attempts.filter(item=>item.status==='rejected')).toHaveLength(1);
    await (attempts.find(item=>item.status==='fulfilled') as PromiseFulfilledResult<()=>Promise<void>>).value();
    expect(database.leases.size).toBe(0);
    await expect(b.reserve('same-user',limits)).rejects.toMatchObject({code:'rate_limited'});
  });
  it('bounds parallel provider work globally even for distinct accounts',async()=>{
    const database=fakeDatabase(),a=new MysqlVisionQuotaStore(async()=>database.pool),b=new MysqlVisionQuotaStore(async()=>database.pool);
    const release=await a.reserve('user-one',limits);
    await expect(b.reserve('user-two',limits)).rejects.toMatchObject({code:'rate_limited'});
    await release();
    const second=await b.reserve('user-two',limits);
    await second();
  });
  it('rejects a disabled entitlement and enforces a global daily spend ceiling',async()=>{
    const disabled=fakeDatabase({enabled:0,minute_limit:null,daily_limit:null});
    await expect(new MysqlVisionQuotaStore(async()=>disabled.pool).reserve('disabled-user',limits)).rejects.toMatchObject({code:'access_denied'});
    expect(disabled.leases.size).toBe(0);
    const database=fakeDatabase(),a=new MysqlVisionQuotaStore(async()=>database.pool),b=new MysqlVisionQuotaStore(async()=>database.pool);
    const capped={...limits,concurrent:2,globalPerDay:1};
    await (await a.reserve('user-one',capped))();
    await expect(b.reserve('user-two',capped)).rejects.toMatchObject({code:'rate_limited'});
  });
});
