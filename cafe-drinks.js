export const CAFE_DRINKS=Object.freeze([
  Object.freeze({id:'coffee',label:'커피'}),Object.freeze({id:'tea',label:'차'}),Object.freeze({id:'cocoa',label:'코코아'}),
]);
const recipes={coffee:{cup:0xe6dfcd,liquid:0x493225},tea:{cup:0x9baa91,liquid:0x9b6f39},cocoa:{cup:0xb58f7b,liquid:0x684331}};
const clamp=value=>Math.max(0,Math.min(1,value));
const point=value=>value&&['x','y','z'].every(axis=>Number.isFinite(value[axis]));
const STEAM_SECONDS=600;

/** One reusable personal drink and prebuilt, normally hidden side tables. */
export function createCafeDrinks(THREE,scene,{style,reducedMotion=false,placements,now=Date.now}={}){
  const group=new THREE.Group();group.name='Window rest drink';scene.add(group);group.visible=false;
  const cup=new THREE.Group();cup.name='Personal café cup';cup.scale.setScalar(.5);group.add(cup);
  const tables=new Map(),geometries=new Set(),materials=new Set();
  const ownGeometry=value=>{geometries.add(value);return value;};
  const ownMaterial=value=>{materials.add(value);return value;};
  const surface=(color,roughness=.91)=>ownMaterial(new THREE.MeshStandardMaterial({color,roughness,metalness:0,flatShading:true}));
  const ceramic=surface(recipes.coffee.cup),liquidSurface=surface(recipes.coffee.liquid,.62);
  const wood=surface(0x8a6b50),legSurface=surface(0x59604e);
  const unitCylinder=ownGeometry(new THREE.CylinderGeometry(1,1,1,12));
  const bodyGeometry=ownGeometry(new THREE.LatheGeometry([
    new THREE.Vector2(0,.015),new THREE.Vector2(.046,.015),new THREE.Vector2(.054,.025),
    new THREE.Vector2(.067,.15),new THREE.Vector2(.057,.15),new THREE.Vector2(.048,.035),new THREE.Vector2(0,.035),
  ],14));
  const handleGeometry=ownGeometry(new THREE.TorusGeometry(.038,.009,5,12));
  function mesh(parent,name,geometry,material,scale,position){
    const object=new THREE.Mesh(geometry,material);object.name=name;object.castShadow=false;object.receiveShadow=true;
    if(scale)object.scale.set(...scale);if(position)object.position.set(...position);parent.add(object);return object;
  }
  const saucer=mesh(cup,'Drink saucer',unitCylinder,ceramic,[.093,.01,.093],[0,.005,0]);
  const body=mesh(cup,'Drink cup',bodyGeometry,ceramic);
  const handle=mesh(cup,'Drink handle',handleGeometry,ceramic,null,[.073,.086,0]);
  const liquid=mesh(cup,'Drink surface',unitCylinder,liquidSurface,[.051,.004,.051],[0,.135,0]);
  const steam=[];
  for(let index=0;index<3;index++){
    const points=[];
    for(let i=0;i<=8;i++){const t=i/8;points.push(new THREE.Vector3(Math.sin(t*Math.PI*2+index*1.7)*.009,.17+t*.13,(index-1)*.016));}
    const geometry=ownGeometry(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),10,.0017,4,false));
    const material=ownMaterial(new THREE.MeshBasicMaterial({color:0xf5f1df,transparent:true,opacity:0,depthWrite:false,toneMapped:false}));
    const ribbon=mesh(cup,'Cup steam '+(index+1),geometry,material);ribbon.userData.outline=false;ribbon.renderOrder=6;steam.push(ribbon);
  }
  const placementMap=placements?.seats??placements??{};
  for(const [id,placement] of Object.entries(placementMap)){
    const table=placement?.table;if(!point(table?.position)||!Number.isFinite(table.height)||table.height<=.04)continue;
    const radius=Number.isFinite(table.radius)?Math.max(.06,table.radius):.105;
    const tableGroup=new THREE.Group();tableGroup.name='Rest side table '+id;tableGroup.position.set(table.position.x,table.position.y,table.position.z);tableGroup.visible=false;
    group.add(tableGroup);
    mesh(tableGroup,'Rest tabletop',unitCylinder,wood,[radius,.018,radius],[0,-.009,0]);
    const base=point(table.basePosition)?new THREE.Vector3(table.basePosition.x-table.position.x,table.basePosition.y-table.position.y,table.basePosition.z-table.position.z):new THREE.Vector3(0,-table.height,0);
    const foot=mesh(tableGroup,'Rest table foot',unitCylinder,legSurface,[.069,.009,.069],[base.x,base.y+.0045,base.z]);
    const supportTop=new THREE.Vector3(0,-.02,0),supportBottom=base.clone().add(new THREE.Vector3(0,.012,0));
    const direction=supportTop.clone().sub(supportBottom),length=direction.length();
    const support=mesh(tableGroup,'Rest table support',unitCylinder,legSurface,[.013,length,.013]);
    support.position.copy(supportTop).add(supportBottom).multiplyScalar(.5);support.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),direction.normalize());
    tables.set(id,tableGroup);void foot;
  }
  try{style?.(group);}catch(error){
    group.removeFromParent();for(const geometry of geometries)geometry.dispose();for(const material of materials)material.dispose();throw error;
  }
  let disposed=false,activeSeat=null,visible=true,servedAt=0,age=0,animationTime=0,placement=null;
  const stats={served:false,visible:false,tableVisible:false,placing:false,id:null,seatId:null,drink:null,sipsRemaining:0,fillFraction:0,steamOpacity:0,ageSeconds:0,tables:tables.size,geometries:geometries.size};
  function paint(){
    group.visible=!disposed&&visible&&activeSeat!==null;
    for(const [id,table] of tables)table.visible=id===activeSeat;
    cup.visible=stats.served&&activeSeat===stats.seatId;
    stats.visible=group.visible&&cup.visible;stats.tableVisible=group.visible&&tables.has(activeSeat);
    stats.placing=placement!==null;
    liquid.visible=stats.fillFraction>0;
    liquid.position.y=.038+.097*stats.fillFraction;
    const heat=Math.pow(1-clamp(age/STEAM_SECONDS),1.4)*Math.sqrt(stats.fillFraction);
    stats.steamOpacity=stats.served?heat*.26:0;stats.ageSeconds=age;
    for(let i=0;i<steam.length;i++){
      const ribbon=steam[i];ribbon.visible=stats.steamOpacity>.001;
      ribbon.material.opacity=stats.steamOpacity*(.74+.26*Math.sin(animationTime*1.4+i*2)**2);
      ribbon.position.y=reducedMotion?0:((animationTime*.022+i*.026)%.075);
      ribbon.position.x=reducedMotion?0:Math.sin(animationTime*.8+i*2)*.004;
    }
    group.userData.drink={id:stats.id,seatId:stats.seatId,drink:stats.drink,sipsRemaining:stats.sipsRemaining};
  }
  function showSeat(seatId){
    if(disposed||typeof seatId!=='string'||!seatId)return false;
    if(Object.keys(placementMap).length&&!Object.hasOwn(placementMap,seatId))return false;
    activeSeat=seatId;paint();return true;
  }
  function serve({id,seatId,drink,position,yaw=0,from}={}){
    if(disposed||id===undefined||id===null||typeof seatId!=='string'||!Object.hasOwn(recipes,drink)||!point(position)||(stats.served&&stats.id===id))return false;
    if(!showSeat(seatId))return false;
    stats.served=true;stats.id=id;stats.seatId=seatId;stats.drink=drink;stats.sipsRemaining=3;stats.fillFraction=1;
    const time=now();servedAt=Number.isFinite(time)?time:0;age=0;animationTime=0;
    placement=point(from)&&!reducedMotion?{from:new THREE.Vector3(from.x,from.y,from.z),to:new THREE.Vector3(position.x,position.y,position.z),elapsed:0}:null;
    if(placement)cup.position.copy(placement.from);else cup.position.set(position.x,position.y,position.z);
    cup.rotation.set(0,Number.isFinite(yaw)?yaw:0,0);
    for(const object of [saucer,body,handle])object.material.color.setHex(recipes[drink].cup);
    liquid.material.color.setHex(recipes[drink].liquid);paint();return true;
  }
  function sip(){
    if(disposed||!stats.served||!visible||placement||stats.sipsRemaining<=0||activeSeat!==stats.seatId)return false;
    stats.sipsRemaining--;stats.fillFraction=stats.sipsRemaining/3;paint();return true;
  }
  function clear(){
    if(disposed)return;
    stats.served=false;stats.id=null;stats.seatId=null;stats.drink=null;stats.sipsRemaining=0;stats.fillFraction=0;age=0;activeSeat=null;placement=null;paint();
  }
  function update(delta,{elapsedSeconds,visible:nextVisible=true}={}){
    if(disposed)return;
    visible=!!nextVisible;
    if(stats.served){
      const time=now(),elapsed=Number.isFinite(elapsedSeconds)?Math.max(0,elapsedSeconds):Number.isFinite(time)?Math.max(0,(time-servedAt)/1000):age;
      age=Math.max(age,elapsed);
    }
    if(visible&&!reducedMotion&&Number.isFinite(delta)&&delta>0){
      const dt=Math.min(.1,delta);animationTime=(animationTime+dt)%3600;
      if(placement){
        placement.elapsed=Math.min(.65,placement.elapsed+dt);const t=placement.elapsed/.65,eased=t*t*(3-2*t);
        cup.position.copy(placement.from).lerp(placement.to,eased);cup.position.y+=Math.sin(t*Math.PI)*.055;
        if(placement.elapsed>=.65){cup.position.copy(placement.to);placement=null;}
      }
    }
    paint();
  }
  function dispose(){
    if(disposed)return;disposed=true;group.removeFromParent();group.clear();
    for(const geometry of geometries)geometry.dispose();for(const material of materials)material.dispose();tables.clear();
    stats.served=false;stats.visible=false;stats.tableVisible=false;stats.steamOpacity=0;stats.placing=false;placement=null;
  }
  paint();return {group,cup,showSeat,serve,sip,clear,update,dispose,stats};
}
