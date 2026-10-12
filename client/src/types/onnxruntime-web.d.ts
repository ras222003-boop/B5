/** The pinned ONNX Runtime Web package exposes this declaration separately from exports. */
declare module 'onnxruntime-web' {
  export const env:{wasm:{wasmPaths:string;numThreads:number}};
  export class Tensor {
    constructor(type:'float32',data:Float32Array,dims:number[]);
    readonly data:ArrayLike<number>;
    readonly dims:readonly number[];
    dispose():void;
  }
  export class InferenceSession {
    static create(model:Uint8Array,options:{executionProviders:('webgpu'|'wasm')[];graphOptimizationLevel:'all'}):Promise<InferenceSession>;
    run(feeds:Record<string,Tensor>):Promise<Record<string,Tensor>>;
    release():Promise<void>;
  }
}
