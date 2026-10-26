import { afterEach, describe, expect, it, vi } from 'vitest';
import { AudioPlaybackManager, type TtsProvider } from './speechEngine';
import type { SpeechRequest } from '@shared/speech';

const input: SpeechRequest = { text: 'Turn right', language: 'en', arabicStyle: 'MSA', context: 'NAVIGATION', rate: 1 };
afterEach(() => {vi.useRealTimers();vi.unstubAllGlobals();});

describe('audio playback manager', () => {
  it('calls local speak synchronously inside a tap, then observes later object playback start',async()=>{
    let gesture=true,unlocked=false;
    const utterances:any[]=[];
    const speak=vi.fn(u=>{if(gesture)unlocked=true;if(unlocked){utterances.push(u);queueMicrotask(()=>{u.onstart?.();u.onend?.();});}});
    vi.stubGlobal('window',{speechSynthesis:{getVoices:()=>[{lang:'ar-SA',localService:true}],speak,cancel:vi.fn()}});
    vi.stubGlobal('SpeechSynthesisUtterance',class{lang='';rate=1;voice=null;constructor(public text:string){}});
    const m=new AudioPlaybackManager({isAvailable:()=>true,synthesize:vi.fn(),stop:vi.fn()});
    const tap=m.enqueueLocal({...input,language:'ar',context:'ENVIRONMENT',text:'بدأ وصف الأشياء.'});
    expect(speak).toHaveBeenCalledOnce();gesture=false;await tap;
    await expect(m.enqueueLocalObserved({...input,language:'ar',context:'ENVIRONMENT',text:'كرسي في الصورة.'},performance.now()+1250)).resolves.toBe(true);
    expect(utterances).toHaveLength(2);
  });
  it('does not confirm blocked/expired speech, or revive it after cancellation',async()=>{
    vi.useFakeTimers();const utterances:any[]=[],cancel=vi.fn();
    vi.stubGlobal('window',{speechSynthesis:{getVoices:()=>[{lang:'ar-SA',localService:true}],speak:(u:any)=>utterances.push(u),cancel}});
    vi.stubGlobal('SpeechSynthesisUtterance',class{lang='';rate=1;voice=null;constructor(public text:string){}});
    const m=new AudioPlaybackManager({isAvailable:()=>true,synthesize:vi.fn(),stop:vi.fn()});
    const pending=m.enqueueLocalObserved({...input,language:'ar'},performance.now()+1250);
    await vi.advanceTimersByTimeAsync(1251);expect(await pending).toBe(false);expect(m.busy).toBe(false);
    const next=m.enqueueLocalObserved({...input,language:'ar'},performance.now()+1250);
    m.stop();expect(await next).toBe(false);utterances.at(-1)?.onstart?.();
    await vi.advanceTimersByTimeAsync(9000);expect(m.status.isSpeaking).toBe(false);expect(m.busy).toBe(false);expect(cancel).toHaveBeenCalled();
  });
  it('can retry after local voices become available without selecting a remote voice',async()=>{
    let ready=false;
    vi.stubGlobal('window',{speechSynthesis:{getVoices:()=>ready?[{lang:'ar-SA',localService:true}]:[],speak:(u:any)=>queueMicrotask(()=>{u.onstart?.();u.onend?.();}),cancel:vi.fn()}});
    vi.stubGlobal('SpeechSynthesisUtterance',class{lang='';rate=1;voice=null;constructor(public text:string){}});
    const m=new AudioPlaybackManager({isAvailable:()=>true,synthesize:vi.fn(),stop:vi.fn()});
    await expect(m.enqueueLocalObserved({...input,language:'ar'},performance.now()+1250)).resolves.toBe(false);
    expect(m.status.error).toBe('NO_VOICE');ready=true;
    await expect(m.enqueueLocalObserved({...input,language:'ar'},performance.now()+1250)).resolves.toBe(true);
    expect(m.status.error).toBeUndefined();
  });
  it('uses an explicit local-only information path without calling paid synthesis',async()=>{
    const synthesize=vi.fn(),speak=vi.fn((u:{onend?:()=>void})=>queueMicrotask(()=>u.onend?.()));
    vi.stubGlobal('window',{speechSynthesis:{getVoices:()=>[{lang:'ar-SA',localService:true}],speak,cancel:vi.fn()}});
    vi.stubGlobal('SpeechSynthesisUtterance',class{lang='';rate=1;voice=null;onend?:()=>void;constructor(public text:string){}});
    const m=new AudioPlaybackManager({isAvailable:()=>true,synthesize,stop:vi.fn()});
    await m.enqueueLocal({...input,text:'كرسي في الصورة',language:'ar',context:'ENVIRONMENT'});
    expect(speak).toHaveBeenCalledOnce();expect(synthesize).not.toHaveBeenCalled();expect(m.status.mode).toBe('LOCAL');
  });
  it('does not send local-only text to a remote browser voice when no local language voice exists',async()=>{
    const speak=vi.fn(),synthesize=vi.fn();vi.stubGlobal('window',{speechSynthesis:{getVoices:()=>[{lang:'ar-SA',localService:false}],speak,cancel:vi.fn()}});
    vi.stubGlobal('SpeechSynthesisUtterance',class{lang='';rate=1;voice=null;constructor(public text:string){}});
    const m=new AudioPlaybackManager({isAvailable:()=>true,synthesize,stop:vi.fn()});await m.enqueueLocal({...input,language:'ar',context:'ENVIRONMENT'});
    expect(speak).not.toHaveBeenCalled();expect(synthesize).not.toHaveBeenCalled();expect(m.status.error).toBe('NO_VOICE');
  });
  it('uses local fallback offline and records a fallback without retaining text', async () => {
    const speak = vi.fn((utterance: { onend?: () => void }) => queueMicrotask(() => utterance.onend?.()));
    vi.stubGlobal('window', { speechSynthesis: { speak, getVoices: () => [], cancel: vi.fn() } });
    vi.stubGlobal('SpeechSynthesisUtterance', class { lang = ''; rate = 1; voice = null; onend?: () => void; onerror?: () => void; constructor(public text: string) {} });
    const manager = new AudioPlaybackManager({ isAvailable: () => false, synthesize: vi.fn(), stop: vi.fn() });
    await manager.enqueue(input);
    expect(speak).toHaveBeenCalledOnce();
    expect(manager.status.mode).toBe('LOCAL');
    expect(manager.metrics.fallbacks).toBe(1);
    expect(JSON.stringify(manager.metrics)).not.toContain(input.text);
  });
  it('keeps automatic speech muted for VoiceOver but permits a deliberate Safari audio test', async () => {
    const speak = vi.fn((utterance: { onend?: () => void }) => queueMicrotask(() => utterance.onend?.()));
    const resume = vi.fn();
    vi.stubGlobal('localStorage',{getItem:()=>JSON.stringify({screenReaderMode:true})});
    vi.stubGlobal('window',{speechSynthesis:{speak,resume,getVoices:()=>[],cancel:vi.fn()}});
    vi.stubGlobal('SpeechSynthesisUtterance',class{lang='';rate=1;voice=null;onend?:()=>void;constructor(public text:string){}});
    const manager=new AudioPlaybackManager({isAvailable:()=>false,synthesize:vi.fn(),stop:vi.fn()});
    await manager.enqueue(input);
    expect(speak).not.toHaveBeenCalled();
    await manager.enqueue(input,'INFORMATION',0,undefined,true);
    expect(speak).toHaveBeenCalledOnce();
    expect(resume).toHaveBeenCalledOnce();
  });
  it('interrupts a lower priority request and plays safety next', async () => {
    class FakeAudio {
      src = ''; onended?: () => void; onerror?: () => void;
      constructor(src: string) { this.src = src; }
      play() { queueMicrotask(() => this.onended?.()); return Promise.resolve(); }
      pause() {}
    }
    vi.stubGlobal('Audio', FakeAudio);
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:mock', revokeObjectURL: vi.fn() });
    vi.stubGlobal('window', { speechSynthesis: { cancel: vi.fn() } });
    let started = false;
    const premium: TtsProvider = {
      isAvailable: () => true, stop: vi.fn(),
      synthesize: (request, signal) => request.text === 'Turn right'
        ? new Promise((_resolve, reject) => { started = true; signal.addEventListener('abort', () => reject(new Error('cancelled'))); })
        : Promise.resolve(new Blob(['audio'])),
    };
    const manager = new AudioPlaybackManager(premium);
    const turn = manager.enqueue(input, 'TURN');
    expect(started).toBe(true);
    const safety = manager.enqueue({ ...input, text: 'Stop', context: 'SAFETY' }, 'CRITICAL_SAFETY');
    await Promise.all([turn, safety]);
    expect(manager.metrics.requests).toBe(2);
    expect(manager.metrics.fallbacks).toBe(0);
    expect(manager.status.mode).toBe('PREMIUM');
  });
  it('cancels prefetched requests during reroute', () => {
    let cancelled = false;
    const premium: TtsProvider = { isAvailable: () => true, stop: vi.fn(), synthesize: (_request, signal) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => { cancelled = true; reject(new Error('cancelled')); })) };
    const manager = new AudioPlaybackManager(premium);
    manager.prefetch('route-old:1', input);
    manager.clearPrefetch();
    expect(cancelled).toBe(true);
  });
  it('does not let ordinary speech replace an active safety warning', async () => {
    const utterances: Array<{ onend?: () => void }> = [];
    vi.stubGlobal('window', { speechSynthesis: { speak: (u: { onend?: () => void }) => utterances.push(u), getVoices: () => [], cancel: vi.fn() } });
    vi.stubGlobal('SpeechSynthesisUtterance', class { lang = ''; rate = 1; voice = null; onend?: () => void; onerror?: () => void; constructor(public text: string) {} });
    const manager = new AudioPlaybackManager({ isAvailable: () => false, synthesize: vi.fn(), stop: vi.fn() });
    const safety = manager.enqueue({ ...input, text: 'Stop', context: 'SAFETY' }, 'CRITICAL_SAFETY');
    await vi.waitFor(() => expect(utterances).toHaveLength(1));
    const epoch = manager.cancellationEpoch;
    manager.replaceAtPriority('INFORMATION');
    const general = manager.enqueue(input, 'INFORMATION');
    expect(utterances).toHaveLength(1);
    utterances[0].onend?.();
    await safety;
    await vi.waitFor(() => expect(utterances).toHaveLength(2));
    utterances[1].onend?.();
    await general;
    expect(manager.cancellationEpoch).toBe(epoch);
  });
});
