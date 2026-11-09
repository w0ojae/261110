import {modelToWorld} from './building-placement.js?v=16';
import {seats} from './seats-building2.js?v=21';
import {NPC_DESTINATIONS} from './npc-destinations.js?v=40';
import {NPC_FLOOR_MODEL_Y,NPC_INDOOR_FLOOR_Y} from './npc-placement.js?v=39';

const point=(x,y,z)=>Object.freeze(modelToWorld(x,y,z));
const rect=(minX,maxX,minZ,maxZ)=>{
  const a=modelToWorld(minX,0,minZ),b=modelToWorld(maxX,0,maxZ);
  return Object.freeze({minX:a.x,maxX:b.x,minZ:a.z,maxZ:b.z});
};
// The employee parks in the real empty preparation space behind the counter.
// Only the server uses this extended graph; guest/player walking zones stay put.
const groundZone=Object.freeze({
  bounds:rect(-2.5,2.21,-5.53,-.92),
  obstacles:Object.freeze([
    ...NPC_DESTINATIONS.groundZone.obstacles.slice(0,-1),
    rect(-.65,.805,-4.32,-.70),
    rect(-2.70,.805,-2.65,-.70),
    // Exclude the underside of the first flight; enter at its measured foot.
    rect(-2.65,-1.02,-5.8,-4.92),
  ]),
});
const stopModels={
  'cafe-window-front':[1.90,-1.99265],
  'cafe-window-middle':[1.90,-2.80334],
  'cafe-window-rear':[1.90,-3.60613],
  'upper-front-window':[1.05,-2.16],
  'upper-right-front':[1.28,-2.11],
  'upper-right-middle':[1.18,-2.70],
  'upper-right-rear':[1.30,-3.20],
};
const registry={};
for(const seat of seats){
  const floorY=seat.floor===1?NPC_INDOOR_FLOOR_Y:NPC_DESTINATIONS.upperFloorY;
  const [x,z]=stopModels[seat.id],floorModelY=seat.floor===1?NPC_FLOOR_MODEL_Y:3.5930128111;
  const stop=point(x,floorModelY,z);
  const forward={x:-Math.sin(seat.yaw),z:-Math.cos(seat.yaw)};
  const right={x:Math.cos(seat.yaw),z:-Math.sin(seat.yaw)};
  // A compact personal table stays in the occupied seat's space. The front
  // upstairs chair has an authored low side table, so its new top sits beyond it.
  const reach=seat.id==='upper-front-window'?.40:.24;
  const position=Object.freeze({
    x:seat.position.x+forward.x*reach+right.x*.06,
    y:seat.position.y-.18,
    z:seat.position.z+forward.z*reach+right.z*.06,
  });
  const basePosition=Object.freeze({x:seat.position.x+right.x*.24,y:floorY,z:seat.position.z+right.z*.24});
  const cup=Object.freeze({...position,y:position.y+.002});
  registry[seat.id]=Object.freeze({
    floor:seat.floor,stop,cup,
    yaw:Math.atan2(cup.x-stop.x,cup.z-stop.z),
    table:Object.freeze({position,basePosition,radius:.105,height:position.y-floorY}),
  });
}

export const SERVICE_PLACEMENT=Object.freeze({
  home:point(-.90,NPC_FLOOR_MODEL_Y,-4.0),
  groundZone,
  seats:Object.freeze(registry),
});
