import {createNpcCharacter} from './npc-character.js?v=46';
import {createNpcNavigation,NPC_RADIUS,pointSegmentDistance2} from './npc-navigation.js?v=40';

export const NPC_SEAT_SECONDS=60;
export const NPC_PLAYER_CLEARANCE=.52;
// Dynamic spacing covers the animated shoes/arms. The smaller navigation
// radius still fits the authored narrow aisles and is only for static walls.
export const NPC_TRAFFIC_RADIUS=.31;
export const NPC_SEATED_RADIUS=.33;
export const NPC_STAFF_RADIUS=.29;
const NPC_BODY_HEIGHT=1.2,TRAFFIC_GAP=.025,DOOR_WAIT_CLEARANCE=.85;
const FADE_SECONDS=.65,SEAT_BLEND_SECONDS=.45;
const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const smooth=t=>{t=Math.max(0,Math.min(1,t));return t*t*(3-2*t);};
const turn=(a,b)=>Math.atan2(Math.sin(b-a),Math.cos(b-a));
const isChairState=state=>['sitting','seated','standing'].includes(state);
const bodyRadius=c=>c.role==='barista'?NPC_STAFF_RADIUS:isChairState(c.state)?NPC_SEATED_RADIUS:NPC_TRAFFIC_RADIUS;
const playerClearance=player=>Number.isFinite(player?.clearance)?Math.max(NPC_PLAYER_CLEARANCE,Math.min(1.2,player.clearance)):NPC_PLAYER_CLEARANCE;

export function createCafeNpcs(THREE,scene,{
  indoorZone,outdoorZone,indoorDoor,outdoorDoor,indoorFloorY,barista,
  destinations,guestCount=6,styleCharacter,random=Math.random,reducedMotion=false,
  servicePlacement,onServe,onServiceState,
}={}){
  if(!indoorZone?.bounds||!outdoorZone?.bounds||!indoorDoor||!outdoorDoor)throw new TypeError('NPC walking zones and doorway anchors are required.');
  guestCount=Number.isFinite(guestCount)?Math.max(1,Math.min(6,Math.round(guestCount))):6;
  const unit=()=>{const value=random();return Number.isFinite(value)?Math.max(0,Math.min(1-Number.EPSILON,value)):.5;};
  const range=(a,b)=>a+(b-a)*unit();
  const zones={inside:destinations?.groundZone??indoorZone,outside:outdoorZone};
  const floors={inside:destinations?.groundFloorY??indoorFloorY,upper:destinations?.upperFloorY};
  const stairs=destinations?.stairs;
  if(destinations?.upperZone&&stairs?.path?.length>1)zones.upper=destinations.upperZone;
  const seats=(destinations?.seats??[]).map(seat=>({...seat,area:seat.floor===2?'upper':'inside'}));
  const doors={inside:indoorDoor,outside:outdoorDoor};
  const serviceSeats=servicePlacement?.seats??{};
  const serviceHome=servicePlacement?.home;
  const anchors=area=>[...(doors[area]?[doors[area]]:[]),...(stairs&&area!=='outside'?[area==='inside'?stairs.lower:stairs.upper]:[]),...seats.filter(seat=>seat.area===area).map(seat=>seat.approach)];
  const navigation=Object.fromEntries(Object.entries(zones).map(([area,zone])=>[area,createNpcNavigation(zone,{anchors:anchors(area)})]));
  const serviceNavigation=serviceHome?Object.fromEntries(Object.entries(zones).filter(([area])=>area!=='outside').map(([area,zone])=>[area,createNpcNavigation(area==='inside'?(servicePlacement.groundZone??zone):zone,{anchors:[...anchors(area),...(area==='inside'?[serviceHome]:[]),...Object.values(serviceSeats).filter(seat=>(seat.floor===2?'upper':'inside')===area).map(seat=>seat.stop)]})])):null;
  const navFor=(character,area=character.area)=>character.role==='server'?serviceNavigation?.[area]:navigation[area];
  for(const area of Object.keys(navigation))if(!navigation[area].anchors[0]?.edges.length)throw new Error('NPC '+area+' entrance does not connect to the walking area.');
  const component=area=>navigation[area].anchors[0].component;
  const candidates=Object.fromEntries(Object.entries(navigation).map(([area,nav])=>[area,nav.nodes.filter(node=>node.component===component(area))]));
  const group=new THREE.Group();group.name='Cafe visitors';scene.add(group);
  const characters=[],claims=new Map(),floorLease={inside:null,upper:null};
  const stats={total:guestCount+1,guests:guestCount,staff:1,visible:guestCount+1,inside:0,upstairs:0,outside:0,away:0,seated:0,seats:'',transitions:0,entries:0,exits:0,ascents:0,descents:0,edgeDepartures:0,doorOwner:null,stairOwner:null,states:''};
  let disposed=false,clock=0,doorOwner=null,stairOwner=null,nextDoorTicket=0,server=null,serviceOrder=null;
  const height=(area,p)=>area==='outside'?(outdoorZone.heightAt?.(p.x,p.z)??outdoorDoor.y):floors[area];
  const servicePriority=(character,area)=>serviceOrder&&character.role==='guest'&&character.state!=='seated'&&floorLease[character.area]!==character.id&&floorLease[area]!==character.id&&
    (area==='inside'||serviceOrder.placement.floor===2);
  const acquireFloor=(character,area)=>{if(area==='outside')return true;if(floorLease[area]!==null&&floorLease[area]!==character.id)return false;if(servicePriority(character,area))return false;floorLease[area]=character.id;return true;};
  const releaseFloor=(character,area)=>{if(floorLease[area]===character.id)floorLease[area]=null;};
  const sharesArea=(other,area)=>other.area&&(other.area===area||(other.area==='stairs'&&area!=='outside')||(area==='stairs'&&other.area!=='outside'));
  const sameLevel=(other,area,point)=>sharesArea(other,area)&&Math.abs(other.position.y-(point.y??height(area,point)))<NPC_BODY_HEIGHT;
  function occupied(point,area,ignore,player,radius=NPC_TRAFFIC_RADIUS){
    for(const other of characters)if(other!==ignore&&sameLevel(other,area,point)&&distance(point,other.position)<radius+bodyRadius(other)+TRAFFIC_GAP)return true;
    const p=player?.position;if(p&&player.zone===area&&distance(point,p)<Math.max(playerClearance(player),radius+.19))return true;
    return false;
  }
  function pointFor(area,origin,ignore,{edge=false,player}={}){
    const nodes=candidates[area],bounds=zones[area].bounds;
    const available=node=>node&&!(origin&&distance(node,origin)<.65)&&!(doors[area]&&distance(node,doors[area])<(area==='outside'?DOOR_WAIT_CLEARANCE:.6))&&!occupied(node,area,ignore,player)&&!(edge&&Math.min(node.x-bounds.minX,bounds.maxX-node.x,node.z-bounds.minZ,bounds.maxZ-node.z)>.65);
    for(let attempt=0;attempt<100;attempt++){
      const node=nodes[Math.floor(unit()*nodes.length)];if(!node)break;
      if(!available(node))continue;
      return {x:node.x,y:height(area,node),z:node.z};
    }
    // A repeated random choice must not fall back to spawning several actors
    // on the same doorway. Search the remaining cached nodes before waiting.
    const node=nodes.find(available);
    return node?{x:node.x,y:height(area,node),z:node.z}:null;
  }
  function place(character,point,area,preserveY=false){
    character.area=area;Object.assign(character.position,{x:point.x,y:preserveY?point.y:height(area,point),z:point.z});
    character.visual.root.position.set(character.position.x,character.position.y,character.position.z);
  }
  function make(index,role,area,point){
    const visual=createNpcCharacter(THREE,{index,barista:role==='barista',server:role==='server',style:styleCharacter});group.add(visual.root);
    const character={id:index,role,area,position:{...point},visual,state:role==='barista'?'fixed':'wait',opacity:1,wait:range(1,3)+index*.8,visit:range(18,32),path:[],pathIndex:0,targetKind:'wander',fadeTime:0,blockedTime:0,walk:0,speed:range(.34,.48),wanderings:0,seat:null,seated:0,seatTimer:0,seatedElapsed:0,hasSat:false,desiredFloor:index%2?2:1,doorTicket:null,doorRetryAfter:0};
    visual.root.name=role==='barista'?'Cafe barista':'Cafe guest '+index;
    place(character,point,area);visual.setOpacity(1);characters.push(character);return character;
  }
  const staff=make(0,'barista','inside',barista?.position??{...indoorDoor,x:indoorDoor.x-.7});
  staff.visual.root.rotation.y=barista?.yaw??Math.PI/2;staff.position.y=barista?.position?.y??floors.inside;staff.visual.root.position.y=staff.position.y;
  function seatPosition(character,seat){return {x:seat.position.x,y:seat.position.y-(character.visual.hipHeight??.44),z:seat.position.z};}
  function startSeated(character,seat){
    claims.set(seat.id,character.id);character.seat=seat;character.state='seated';character.seated=1;character.seatTimer=NPC_SEAT_SECONDS;character.seatedElapsed=0;character.hasSat=true;
    place(character,seatPosition(character,seat),seat.area,true);character.visual.root.rotation.y=seat.yaw;releaseFloor(character,seat.area);
  }
  const initialSeats=[seats.find(seat=>seat.area==='inside'),seats.find(seat=>seat.area==='upper')].filter(Boolean);
  for(let index=1;index<=guestCount;index++){
    const seat=initialSeats[index-1],area=seat?.area??(!seats.length&&index===1?'inside':'outside');
    const point=seat?.approach??pointFor(area,null,null);
    const character=make(index,'guest',area,point??doors[area]);
    if(!point){character.area=null;character.state='away';character.opacity=0;character.wait=1;character.visual.setOpacity(0);}
    else if(seat)startSeated(character,seat);else if(area==='inside')acquireFloor(character,area);
  }
  if(serviceHome&&serviceNavigation.inside.safe(serviceHome)){
    server=make(guestCount+1,'server','inside',serviceHome);server.state='serviceIdle';server.speed=.60;
    server.visual.root.name='Cafe serving employee';server.visual.root.rotation.y=servicePlacement.yaw??Math.PI/2;
    stats.total++;stats.staff++;stats.visible++;
  }
  function avoidFor(character,player,area=character.area,position=character.position){
    const radius=bodyRadius(character),navRadius=navFor(character,area).radius;
    const points=characters.filter(other=>other!==character&&sameLevel(other,area,position)).map(other=>({...other.position,radius:radius+bodyRadius(other)-navRadius}));
    if(player?.zone===area&&player.position)points.push({...player.position,radius:playerClearance(player)-NPC_RADIUS-.025});
    return points;
  }
  function go(character,point,kind,player){
    const nav=navFor(character);if(!nav)return false;
    const path=nav.findPath(character.position,point,avoidFor(character,player));if(!path.length)return false;
    character.path=path;character.pathIndex=0;character.targetKind=kind;character.state='walk';character.blockedTime=0;return true;
  }
  function releaseSeat(character){if(character.seat&&claims.get(character.seat.id)===character.id)claims.delete(character.seat.id);character.seat=null;}
  function wait(character,time=1){character.state='wait';character.wait=time;character.path=[];character.walk=0;}
  function wander(character,player){
    const edge=character.area==='outside'&&character.wanderings>=3&&unit()<.18;
    for(let i=0;i<8;i++){const point=pointFor(character.area,character.position,character,{edge,player});if(point&&go(character,point,edge?'away':'wander',player))return true;}
    wait(character,1);return false;
  }
  function chooseSeat(character,player){
    const options=seats.filter(seat=>seat.area===character.area&&!claims.has(seat.id));
    if(options.length){const offset=Math.floor(unit()*options.length);for(let i=0;i<options.length;i++){
      const seat=options[(offset+i)%options.length];
      if(occupied(seat.approach,character.area,character,player)||!canStep(character,seatPosition(character,seat),player,{from:seat.approach,radius:NPC_SEATED_RADIUS}))continue;
      claims.set(seat.id,character.id);character.seat=seat;
      if(go(character,seat.approach,'seat',player))return true;releaseSeat(character);
    }}return false;
  }
  function askDoor(character,player){
    if(character.area==='upper'||character.area==='stairs')return false;
    if(character.doorTicket===null)character.doorTicket=nextDoorTicket++;
    if(doorOwner!==null&&doorOwner!==character.id)return false;
    const otherArea=character.area==='inside'?'outside':'inside';
    if(otherArea==='inside'&&servicePriority(character,'inside'))return false;
    if(otherArea==='inside'&&floorLease.inside!==null&&floorLease.inside!==character.id)return false;
    if(occupied(doors[otherArea],otherArea,character,player))return false;
    // Ready requests take turns, even if their actor is later in the update
    // array. Requests with a blocked destination cannot hold up the exit flow.
    const ready=characters.filter(other=>other.role==='guest'&&other.doorTicket!==null&&other.state==='wait'&&['inside','outside'].includes(other.area)&&other.doorRetryAfter<=clock&&
      (other.area!=='outside'||floorLease.inside===null||floorLease.inside===other.id)&&!occupied(doors[other.area==='inside'?'outside':'inside'],other.area==='inside'?'outside':'inside',other,player));
    const first=ready.reduce((oldest,other)=>!oldest||other.doorTicket<oldest.doorTicket?other:oldest,null);
    if(first&&first!==character)return false;
    if(!go(character,doors[character.area],'door',player)){character.doorRetryAfter=clock+1;return false;}
    doorOwner=character.id;if(otherArea==='inside')acquireFloor(character,'inside');return true;
  }
  function waitForDoor(character,player){
    if(askDoor(character,player))return;
    if(distance(character.position,doors.outside)<DOOR_WAIT_CLEARANCE){
      const options=candidates.outside.filter(node=>distance(node,doors.outside)>=DOOR_WAIT_CLEARANCE&&distance(node,character.position)<1.5&&!occupied(node,'outside',character,player));
      options.sort((a,b)=>distance(a,character.position)-distance(b,character.position));
      for(const point of options)if(go(character,point,'queue',player))return;
    }
    wait(character,1);
  }
  function askStairs(character,player){
    if(!stairs||!zones.upper||!['inside','upper'].includes(character.area))return false;
    if(stairOwner!==null&&stairOwner!==character.id)return false;
    const destination=character.area==='inside'?'upper':'inside';
    if(servicePriority(character,destination))return false;
    if(floorLease[destination]!==null&&floorLease[destination]!==character.id)return false;
    const start=character.area==='inside'?stairs.lower:stairs.upper,end=destination==='upper'?stairs.upper:stairs.lower;
    if(occupied(end,destination,character,player))return false;
    if(!go(character,start,'stairs',player))return false;
    acquireFloor(character,destination);stairOwner=character.id;character.stairDestination=destination;return true;
  }
  function beginFade(character,kind){character.state='fadeOut';character.fadeTime=0;character.transfer=kind;character.walk=0;}
  function planInside(character,player){
    if(!seats.length)return character.visit<=0?askDoor(character,player)||wander(character,player):wander(character,player);
    if(character.hasSat){
      if(character.area==='upper')return askStairs(character,player)||wait(character,1);
      return askDoor(character,player)||wait(character,1);
    }
    if(character.area==='inside'&&character.desiredFloor===2&&askStairs(character,player))return true;
    if(chooseSeat(character,player))return true;
    // A blocked upstairs visit must not monopolize the lower aisle forever.
    if(character.area==='inside'&&character.visit<=0)return askDoor(character,player)||wait(character,1);
    if(character.area==='upper'&&character.visit<=0)return askStairs(character,player)||wait(character,1);
    return wander(character,player);
  }
  function canStep(character,next,player,{from=character.position,radius=bodyRadius(character),area=character.area}={}){
    const low=Math.min(from.y??height(area,from),next.y??height(area,next)),high=Math.max(from.y??height(area,from),next.y??height(area,next))+NPC_BODY_HEIGHT;
    for(const other of characters)if(other!==character&&sharesArea(other,area)&&other.position.y<high&&other.position.y+NPC_BODY_HEIGHT>low){
      const clearance=radius+bodyRadius(other)+TRAFFIC_GAP,start=distance(from,other.position);
      const outward=(next.x-from.x)*(from.x-other.position.x)+(next.z-from.z)*(from.z-other.position.z);
      const fromY=from.y??height(area,from);
      const alreadyOverlappingHeight=other.position.y<fromY+NPC_BODY_HEIGHT&&other.position.y+NPC_BODY_HEIGHT>fromY;
      const escapes=alreadyOverlappingHeight&&start<clearance&&outward>=-1e-10&&distance(next,other.position)>start;
      if(!escapes&&pointSegmentDistance2(other.position,from,next)<clearance**2-1e-10)return false;
    }
    const p=player?.position;if(p&&player.zone===area){
      const clearance=playerClearance(player),start=distance(from,p);
      const outward=(next.x-from.x)*(from.x-p.x)+(next.z-from.z)*(from.z-p.z);
      const escapes=start<clearance&&outward>=-1e-10&&distance(next,p)>start;
      if(!escapes&&pointSegmentDistance2(p,from,next)<clearance**2)return false;
    }return true;
  }
  function blocked(character){
    if(character.role==='server'){character.path=[];character.pathIndex=0;character.state='serviceWait';character.wait=.4;return;}
    if(character.targetKind==='seat')releaseSeat(character);
    if(character.targetKind==='stairs'){releaseFloor(character,character.stairDestination);if(stairOwner===character.id)stairOwner=null;}
    if(character.targetKind==='door'){if(character.area==='outside')releaseFloor(character,'inside');if(doorOwner===character.id)doorOwner=null;}
    wait(character,range(.5,1.5));
  }
  function yieldToArrivingPlayer(character,dt,player){
    if(!player?.position||player.zone!==character.area||!['wait','walk','serviceWait'].includes(character.state)){
      character.yieldGoal=null;character.yieldFrom=null;character.yielding=false;return false;
    }
    const p=player.position,start=distance(character.position,p),clearance=playerClearance(player),comfort=clearance+.025;
    // Planned routes may safely pass between clearance and comfort. Only a
    // real overlap starts yielding; the extra margin only finishes an escape.
    if(start>=comfort||(!character.yielding&&start>=clearance-1e-8)){
      character.yieldGoal=null;character.yieldFrom=null;character.yielding=false;return false;
    }
    // Floor changes can place the camera inside a previously valid NPC route.
    // Escape with a short visible walk, rather than attempting a path whose
    // first graph edges are already inside the player's exclusion circle.
    if(!character.yielding){blocked(character);character.yielding=true;}
    const nav=navFor(character);
    const stillUseful=goal=>goal&&distance(goal,p)>start+.015&&nav.clear(character.position,goal)&&canStep(character,goal,player);
    if(!stillUseful(character.yieldGoal)||!character.yieldFrom||distance(character.yieldFrom,p)>.1){
      character.yieldGoal=null;character.yieldFrom={x:p.x,z:p.z};let best=Infinity;
      for(const node of character.role==='server'?nav.nodes:candidates[character.area]){
        const length=distance(character.position,node),end=distance(node,p);
        if(length<.025||length>1.15||end<start+.04)continue;
        if(!nav.clear(character.position,node)||!canStep(character,node,player))continue;
        const score=(end>=comfort?0:3)+(end>=comfort?length:-end);
        if(score<best){best=score;character.yieldGoal={x:node.x,z:node.z};}
      }
    }
    const goal=character.yieldGoal;if(!goal)return true;
    const dx=goal.x-character.position.x,dz=goal.z-character.position.z,length=Math.hypot(dx,dz),amount=Math.min(length,character.speed*dt);
    if(length>1e-8){
      const next={x:character.position.x+dx/length*amount,z:character.position.z+dz/length*amount};
      if(canStep(character,next,player)){
        Object.assign(character.position,next);character.position.y=height(character.area,next);character.walk=1;
        const yaw=Math.atan2(dx,dz);character.visual.root.rotation.y+=turn(character.visual.root.rotation.y,yaw)*Math.min(1,dt*8);
      }
    }
    if(distance(character.position,p)>=comfort){character.yielding=false;character.yieldGoal=null;character.wait=.3;}
    return true;
  }
  function arrive(character,player){
    if(character.role==='server'&&character.targetKind!=='stairs'){
      character.state=character.targetKind==='serviceStop'?'servicePlace':character.targetKind==='serviceHome'?'serviceIdle':'serviceWait';
      character.serviceTime=0;
      if(character.state==='servicePlace')emitService('placing');
      if(character.state==='serviceIdle')finishService();
      return;
    }
    if(character.targetKind==='door')beginFade(character,'door');
    else if(character.targetKind==='away')beginFade(character,'away');
    else if(character.targetKind==='seat'){
      if(!canStep(character,seatPosition(character,character.seat),player,{radius:NPC_SEATED_RADIUS})){blocked(character);return;}
      character.state='sitting';character.seatBlendTime=0;character.seatFrom={...character.position};character.seatYaw=character.visual.root.rotation.y;
    }
    else if(character.targetKind==='stairs'){
      const ascending=character.stairDestination==='upper';character.state='stairs';character.area='stairs';
      character.path=(ascending?stairs.path:[...stairs.path].reverse()).map(point=>({...point}));character.pathIndex=0;character.stairOrigin=ascending?'inside':'upper';
    }else{wait(character,range(1.4,4));character.wanderings++;}
  }
  function move(character,dt,player,threeD=false){
    let remaining=character.speed*dt,travelled=0;
    while(remaining>1e-7&&character.pathIndex<character.path.length){
      const target=character.path[character.pathIndex],dx=target.x-character.position.x,dz=target.z-character.position.z,dy=threeD?target.y-character.position.y:0;
      const length=Math.hypot(dx,dy,dz);if(length<1e-5){character.pathIndex++;continue;}
      const amount=Math.min(length,remaining),next={x:character.position.x+dx/length*amount,z:character.position.z+dz/length*amount,y:character.position.y+dy/length*amount};
      if(threeD&&player?.position&&player.zone===character.stairDestination&&Math.abs(next.y-floors[character.stairDestination])<.3&&distance(next,player.position)<playerClearance(player))break;
      if(!canStep(character,next,player)){character.blockedTime+=dt;if(!threeD&&character.blockedTime>1.6)blocked(character);break;}
      character.blockedTime=0;Object.assign(character.position,next);if(!threeD)character.position.y=height(character.area,next);
      if(Math.hypot(dx,dz)>1e-5){const yaw=Math.atan2(dx,dz);character.visual.root.rotation.y+=turn(character.visual.root.rotation.y,yaw)*Math.min(1,dt*8);}
      remaining-=amount;travelled+=amount;if(amount>=length-1e-7)character.pathIndex++;
    }
    character.walk=dt>0?Math.min(1,travelled/(character.speed*dt)):0;
    if(character.pathIndex>=character.path.length){
      if(threeD){
        const area=character.stairDestination;place(character,area==='upper'?stairs.upper:stairs.lower,area);
        if(character.role!=='server')releaseFloor(character,character.stairOrigin);stairOwner=null;stats[area==='upper'?'ascents':'descents']++;wait(character,.3);
      }else if(character.state==='walk')arrive(character,player);
    }
  }
  function stepChair(character,dt,player){
    const seat=character.seat;if(!seat){wait(character);return;}
    if(character.state==='seated'){
      character.seatTimer=Math.max(0,character.seatTimer-dt);character.seatedElapsed+=dt;if(character.seatTimer>1e-7)return;
      if(!acquireFloor(character,seat.area))return;
      if(occupied(seat.approach,seat.area,character,player)||!canStep(character,seat.approach,player)){releaseFloor(character,seat.area);return;}
      character.state='standing';character.seatBlendTime=0;character.seatFrom={...character.position};return;
    }
    const blendTime=Math.min(SEAT_BLEND_SECONDS,character.seatBlendTime+dt),t=smooth(blendTime/SEAT_BLEND_SECONDS),sitting=character.state==='sitting';
    const destination=sitting?seatPosition(character,seat):seat.approach,next={};
    for(const axis of ['x','y','z'])next[axis]=character.seatFrom[axis]+(destination[axis]-character.seatFrom[axis])*t;
    if(!canStep(character,next,player))return;
    character.seatBlendTime=blendTime;character.seated=sitting?t:1-t;Object.assign(character.position,next);
    if(sitting)character.visual.root.rotation.y=character.seatYaw+turn(character.seatYaw,seat.yaw)*t;
    if(character.seatBlendTime<SEAT_BLEND_SECONDS)return;
    if(sitting){character.state='seated';character.seatTimer=NPC_SEAT_SECONDS;character.seatedElapsed=0;character.hasSat=true;releaseFloor(character,seat.area);}
    else{character.seated=0;character.desiredFloor=seat.floor===2?1:2;releaseSeat(character);wait(character,.4);}
  }
  function stepCharacter(character,dt,player){
    if(character.role==='barista')return;character.walk=0;
    if(character.role==='server'){stepService(dt,player);return;}
    if(isChairState(character.state)){stepChair(character,dt,player);return;}
    if(character.state==='stairs'){move(character,dt,player,true);return;}
    if(yieldToArrivingPlayer(character,dt,player))return;
    if(character.state==='away'){
      character.wait-=dt;if(character.wait>0)return;
      const point=pointFor('outside',null,character,{edge:true,player});if(!point){character.wait=1;return;}
      place(character,point,'outside');character.state='fadeIn';character.fadeTime=0;character.visit=range(22,36);return;
    }
    if(character.state==='fadeOut'){
      character.fadeTime+=dt;character.opacity=1-smooth(character.fadeTime/FADE_SECONDS);
      if(character.fadeTime>=FADE_SECONDS){character.opacity=0;if(character.transfer==='away'){character.area=null;character.state='away';character.doorTicket=null;character.wait=range(5,10);stats.edgeDepartures++;}else character.state='transferWait';}return;
    }
    if(character.state==='transferWait'){
      const origin=character.area,area=origin==='inside'?'outside':'inside',point=doors[area];if(occupied(point,area,character,player))return;
      place(character,point,area);character.state='fadeIn';character.fadeTime=0;character.opacity=0;if(origin==='inside')releaseFloor(character,'inside');
      character.visit=range(18,32);character.wanderings=0;character.hasSat=false;stats.transitions++;stats[area==='inside'?'entries':'exits']++;return;
    }
    if(character.state==='fadeIn'){
      character.fadeTime+=dt;character.opacity=smooth(character.fadeTime/FADE_SECONDS);
      if(character.fadeTime>=FADE_SECONDS){character.opacity=1;if(doorOwner===character.id)doorOwner=null;character.doorTicket=null;character.doorRetryAfter=0;if(character.area==='outside')wander(character,player);else planInside(character,player);}return;
    }
    character.visit-=dt;
    if(character.state==='wait'){
      character.wait-=dt;if(character.wait>0)return;
      if(character.area!=='outside'){planInside(character,player);return;}
      if(character.visit<=0){waitForDoor(character,player);return;}wander(character,player);return;
    }
    if(character.state==='walk')move(character,dt,player);
  }
  function serviceEvent(state,busy=true){return {id:serviceOrder.id,seatId:serviceOrder.seatId,drink:serviceOrder.drink,state,busy};}
  function servedEvent(){
    server.visual.root.updateMatrixWorld(true);
    const point=(server.visual.root.getObjectByName('NPC carried cup')??server.visual.root).getWorldPosition(new THREE.Vector3());
    return {id:serviceOrder.id,seatId:serviceOrder.seatId,drink:serviceOrder.drink,from:{x:point.x,y:point.y,z:point.z}};
  }
  function emitService(state){
    if(!serviceOrder||serviceOrder.state===state)return;
    serviceOrder.state=state;onServiceState?.(serviceEvent(state));
  }
  function finishService(){
    if(!server)return;
    releaseFloor(server,'inside');releaseFloor(server,'upper');if(stairOwner===server.id)stairOwner=null;
    server.state='serviceIdle';server.path=[];server.walk=0;
    const event=serviceOrder?serviceEvent(serviceOrder.cancelled?'cancelled':'completed',false):null;
    serviceOrder=null;
    if(event)onServiceState?.(event);
  }
  function requestDrink({id,seatId,drink}={}){
    const placement=serviceSeats[seatId];
    if(disposed||!server||serviceOrder||id==null||!placement||!['coffee','tea','cocoa'].includes(drink)||claims.get(seatId)!=='player')return false;
    serviceOrder={id,seatId,drink,placement,cancelled:false,delivered:false,state:null};
    server.state='servicePreparing';server.serviceTime=0;server.wait=0;emitService('preparing');paint();return true;
  }
  function cancelDrink(id){
    if(!serviceOrder||serviceOrder.id!==id||serviceOrder.delivered||serviceOrder.cancelled)return false;
    serviceOrder.cancelled=true;emitService('cancelled');
    // Finish a stair flight visibly before turning around at its safe landing.
    if(server.state!=='stairs'){server.path=[];server.pathIndex=0;server.state='serviceWait';server.wait=0;}
    paint();return true;
  }
  function servicePath(from,to,area,player){return serviceNavigation[area].findPath(from,to,avoidFor(server,player,area,from));}
  function serviceTripClear(player){
    const target=serviceOrder.placement,area=target.floor===2?'upper':'inside';
    if(floorLease.inside!==null&&floorLease.inside!==server.id)return false;
    if(area==='upper'&&floorLease.upper!==null&&floorLease.upper!==server.id)return false;
    if(area==='inside')return servicePath(server.position,target.stop,'inside',player).length>0;
    if(!stairs||!zones.upper||!servicePath(server.position,stairs.lower,'inside',player).length||!servicePath(stairs.upper,target.stop,'upper',player).length)return false;
    let previous=stairs.path[0];
    for(const point of stairs.path){if(!canStep(server,point,player,{from:previous,area:'stairs'}))return false;previous=point;}
    return true;
  }
  function planService(player){
    const goingHome=serviceOrder.cancelled||serviceOrder.delivered;
    const destination=goingHome?'inside':serviceOrder.placement.floor===2?'upper':'inside';
    if(server.area!==destination){
      const point=server.area==='inside'?stairs.lower:stairs.upper;
      if(stairOwner!==null&&stairOwner!==server.id)return false;
      if(!go(server,point,'stairs',player))return false;
      server.stairDestination=destination;stairOwner=server.id;return true;
    }
    const point=goingHome?serviceHome:serviceOrder.placement.stop;
    if(goingHome&&distance(server.position,point)<.025){finishService();return true;}
    return go(server,point,goingHome?'serviceHome':'serviceStop',player);
  }
  function stepService(dt,player){
    if(!serviceOrder)return;
    const area=serviceOrder.placement.floor===2?'upper':'inside';
    if(!serviceOrder.cancelled&&!serviceOrder.delivered&&(player?.seatId!==serviceOrder.seatId||player?.zone!==area))cancelDrink(serviceOrder.id);
    if(!serviceOrder)return;
    if(reducedMotion){
      server.serviceTime=(server.serviceTime??0)+dt;
      if(serviceOrder.cancelled){finishService();return;}
      if(server.serviceTime>=2.5){serviceOrder.delivered=true;onServe?.(servedEvent());finishService();}
      return;
    }
    if(yieldToArrivingPlayer(server,dt,player))return;
    if(server.state==='stairs'){move(server,dt,player,true);return;}
    if(server.state==='walk'){move(server,dt,player);return;}
    if(server.state==='servicePlace'){
      const target=serviceOrder.placement,cup=target.cup??target.stop;
      const yaw=target.yaw??Math.atan2(cup.x-server.position.x,cup.z-server.position.z);
      server.visual.root.rotation.y+=turn(server.visual.root.rotation.y,yaw)*Math.min(1,dt*6);
      server.serviceTime+=dt;
      if(server.serviceTime>=1.4){
        if(!serviceOrder.cancelled&&!serviceOrder.delivered){serviceOrder.delivered=true;onServe?.(servedEvent());}
        emitService('returning');server.state='serviceWait';server.wait=.3;
      }
      return;
    }
    if(server.state==='servicePreparing'){
      server.serviceTime+=dt;if(server.serviceTime<2.5)return;
      server.state='serviceWait';emitService('waiting');
    }
    server.wait=Math.max(0,(server.wait??0)-dt);if(server.wait>0)return;
    if(!serviceOrder.cancelled&&!serviceOrder.delivered&&floorLease.inside!==server.id){
      if(!serviceTripClear(player)){server.wait=.4;return;}
      floorLease.inside=server.id;if(area==='upper')floorLease.upper=server.id;
      emitService('delivering');
    }
    if(serviceOrder.cancelled||serviceOrder.delivered){
      if(server.area==='inside'&&distance(server.position,serviceHome)<.025){finishService();return;}
      emitService(serviceOrder.cancelled?'cancelled':'returning');
    }
    if(!planService(player))server.wait=.4;
  }
  function paint(){
    stats.visible=0;stats.inside=0;stats.upstairs=0;stats.outside=0;stats.away=0;stats.seated=0;stats.doorOwner=doorOwner;stats.stairOwner=stairOwner;
    for(const character of characters){
      character.visual.root.position.set(character.position.x,character.position.y,character.position.z);
      character.visual.setOpacity(character.opacity);character.visual.setPose({walk:character.walk,seated:character.seated,time:reducedMotion?0:clock+character.id*1.713,barista:character.role==='barista',carrying:character.role==='server'&&!!serviceOrder&&!serviceOrder.delivered,serving:character.role==='server'&&character.state==='servicePlace'?smooth((character.serviceTime??0)/1.4):0,drink:serviceOrder?.drink??'coffee'});
      character.visual.root.userData.npc={id:character.id,role:character.role,area:character.area,state:character.state,opacity:character.opacity,seatId:character.seat?.id??null};
      if(character.opacity>.001)stats.visible++;if(character.state==='seated')stats.seated++;
      if(character.area==='inside')stats.inside++;else if(character.area==='upper')stats.upstairs++;else if(character.area==='outside')stats.outside++;else if(!character.area)stats.away++;
    }
    stats.states=characters.map(character=>character.id+':'+(character.area??'away')+':'+character.state).join(',');
    stats.seats=[...claims].map(([id,owner])=>id+':'+(owner==='player'?'player':'guest-'+owner)).join(',');
    stats.serviceState=serviceOrder?.state??'idle';stats.serviceOrder=serviceOrder?.id??null;
  }
  function update(delta,{enabled=true,player}={}){
    if(disposed||!enabled||(reducedMotion&&!server)||!Number.isFinite(delta)||delta<=0||delta>.5)return;
    const count=Math.max(1,Math.ceil(delta/(1/30))),dt=delta/count;
    for(let i=0;i<count;i++){clock+=dt;for(const character of characters)if(!reducedMotion||character.role==='server')stepCharacter(character,dt,player);}paint();
  }
  function isSeatAvailable(id){return !disposed&&seats.some(seat=>seat.id===id)&&!claims.has(id);}
  function reservePlayerSeat(id){
    if(disposed||!seats.some(seat=>seat.id===id)||(claims.has(id)&&claims.get(id)!=='player'))return false;
    releasePlayerSeat();claims.set(id,'player');paint();return true;
  }
  function releasePlayerSeat(){for(const [id,owner] of claims)if(owner==='player')claims.delete(id);if(!disposed)paint();}
  function dispose(){if(disposed)return;disposed=true;group.removeFromParent();for(const character of characters)character.visual.dispose();group.clear();claims.clear();stats.visible=0;}
  paint();return {group,update,dispose,stats,characters,navigation,serviceNavigation,isSeatAvailable,reservePlayerSeat,releasePlayerSeat,requestDrink,cancelDrink,get serviceState(){return serviceOrder?{id:serviceOrder.id,seatId:serviceOrder.seatId,drink:serviceOrder.drink,state:serviceOrder.state}:null;}};
}
