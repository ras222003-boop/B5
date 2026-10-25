import type {ExperimentalModel} from '../../../shared/experimentalModels';
import type {ResearchContract} from '../camera-lab/adapter.mjs';
export const defaultRegistry:string;
export function listRegistered(root?:string):Promise<ExperimentalModel[]>;
export function verifyRegistered(root:string,id:string):Promise<{manifest:ExperimentalModel;contract:ResearchContract;model:{bytes:Buffer};entry:{bytes:Buffer}}>;
export function validModelId(id:unknown):id is string;
