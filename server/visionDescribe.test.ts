import {afterEach,describe,expect,it,vi} from 'vitest';
import express from 'express';
import type {AddressInfo} from 'node:net';
import sharp from 'sharp';
import {prepareDescriptionImage,registerVisionDescribeRoute} from './visionDescribe';

const image=async()=>`data:image/png;base64,${(await sharp({create:{width:320,height:240,channels:3,background:'#777777'}}).png().toBuffer()).toString('base64')}`;

describe('single-frame description API',()=>{
  it('validates pixels and orientation while limiting the transmitted still',async()=>{
    const prepared=await prepareDescriptionImage(await image());
    expect(prepared.startsWith('data:image/jpeg;base64,')).toBe(true);
    const meta=await sharp(Buffer.from(prepared.split(',')[1],'base64')).metadata();
    expect([meta.width,meta.height]).toEqual([320,240]);
    await expect(prepareDescriptionImage('data:text/plain;base64,YWJj')).rejects.toMatchObject({code:'invalid_image'});
  });
  it('requires consent and passes one still to a multimodal model for Arabic description',async()=>{
    const app=express();app.use(express.json({limit:'12mb'}));
    const invoke=vi.fn(async()=>({choices:[{message:{content:'كرسي أمامك وشخص على اليسار.'}}]}));
    registerVisionDescribeRoute(app,invoke);
    const server=app.listen(0);
    try{
      const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const frame=await image();
      const denied=await fetch(`${base}/api/vision/describe-frame`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({imageBase64:frame,mode:'brief'})});
      expect(denied.status).toBe(400);
      expect(invoke).not.toHaveBeenCalled();
      const result=await fetch(`${base}/api/vision/describe-frame`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({imageBase64:frame,mode:'detailed',consent:true})});
      expect(result.status).toBe(200);
      expect(await result.json()).toEqual({description:'كرسي أمامك وشخص على اليسار.',mode:'detailed'});
      expect(invoke).toHaveBeenCalledTimes(1);
      expect(invoke.mock.calls[0][0][1].content[1].type).toBe('image_url');
      expect(invoke.mock.calls[0][1].model).toBeTruthy();
    }finally{server.close();}
  });
});
