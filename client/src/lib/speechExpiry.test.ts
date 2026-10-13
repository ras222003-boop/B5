import {afterEach,describe,it,expect,vi} from 'vitest';
import {AudioPlaybackManager} from './speechEngine';
import type {SpeechRequest} from '@shared/speech';
const input:SpeechRequest={text:'كرسي أمام الكاميرا',language:'ar',arabicStyle:'SAUDI',context:'ENVIRONMENT',rate:1};
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();});
describe('perception speech expiry',()=>{
 it('cancels browser speech waiting to start after the observation expires',async()=>{
  vi.useFakeTimers();const cancel=vi.fn(),speak=vi.fn();
  vi.stubGlobal('window',{speechSynthesis:{cancel,speak,getVoices:()=>[],resume:()=>{}}});
  vi.stubGlobal('SpeechSynthesisUtterance',class{constructor(public text:string){}});
  const manager=new AudioPlaybackManager({isAvailable:()=>false,synthesize:vi.fn(),stop:()=>{}});
  const done=manager.enqueue(input,'INFORMATION',0,undefined,false,performance.now()+100);
  expect(speak).toHaveBeenCalledOnce();await vi.advanceTimersByTimeAsync(101);await done;
  expect(cancel).toHaveBeenCalledOnce();expect(manager.busy).toBe(false);
 });
 it('drops already expired queued observations without synthesis',async()=>{
  const synthesize=vi.fn();const manager=new AudioPlaybackManager({isAvailable:()=>true,synthesize,stop:()=>{}});
  await manager.enqueue(input,'INFORMATION',0,undefined,false,performance.now()-1);
  expect(synthesize).not.toHaveBeenCalled();expect(manager.busy).toBe(false);
 });
 it('does not play or fall back after delayed synthesis completes past expiry',async()=>{
  let now=1000;vi.spyOn(performance,'now').mockImplementation(()=>now);
  const play=vi.fn();vi.stubGlobal('Audio',class{play=play;});
  const manager=new AudioPlaybackManager({isAvailable:()=>true,synthesize:async()=>{now=3000;return new Blob(['audio']);},stop:()=>{}});
  await manager.enqueue(input,'INFORMATION',0,undefined,false,2000);
  expect(play).not.toHaveBeenCalled();expect(manager.metrics.fallbacks).toBe(0);expect(manager.busy).toBe(false);
 });
});
