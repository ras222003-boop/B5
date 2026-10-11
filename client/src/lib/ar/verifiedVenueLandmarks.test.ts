import {describe,it,expect} from 'vitest';
import {resolveVettedVenueLandmark,type VerifiedVenueTarget} from './verifiedVenueLandmarks';
import type {Building,Floor,Place} from '@shared/navigation';

const building={id:'b1',status:'ACTIVE',verificationStatus:'OFFICIAL'} as Building;
const floor={id:'f1',buildingId:'b1'} as Floor;
const place={id:'p1',buildingId:'b1',floorId:'f1',name:'قاعة 202',isPublic:true,verificationStatus:'OFFICIAL'} as Place;
const target:VerifiedVenueTarget={targetName:'basira-uni-hall-202',buildingId:'b1',floorId:'f1',placeId:'p1',reviewedAt:'2026-10-11T05:00:00Z',approvedBy:'reviewer',targetAssetPath:'/ar/targets/basira-uni-hall-202.json'};
const map=(input:VerifiedVenueTarget[]= [target],bs:Building[]=[building],fs:Floor[]=[floor],ps:Place[]=[place])=>
  resolveVettedVenueLandmark('basira-uni-hall-202',input,bs,fs,ps);
describe('verified room image targets cannot invent location',()=>{
  it('only resolves enrolled official places with matching floor and building',()=>{
    const m=map();
    expect(m?.placeName).toBe('قاعة 202');
    expect(m?.confidence).toBe('LANDMARK_IDENTIFICATION_ONLY');
  });
  it('rejects unknown targets, duplicates and unapproved targets',()=>{
    expect(resolveVettedVenueLandmark('unregistered', [target],[building],[floor],[place])).toBeNull();
    expect(map([target,target])).toBeNull();
    expect(map([{...target,approvedBy:''}])).toBeNull();
    expect(map([{...target,targetAssetPath:'https://bad.example/file'}])).toBeNull();
  });
  it('requires current official place and building verification',()=>{
    expect(map([target],[{...building,verificationStatus:'DISCOVERED'}])).toBeNull();
    expect(map([target],[building],[floor],[{...place,verificationStatus:'DISCOVERED'}])).toBeNull();
    expect(map([target],[building],[{...floor,buildingId:'wrong'}])).toBeNull();
    expect(map([target],[building],[floor],[{...place,isPublic:false}])).toBeNull();
  });
  it('does not map the lab sign to a real room',()=>{
    expect(resolveVettedVenueLandmark('basira-lab-entrance',[{...target,targetName:'basira-lab-entrance'}],[building],[floor],[place])).toBeNull();
  });
});
