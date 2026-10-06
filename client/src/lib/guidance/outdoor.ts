export type GeoFix={latitude:number;longitude:number;accuracy:number;heading:number|null;timestamp:number};
export type GpsQuality='HIGH'|'MEDIUM'|'LOW'|'LOST';
export function gpsQuality(fix:GeoFix|null,now=Date.now()):GpsQuality {
  if(!fix||now-fix.timestamp>20000||!Number.isFinite(fix.accuracy))return 'LOST';
  if(fix.accuracy<=10)return 'HIGH';
  if(fix.accuracy<=25)return 'MEDIUM';
  return 'LOW';
}
export function geoDistance(a:Pick<GeoFix,'latitude'|'longitude'>,b:Pick<GeoFix,'latitude'|'longitude'>){
  const radians=(value:number)=>value*Math.PI/180,deltaLat=radians(b.latitude-a.latitude),deltaLon=radians(b.longitude-a.longitude);
  const arc=Math.sin(deltaLat/2)**2+Math.cos(radians(a.latitude))*Math.cos(radians(b.latitude))*Math.sin(deltaLon/2)**2;
  return 6371000*2*Math.atan2(Math.sqrt(arc),Math.sqrt(1-arc));
}
export function geoBearing(a:Pick<GeoFix,'latitude'|'longitude'>,b:Pick<GeoFix,'latitude'|'longitude'>){
  const r=(v:number)=>v*Math.PI/180,y=Math.sin(r(b.longitude-a.longitude))*Math.cos(r(b.latitude));
  const x=Math.cos(r(a.latitude))*Math.sin(r(b.latitude))-Math.sin(r(a.latitude))*Math.cos(r(b.latitude))*Math.cos(r(b.longitude-a.longitude));
  return (Math.atan2(y,x)*180/Math.PI+360)%360;
}
