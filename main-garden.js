import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createEnvironment } from './environment-garden.js?v=45';
import { createFirstPerson } from './first-person-dissolve.js?v=41';
import { rooms } from './rooms-building2.js?v=16';
import { modelScale, sourceHeightOffset, modelPosition, buildingYOffset, groundY, rainShelter } from './building-placement.js?v=16';
import { createWalkDissolve } from './walk-dissolve.js?v=16';
import { createOutdoorZone, indoorDoor, doorIndoorSpawn, isWithinDoorTrigger } from './walk-zones.js?v=41';
import { createWindowRain } from './window-rain.js?v=52';
import { createGlassPanes } from './glass-panes.js?v=17';
import { createExteriorRain } from './weather/exterior-rain.js?v=45';
import { createWetGround } from './weather/wet-ground.js?v=45';
import { createWetMaterials } from './weather/wet-materials.js?v=45';
import { createRainRenderer } from './weather/rain-renderer.js?v=52';
import { createSoundEnvironment } from './sound-environment.js?v=45';
import { seats, findNearbySeat } from './seats-building2.js?v=21';
import { createToonShadows } from './style/toon-shadows.js?v=45';
import { createModelOutlines } from './style/model-outline.js?v=24';
import { createIntroScroll } from './intro-scroll.js?v=42';
import { createIntroApproach } from './intro-approach.js?v=30';
import { getIntroVisuals } from './intro-visuals.js?v=31';
import { createGardenBirds } from './garden-birds.js?v=33';
import { advanceDayMinutes } from './day-cycle.js?v=34';
import { createTimeTheme, getUiNightForMinutes } from './ui-time-theme.js?v=49';
import { createCafeNpcs } from './cafe-npcs.js?v=50';
import { NPC_INDOOR_FLOOR_Y, NPC_BARISTA, NPC_INDOOR_DOOR, NPC_OUTDOOR_DOOR } from './npc-placement.js?v=39';
import { NPC_DESTINATIONS } from './npc-destinations.js?v=40';
import { createWeatherCycle, weatherCaption } from './weather-cycle.js?v=45';
import { createRestSession } from './rest-session.js?v=46';
import { createCafeDrinks } from './cafe-drinks.js?v=46';
import { createCafeRestUI } from './cafe-rest-ui.js?v=47';
import { SERVICE_PLACEMENT } from './cafe-service-placement.js?v=46';
import { createScenePanels } from './scene-panels.js?v=47';
import { createCafeMusic, createYouTubeMusicPlayerFactory } from './cafe-music.js?v=51';
import { createCafeMusicUI } from './cafe-music-ui.js?v=51';
import { createRainQuality } from './rain-quality.js?v=52';
import { createRenderPerformance } from './render-performance.js?v=52';

const $ = id => document.getElementById(id);
const timeTheme = createTimeTheme(document.documentElement.style);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const introApproach = createIntroApproach(THREE,{reducedMotion});
let introVisuals = getIntroVisuals(0,{reducedMotion});
let renderer,scene,camera,controls,environment,model,frame,transition=null;
let minutes=900,weather='clear',timePlaying=true,night=0,loaded=false;
const weatherCycle=createWeatherCycle();
let climate=weatherCycle.state;
let ambient,sun,fill,interiorLights=[],windows=[],elapsed=0,last=0,firstPerson;
let toastTimer,audioContext,audioGain,audioFilter,soundEnvironment,soundOn=true;
let walkDissolve,floorVeil,currentFloor=1,windowRain,outdoorZone,doorAction=null;
let nearbySeat=null,seatPromptKey='';
let exteriorRain,wetGround,wetMaterials,rainRenderer;
let gardenBirds,cafeNpcs,cafeDrinks,restUI,scenePanels;
let cafeMusic,musicUI,musicPageAway=false;
let rainQuality,renderPerformance;
const restSession=createRestSession({onComplete:restCompleted});
let toonShadows,modelOutlines;
let ditherEnabled=true;
let intro,introBlocking=true,sceneNeedsRender=true,closing=false;
const rainAccentLights=[];
const movementStops=[];
const dayColor=new THREE.Color(),backgroundColor=new THREE.Color();
const weatherSky={clear:new THREE.Color(0xe6e9d9),cloudy:new THREE.Color(0xc9d4cc),rain:new THREE.Color(0x96aeb7)};
const dryNightColor=new THREE.Color(0x253e46),rainNightColor=new THREE.Color(0x172c3b),nightColor=new THREE.Color();
const rainFillColor=new THREE.Color(0x9fcada);
// Camera-plane corrections measured from the full garden and authored model.
// Keep world placement intact; convert these to screen offsets at each zoom.
const viewFraming={orbit:[0,.48620949],front:[.15498552,.17200233],top:[0,.19393378]};
const overviewFraming=new THREE.Vector2(...viewFraming.orbit);

intro=createIntroScroll({
  overlay:$('start-screen'),reducedMotion,
  onProgress:paintIntro,
  canInteract:event=>!walkDissolve?.active&&$('error').hidden&&!(event?.type==='keydown'&&!introBlocking&&firstPerson?.active&&event.key!=='Home'),
  onActiveChange:syncIntroState,
  onEntered:onSceneEntered,
  onReturned:()=>{if(!closing&&loaded)$('start-enter').focus({preventScroll:true});}
});

function paintIntro(progress){
  introVisuals=getIntroVisuals(progress,{reducedMotion});
  const style=document.documentElement.style;
  style.setProperty('--intro-scene-opacity',String(introVisuals.sceneOpacity));
  style.setProperty('--intro-logo-opacity',String(introVisuals.logoOpacity));
  style.setProperty('--intro-veil-opacity',String(introVisuals.veilOpacity));
  style.setProperty('--intro-logo-scale',String(introVisuals.logoScale));
  style.setProperty('--intro-logo-y',introVisuals.logoY+'px');
  style.setProperty('--intro-logo-blur',introVisuals.logoBlur+'px');
  style.setProperty('--intro-hint-opacity',String(introVisuals.hintOpacity));
}

function syncIntroState(blocked){
  if(closing)return;
  introBlocking=blocked;
  $('experience').inert=blocked;$('experience').setAttribute('aria-hidden',String(blocked));
  $('start-screen').inert=!blocked;$('start-screen').setAttribute('aria-hidden',String(!blocked));
  document.body.classList.toggle('intro-active',blocked);
  if(controls)controls.enabled=!blocked&&!firstPerson?.active;
  firstPerson?.setSuspended(blocked||Boolean(walkDissolve?.active));
  movementStops.forEach(stop=>stop());
  if(blocked){
    transition=null;
    if($('music-dialog').open)$('music-dialog').close();
    if($('experience').contains(document.activeElement))document.activeElement.blur();
    $('door-prompt').hidden=true;doorAction=null;$('seat-prompt').hidden=true;nearbySeat=null;seatPromptKey='';
  }
  syncSoundEnvironment();
  restUI?.update();
  scenePanels?.update();
  syncCafeMusic();
}

function toast(message){$('toast').textContent=message;$('toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('show'),2300);}
function paintLoadingProgress(event){
  const bytes=Number.isFinite(event.loaded)?Math.max(0,event.loaded):0;
  const knownTotal=Number.isFinite(event.total)&&event.total>0;
  // A compressed Content-Length may be smaller than the decoded byte count.
  // Reserve 100% for successful model setup, including material preparation.
  const progress=Math.min(knownTotal?99:95,Math.round(bytes/(knownTotal?event.total:10495444)*100));
  $('load-bar').style.width=progress+'%';
  $('load-progress').textContent='건물 불러오는 중 · '+progress+'%';
  $('start-status').textContent='풍경을 준비하고 있어요 · '+progress+'%';
}
function showError(error){cancelFloorDissolve();intro?.setReady(false);$('start-enter').disabled=true;$('start-status').hidden=false;$('start-status').textContent='풍경을 불러오지 못했어요';console.error(error);$('loading').hidden=true;$('error').hidden=false;syncCafeMusic();$('error-message').textContent=error.message?.includes('WebGL')?'이 브라우저에서 3D 그래픽을 사용할 수 없어요. 하드웨어 가속을 켜거나 최신 브라우저에서 열어주세요.':'건물 파일을 불러오는 중 문제가 생겼어요. 연결을 확인한 뒤 다시 시도해주세요.';}

try{
  renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(devicePixelRatio,innerWidth<=700?1.35:1.5));
  let qualityStorage;try{qualityStorage=window.localStorage;}catch{}
  rainQuality=createRainQuality({mobile:innerWidth<=700,storage:qualityStorage,onChange:syncRainQuality});
  syncRainQuality();
  renderPerformance=createRenderPerformance(renderer,{enabled:new URLSearchParams(location.search).get('profileRain')==='1'});
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure=1.12;
  $('scene').appendChild(renderer.domElement);
  floorVeil=document.createElement('div');floorVeil.id='floor-dissolve';floorVeil.setAttribute('aria-hidden','true');
  floorVeil.style.cssText='position:fixed;inset:0;background:#000;opacity:0;pointer-events:none;z-index:100';
  document.body.appendChild(floorVeil);
  walkDissolve=createWalkDissolve({reducedMotion,onBusy:setFloorBusy,onOpacity:opacity=>floorVeil.style.opacity=String(opacity),onComplete:()=>{
    if(!introBlocking&&firstPerson?.active&&!document.querySelector('dialog[open]'))renderer.domElement.focus({preventScroll:true});
  }});
  renderer.domElement.setAttribute('aria-label','건물 3D 디오라마');
  renderer.domElement.tabIndex=0;
  firstPerson=createFirstPerson({canvas:renderer.domElement,onExit:exitIndoor,onFloorChange:floor=>{
    currentFloor=floor;
    const outside=floor==='outside';
    document.body.classList.toggle('outdoor',outside);
    $('room-name').textContent=outside?'정원 산책':floor===1?'1층 카페':'2층 창가';
    $('walk-mode').textContent=outside?'실외 1인칭':'실내 1인칭';
    $('floor-options').hidden=outside;
    $('indoor-ui').setAttribute('aria-label',outside?'실외 1인칭 조작':'실내 1인칭 조작');
    $('movement-pad').setAttribute('aria-label',outside?'정원 이동':'실내 이동');
    renderer.domElement.setAttribute('aria-label',outside?'실외 1인칭 풍경. 드래그로 시선을 돌리고 WASD 또는 방향키로 걸어 다니세요. 문 가까이에서 카페로 들어갈 수 있어요. Escape로 전체 시점으로 돌아갑니다.':'실내 1인칭 풍경. 드래그로 시선을 돌리고 WASD 또는 방향키로 이동하세요. 문 가까이에서 밖으로 나갈 수 있어요. Escape로 전체 시점으로 돌아갑니다.');
    document.querySelectorAll('[data-floor]').forEach(button=>button.setAttribute('aria-pressed',String(Number(button.dataset.floor)===floor)));
    syncSoundEnvironment();
    syncSeatedUI();
  }});
  renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();cancelAnimationFrame(frame);showError(new Error('WebGL context lost'));});
  scene=new THREE.Scene();scene.background=new THREE.Color(0xe6e9d9);scene.fog=new THREE.FogExp2(0xe6e9d9,.008);
  camera=new THREE.OrthographicCamera(-15,15,15,-15,.1,180);
  controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.065;
  controls.enabled=!introBlocking;
  controls.enablePan=false;controls.minZoom=.65;controls.maxZoom=3.5;controls.minPolarAngle=.12;controls.maxPolarAngle=Math.PI*.485;controls.autoRotateSpeed=.45;
  controls.addEventListener('start',()=>{transition=null;document.querySelectorAll('[data-view]').forEach(b=>{b.classList.remove('active');b.setAttribute('aria-pressed','false');});});
  controls.addEventListener('change',updateOverviewFraming);
  ambient=new THREE.HemisphereLight(0xfff6da,0x697457,2.8);scene.add(ambient);
  sun=new THREE.DirectionalLight(0xffe2ae,3.3);sun.position.set(-12,19,11);sun.castShadow=true;
  sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-18,right:18,top:18,bottom:-18,near:.5,far:70});sun.shadow.bias=-.0004;sun.shadow.normalBias=.025;sun.shadow.radius=3;scene.add(sun);scene.add(sun.target);
  fill=new THREE.DirectionalLight(0xcce3f0,.8);fill.position.set(8,12,-10);scene.add(fill);
  environment=createEnvironment(THREE,scene,{width:11.4,depth:12,height:5.4,pathStart:3.1,groundY});
  gardenBirds=createGardenBirds(THREE,scene,{width:environment.width,depth:environment.depth,groundY,reducedMotion});
  renderer.domElement.dataset.birds='3d,daylight,random-flocks,garden-proximity';
  const weatherOptions={width:environment.width,depth:environment.depth,groundY,shelter:rainShelter,buildingYOffset,reducedMotion,mobile:innerWidth<=700};
  exteriorRain=createExteriorRain(THREE,scene,weatherOptions);
  wetGround=createWetGround(THREE,scene,weatherOptions);
  wetMaterials=createWetMaterials(THREE,{reducedMotion});wetMaterials.applyEnvironment(environment.group);
  toonShadows=createToonShadows(THREE,renderer,{cellSize:1.25});
  modelOutlines=createModelOutlines(THREE,renderer,{width:1.7,color:0x25352b});
  toonShadows.apply(environment.group);
  modelOutlines.apply(environment.group,{scope:'environment'});
  rainRenderer=createRainRenderer(THREE,renderer,scene,{rain:exteriorRain,ground:wetGround,panes:()=>windows,mobile:innerWidth<=700,
    renderScene:(activeCamera,delta,rainCapture)=>{
      if(windowRain)windowRain.render(activeCamera,delta,{enabled:firstPerson?.active&&(climate.rain>.001||climate.wetness>.001),intensity:climate.rain,wetness:climate.wetness,rainCapture});
      else{rainCapture?.beforeFinal();renderer.render(scene,activeCamera);}
    }});
  for(const [color,x,y,z,power] of [[0xffbd79,0,1.85,2.9,12],[0x8ecfe5,3.7,3.4,-1.5,5]]){
    const light=new THREE.PointLight(color,0,10,2);light.position.set(x,y+buildingYOffset,z);light.userData.rainPower=power;scene.add(light);rainAccentLights.push(light);
  }
  resize();setView('orbit',false);syncWeatherUI();updateTime();
  restUI=createCafeRestUI({session:restSession,seats,placement:SERVICE_PLACEMENT,
    getNpcs:()=>cafeNpcs,getDrinks:()=>cafeDrinks,getView:restView,takeSeat:takeRestSeat,toast,canvas:renderer.domElement});
  restUI.update();
  scenePanels=createScenePanels({getView:restView});
  let musicStorage;try{musicStorage=window.localStorage;}catch{}
  cafeMusic=createCafeMusic({storage:musicStorage,getContext:musicContext,
    createPlayer:createYouTubeMusicPlayerFactory({host:$('music-engine')}),onChange:()=>musicUI?.update()});
  musicUI=createCafeMusicUI({music:cafeMusic,canvas:renderer.domElement});
  syncCafeMusic();
  new GLTFLoader().load('./assets/building2.glb',gltf=>{
    try{
      model=new THREE.Group();
      // Normalize the GLB export origin inside the shared placement parent.
      gltf.scene.position.y-=sourceHeightOffset;
      gltf.scene.traverse(obj=>{
        if(!obj.isMesh)return;
        // Keep the revision's authored materials and local transforms intact.
        obj.castShadow=true;obj.receiveShadow=true;
      });
      model.add(gltf.scene);
      const glassMaterial=new THREE.MeshPhysicalMaterial({color:0xe7f0e5,roughness:.075,metalness:0,transparent:true,opacity:.18,transmission:.62,thickness:.025,ior:1.45,reflectivity:.3,clearcoat:1,clearcoatRoughness:.08,side:THREE.DoubleSide,depthWrite:false});
      windows=createGlassPanes(THREE,model,glassMaterial);
      model.scale.setScalar(modelScale);model.position.copy(modelPosition);scene.add(model);
      outdoorZone=createOutdoorZone(THREE,environment,model);
      wetMaterials.applyModel(model);
      windowRain=createWindowRain(THREE,renderer,scene,windows,{reducedMotion,visibilityBlockers:[model],onError:error=>{
        console.error('Window rain:',error);toast('창문 빗방울을 불러오지 못했어요. 잠시 후 새로고침해주세요.');
      }});
      const bulbMaterial=new THREE.MeshStandardMaterial({color:0xfff0d0,emissive:0xffc37b,emissiveIntensity:.4,roughness:.5});
      // Front view: +X is right and +Z is forward, clear of the counter sign.
      for(const [x,y,z] of [[1.25,3.36,-2.25],[.2,6.35,-2.8]]){
        const light=new THREE.PointLight(0xffc17a,0,7,2);light.position.set(x,y-.13,z);model.add(light);interiorLights.push(light);
        const bulb=new THREE.Mesh(new THREE.CylinderGeometry(.25,.25,.055,24),bulbMaterial);bulb.position.set(x,y,z);model.add(bulb);
      }
      // Style opaque models only; the shared wet-window material and water maps
      // retain their original rendering and physics on both sides of the glass.
      toonShadows.apply(model);
      modelOutlines.apply(model,{scope:'model'});
      cafeNpcs=createCafeNpcs(THREE,scene,{
        indoorZone:rooms[1],outdoorZone,indoorFloorY:NPC_INDOOR_FLOOR_Y,destinations:NPC_DESTINATIONS,guestCount:6,
        barista:NPC_BARISTA,indoorDoor:NPC_INDOOR_DOOR,outdoorDoor:NPC_OUTDOOR_DOOR,reducedMotion,
        styleCharacter:root=>{toonShadows.apply(root);modelOutlines.apply(root,{scope:'npc'});},
        servicePlacement:SERVICE_PLACEMENT,onServe:event=>restUI?.onServe(event),onServiceState:event=>restUI?.onServiceState(event),
      });
      cafeDrinks=createCafeDrinks(THREE,scene,{placements:SERVICE_PLACEMENT,reducedMotion,
        style:root=>{toonShadows.apply(root);modelOutlines.apply(root,{scope:'drink'});}});
      renderer.domElement.dataset.npcs='8,barista-server-and-6-visitors,seats-and-stairs';
      renderer.domElement.dataset.modelStyle='outline-all-models,toon-shadow-dither';
      loaded=true;$('enter-indoor').disabled=false;$('enter-indoor').title='건물 안에서 창문 너머를 둘러보세요';$('load-bar').style.width='100%';$('load-progress').textContent='준비 완료 · 100%';$('loading').classList.add('loaded');setTimeout(()=>$('loading').hidden=true,550);
      sceneNeedsRender=true;$('start-status').textContent='준비 완료 · 100%';$('start-status').hidden=false;$('start-enter').disabled=false;intro.setReady(true);
      updateTime();
    }catch(error){showError(error);}
  },paintLoadingProgress,showError);
  frame=requestAnimationFrame(animate);
}catch(error){showError(error);}

function resize(){
  sceneNeedsRender=true;
  const width=innerWidth,height=innerHeight,aspect=width/height,mobile=width<=620;
  const half=mobile?Math.max(15,12.4/aspect):height<650?12.6:12.3;
  camera.left=-half*aspect;camera.right=half*aspect;camera.top=half;camera.bottom=-half;
  updateOverviewFraming();firstPerson?.resize(width,height);renderer.setSize(width,height);
}

function updateOverviewFraming(){
  if(!camera)return;
  const width=innerWidth,height=innerHeight;
  camera.clearViewOffset();
  camera.setViewOffset(width,height,
    overviewFraming.x*camera.zoom*width/(camera.right-camera.left),
    overviewFraming.y*camera.zoom*height/(camera.top-camera.bottom),width,height);
  camera.updateProjectionMatrix();
}

function enterIndoor(floor=1){
  if(introBlocking)return;
  if(!loaded||!firstPerson){toast('건물을 불러온 뒤 들어갈 수 있어요');return;}
  cancelFloorDissolve();
  restUI?.pauseForLeave();releaseUnusedSeat();
  transition=null;controls.enabled=false;firstPerson.enter(floor,rooms[floor]);
  syncSoundEnvironment();
  syncSeatedUI();
  document.body.classList.add('indoor');$('indoor-ui').hidden=false;$('enter-indoor').setAttribute('aria-pressed','true');
  renderer.domElement.focus({preventScroll:true});
  toast('문 가까이에서 밖으로 나갈 수 있어요');
}

function exitIndoor(){
  cancelFloorDissolve();
  restUI?.pauseForLeave();
  firstPerson?.exit();if(controls)controls.enabled=!introBlocking;
  releaseUnusedSeat();
  syncSoundEnvironment();
  syncSeatedUI();
  document.body.classList.remove('indoor','outdoor');$('indoor-ui').hidden=true;$('door-prompt').hidden=true;doorAction=null;$('enter-indoor').setAttribute('aria-pressed','false');
  $('seat-prompt').hidden=true;nearbySeat=null;seatPromptKey='';
  renderer?.domElement.setAttribute('aria-label','건물 3D 디오라마');
  $('enter-indoor').focus({preventScroll:true});
}

function setFloorBusy(busy){
  firstPerson?.setSuspended(busy||introBlocking);
  $('intro-return').disabled=busy;
  if(floorVeil)floorVeil.style.pointerEvents=busy?'auto':'none';
  $('indoor-ui').setAttribute('aria-busy',String(busy));
  document.querySelectorAll('[data-floor],[data-move],#door-action,#seat-action').forEach(button=>button.disabled=busy);
  movementStops.forEach(stop=>stop());
  if(busy){$('door-prompt').hidden=true;doorAction=null;$('seat-prompt').hidden=true;nearbySeat=null;seatPromptKey='';}
}

function cancelFloorDissolve(){
  walkDissolve?.cancel();
  if(!firstPerson?.seated)releaseUnusedSeat();
}

function switchFloor(floor){
  if(!firstPerson?.active||firstPerson.seated||currentFloor==='outside'||walkDissolve?.active||floor===currentFloor||!rooms[floor])return;
  walkDissolve.start(()=>firstPerson.setFloor(floor,rooms[floor]));
}

function availableDoorAction(){
  if(introBlocking||!firstPerson?.active||firstPerson.seated||walkDissolve?.active||document.querySelector('dialog[open]'))return null;
  const door=currentFloor===1?indoorDoor:currentFloor==='outside'?outdoorZone?.door:null;
  if(!door)return null;
  const position=firstPerson.camera.position;
  return isWithinDoorTrigger(position,door)?(currentFloor===1?'leave':'enter'):null;
}

function updateDoorPrompt(){
  const action=availableDoorAction();
  if(action===doorAction)return;
  doorAction=action;$('door-prompt').hidden=!action;
  if(action){
    $('door-caption').textContent=action==='leave'?'입구 · 정원으로 이어지는 문':'입구 · 작은 카페';
    $('door-action').textContent=action==='leave'?'외부로 나가기':'카페로 들어가기';
  }
}

function useDoor(){
  const action=availableDoorAction();
  if(!action||!outdoorZone)return;
  walkDissolve.start(()=>{
    const outside=action==='leave';
    firstPerson.setFloor(outside?'outside':1,outside?outdoorZone:doorIndoorSpawn);
  });
}

function syncSeatedUI(){
  const seated=Boolean(firstPerson?.seated);
  const outside=currentFloor==='outside';
  document.body.classList.toggle('seated',seated);
  $('floor-options').hidden=outside||seated;
  $('movement-pad').hidden=seated;
  document.querySelector('.crosshair').hidden=seated;
  $('walk-mode').textContent=seated?'앉아서 감상 중':outside?'실외 1인칭':'실내 1인칭';
  document.querySelector('.desktop-help').textContent=seated?'마우스 드래그로 둘러보기 · 일어나기로 이동 재개':'마우스 드래그로 시선 · WASD / 방향키로 이동 · Esc 전체 보기';
  document.querySelector('.touch-help').textContent=seated?'화면을 드래그해 위아래와 좌우를 둘러보세요':'화면을 드래그해 둘러보고, 화살표로 이동하세요';
  if(seated)renderer.domElement.setAttribute('aria-label','창가 의자에 앉아 감상하는 풍경. 드래그로 시선을 위아래와 좌우로 움직일 수 있어요. 뒤를 돌아보지 않도록 회전 범위가 제한됩니다. 일어나기로 이동을 다시 시작하고 Escape로 전체 시점으로 돌아갑니다.');
  else if(firstPerson?.active)renderer.domElement.setAttribute('aria-label',outside?'실외 1인칭 풍경. 드래그로 시선을 돌리고 WASD 또는 방향키로 걸어 다니세요. 문 가까이에서 카페로 들어갈 수 있어요. Escape로 전체 시점으로 돌아갑니다.':'실내 1인칭 풍경. 드래그로 시선을 돌리고 WASD 또는 방향키로 이동하세요. 의자 가까이에서 앉아 쉬고 문 가까이에서 밖으로 나갈 수 있어요. Escape로 전체 시점으로 돌아갑니다.');
  restUI?.update();
  scenePanels?.update();
  syncCafeMusic();
}

function updateSeatPrompt(){
  const available=!introBlocking&&firstPerson?.active&&!walkDissolve?.active&&!document.querySelector('dialog[open]');
  const seated=Boolean(firstPerson?.seated);
  nearbySeat=available&&!seated?findNearbySeat(firstPerson.camera.position,currentFloor):null;
  const seat=available?(seated?seats.find(candidate=>candidate.id===firstPerson.seatId):nearbySeat):null;
  const occupied=Boolean(seat&&!seated&&cafeNpcs&&!cafeNpcs.isSeatAvailable(seat.id)&&restUI?.reservedSeatId!==seat.id);
  $('seat-action').disabled=Boolean(walkDissolve?.active||occupied);
  const key=`${seat?.id||''}:${seated}:${occupied}`;
  if(key===seatPromptKey)return;
  seatPromptKey=key;$('seat-prompt').hidden=!seat;
  if(seat){$('seat-caption').textContent=seat.label;$('seat-action').textContent=seated?'일어나기':occupied?'손님 이용 중':'앉기';}
}

function useSeat(){
  if(introBlocking||!firstPerson?.active||walkDissolve?.active||document.querySelector('dialog[open]'))return;
  const standingUp=firstPerson.seated;
  const seat=standingUp?null:findNearbySeat(firstPerson.camera.position,currentFloor);
  if(!standingUp&&!seat)return;
  if(!standingUp&&cafeNpcs&&!cafeNpcs.reservePlayerSeat(seat.id)){toast('손님이 이용 중인 자리예요');return;}
  const started=walkDissolve.start(()=>{
    let changed=false;
    // Input stays covered by the veil; allow only this synchronous camera swap.
    firstPerson.setSuspended(false);
    try{changed=standingUp?firstPerson.stand():firstPerson.sit(seat);}
    finally{firstPerson.setSuspended(true);if(!firstPerson.seated)releaseUnusedSeat();}
    syncSeatedUI();
    if(!changed)toast('의자 가까이에서 다시 시도해주세요.');
  });
  if(!started&&!standingUp)releaseUnusedSeat();
}

function releaseUnusedSeat(){if(!restUI?.holdsSeatClaim)cafeNpcs?.releasePlayerSeat();}

function restView(){return {active:!!firstPerson?.active,seated:!!firstPerson?.seated,seatId:firstPerson?.seatId??null,
  busy:!!walkDissolve?.active,introBlocked:introBlocking};}

function takeRestSeat(seat){
  if(!loaded||introBlocking||walkDissolve?.active||!firstPerson||!rooms[seat.floor])return false;
  if(firstPerson.seated&&firstPerson.seatId===seat.id)return true;
  const previous=restUI?.reservedSeatId;
  if(!cafeNpcs?.reservePlayerSeat(seat.id)){toast('손님이 이용 중인 자리예요. 다른 자리를 골라주세요.');return false;}
  const started=walkDissolve.start(()=>{
    let changed=false;firstPerson.setSuspended(false);
    try{
      const zone={...rooms[seat.floor],spawn:{...seat.approach}};
      if(firstPerson.active)firstPerson.setFloor(seat.floor,zone);else firstPerson.enter(seat.floor,zone);
      controls.enabled=false;transition=null;
      changed=firstPerson.sit(seat);
      document.body.classList.add('indoor');$('indoor-ui').hidden=false;$('enter-indoor').setAttribute('aria-pressed','true');
    }finally{firstPerson.setSuspended(true);if(!changed)releaseUnusedSeat();}
    syncSeatedUI();syncSoundEnvironment();
    if(!changed)toast('이 자리에 앉지 못했어요. 다시 선택해주세요.');
  });
  if(!started){if(previous)cafeNpcs.reservePlayerSeat(previous);else cafeNpcs.releasePlayerSeat();}
  return started;
}

function restCompleted(){
  if(!closing&&!document.hidden&&!introBlocking){
    toast('잘 쉬었어요. 조금 더 머물러도 좋아요.');
    if(soundOn&&audioContext?.state==='running'){
      try{
        const bell=audioContext.createOscillator(),gain=audioContext.createGain(),now=audioContext.currentTime;
        bell.type='sine';bell.frequency.value=660;gain.gain.setValueAtTime(.001,now);
        gain.gain.linearRampToValueAtTime(.025,now+.03);gain.gain.exponentialRampToValueAtTime(.001,now+.65);
        bell.connect(gain);gain.connect(audioContext.destination);bell.start(now);bell.stop(now+.7);
      }catch{}
    }
  }
}

function setView(view,animateView=true){
  if(!camera)return;
  const target=new THREE.Vector3(0,1.5,0);
  const positions={orbit:new THREE.Vector3(17,14,23),front:new THREE.Vector3(1,9,29),top:new THREE.Vector3(1,31,.8)};
  const destination=positions[view]||positions.orbit;
  const framing=new THREE.Vector2(...(viewFraming[view]||viewFraming.orbit));
  if(animateView&&!reducedMotion)transition={start:performance.now(),from:camera.position.clone(),to:destination,fromTarget:controls.target.clone(),target,zoom:camera.zoom,fromFraming:overviewFraming.clone(),framing};
  else{camera.position.copy(destination);controls.target.copy(target);camera.zoom=1;overviewFraming.copy(framing);updateOverviewFraming();controls.update();}
  document.querySelectorAll('[data-view]').forEach(button=>{const active=button.dataset.view===view;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));});
}

function updateTime(){
  const hour=minutes/60;
  const daylight=Math.max(0,Math.sin((hour-6)/12*Math.PI));
  const twilight=Math.max(0,1-Math.abs(hour-18)/1.8)+Math.max(0,1-Math.abs(hour-6)/1.4);
  night=1-THREE.MathUtils.smoothstep(daylight,0,.35);
  dayColor.copy(weatherSky.clear).lerp(weatherSky.cloudy,climate.cloudiness).lerp(weatherSky.rain,climate.rain);
  nightColor.copy(dryNightColor).lerp(rainNightColor,climate.rain);
  backgroundColor.copy(dayColor).lerp(new THREE.Color(0xe7bda1),Math.min(1,twilight)*(.65-.47*climate.rain)).lerp(nightColor,night);
  scene.background.copy(backgroundColor);scene.fog.color.copy(backgroundColor);
  scene.fog.density=.008+climate.rain*(.01+night*.008);
  const cloudy=1-.52*climate.cloudiness-.23*climate.rain;
  sun.intensity=(.12+3.4*daylight)*cloudy;
  sun.color.set(0xffedcd).lerp(new THREE.Color(0xffa164),Math.min(1,twilight));
  const angle=(hour-6)/12*Math.PI;sun.position.set(Math.cos(angle)*19,4+Math.max(0,Math.sin(angle))*22,10);
  ambient.intensity=.55+2*daylight;ambient.color.set(0xe5eff1).lerp(new THREE.Color(0x97b9cf),night);
  ambient.intensity*=1-.23*climate.rain;
  ambient.groundColor.set(0x768460).lerp(new THREE.Color(0x465e57),night);
  fill.intensity=.3+daylight*.45;
  fill.color.set(0xcce3f0).lerp(rainFillColor,climate.rain);
  renderer.toneMappingExposure=THREE.MathUtils.lerp(1.07+night*.23,1.02+night*.06,climate.rain);
  interiorLights.forEach((light,index)=>{light.intensity=(index===0?7:9)*night+.22;});
  rainAccentLights.forEach(light=>{light.intensity=climate.rain*(.05+night)*light.userData.rainPower;});
  toonShadows?.setConditions({weather,night,rainAmount:climate.rain});
  timeTheme.setNight(getUiNightForMinutes(minutes));
  $('time').value=String(Math.round(minutes));
  const h=Math.floor(minutes/60),m=Math.floor(minutes%60);$('time-display').textContent=String(h).padStart(2,'0')+':'+String(m).padStart(2,'0');
  $('time').setAttribute('aria-valuetext',$('time-display').textContent);
  $('mood').textContent=hour<5||hour>=21?'별빛이 머무는 밤':hour<8?'하루가 시작되는 아침':hour<12?'싱그러운 오전':hour<16?'느긋한 오후':hour<19.5?'노을이 내려앉는 시간':'불빛이 반가운 저녁';
  $('weather-caption').textContent=weatherCaption(climate,night);
  syncSoundEnvironment();
}

function syncWeatherUI(){
  document.querySelectorAll('[data-weather]').forEach(button=>{
    const active=button.dataset.weather===climate.target;
    if(button.getAttribute('aria-pressed')!==String(active)){button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));}
  });
  const button=$('weather-auto');
  button.textContent=climate.auto?'자동 ON':'자동 OFF';
  button.setAttribute('aria-pressed',String(climate.auto));
  button.setAttribute('aria-label',climate.auto?'날씨 자동 전환 끄기':'날씨 자동 전환 켜기');
  button.dataset.target=climate.target;button.dataset.transitioning=String(climate.transitioning);
  if(renderer){
    renderer.domElement.dataset.weatherRain=climate.rain.toFixed(3);
    renderer.domElement.dataset.weatherWetness=climate.wetness.toFixed(3);
    renderer.domElement.dataset.weatherCloudiness=climate.cloudiness.toFixed(3);
  }
}

function setWeather(key,options){
  if(!weatherCycle.select(key,options))return;
  climate=weatherCycle.state;weather=climate.key;syncWeatherUI();updateTime();
}

function syncRainQuality(){
  if(!rainQuality)return;
  const {mode,effective}=rainQuality.state,labels={low:'낮음',medium:'보통',high:'높음'};
  $('rain-quality').value=mode;
  $('rain-quality').title=mode==='auto'?'자동 조절 중 · '+labels[effective]:'비 효과 품질 · '+labels[effective];
  $('rain-quality-status').textContent=mode==='auto'?'자동 · '+labels[effective]:labels[effective];
  if(renderer){renderer.domElement.dataset.rainQuality=mode;renderer.domElement.dataset.rainQualityEffective=effective;}
}

function animate(timestamp){
  frame=requestAnimationFrame(animate);
  restUI?.update();
  scenePanels?.update();
  if(document.hidden){last=timestamp;return;}
  const frameMs=timestamp-last;
  const delta=Math.min(.05,frameMs/1000||0);last=timestamp;
  intro.update(delta);
  timeTheme.update(delta);
  // Keep the logo/white-light phase on the compositor without repeated GPU
  // scene work. Warm one frame for assets/resize and retain weather/water state.
  if(introVisuals.sceneOpacity===0&&!sceneNeedsRender)return;
  rainQuality?.sample(frameMs,{active:!!firstPerson?.active&&(climate.rain>.001||climate.wetness>.001),
    blocked:introBlocking||!!walkDissolve?.active||!!document.querySelector('dialog[open]'),context:currentFloor});
  renderPerformance?.begin();
  sceneNeedsRender=false;elapsed+=delta;
  const weatherChanged=weatherCycle.update(delta,{enabled:!introBlocking});
  if(weatherChanged){climate=weatherCycle.state;weather=climate.key;syncWeatherUI();}
  if(timePlaying&&!introBlocking){minutes=advanceDayMinutes(minutes,delta);updateTime();}
  else if(weatherChanged)updateTime();
  if(transition){const t=Math.min(1,(timestamp-transition.start)/1000),k=t*t*(3-2*t);camera.position.lerpVectors(transition.from,transition.to,k);controls.target.lerpVectors(transition.fromTarget,transition.target,k);camera.zoom=THREE.MathUtils.lerp(transition.zoom,1,k);overviewFraming.lerpVectors(transition.fromFraming,transition.framing,k);updateOverviewFraming();if(t===1)transition=null;}
  if(firstPerson?.active)firstPerson.update(delta);else if(!introBlocking)controls.update();
  walkDissolve?.update(delta);
  updateDoorPrompt();
  updateSeatPrompt();
  environment?.update(reducedMotion?0:elapsed,reducedMotion?0:delta,weather,night,climate);
  gardenBirds?.update(reducedMotion?0:elapsed,reducedMotion?0:delta,{minutes});
  cafeNpcs?.update(delta,{enabled:!introBlocking&&!walkDissolve?.active,
    player:firstPerson?.active?
      {position:firstPerson.camera.position,zone:currentFloor===1?'inside':currentFloor===2?'upper':'outside',seatId:firstPerson.seatId,clearance:firstPerson.seated ? .62 : undefined}:null});
  cafeDrinks?.update(delta,{visible:!!restUI?.visibleDrink});
  if(cafeNpcs){
    const summary=JSON.stringify(cafeNpcs.stats);
    if(renderer.domElement.dataset.npcState!==summary)renderer.domElement.dataset.npcState=summary;
  }
  const visibleBirds=String(gardenBirds?.stats.visibleBirds??0);
  if(renderer.domElement.dataset.birdsVisible!==visibleBirds)renderer.domElement.dataset.birdsVisible=visibleBirds;
  const flightsStarted=String(gardenBirds?.stats.flightsStarted??0);
  if(renderer.domElement.dataset.birdsFlights!==flightsStarted)renderer.domElement.dataset.birdsFlights=flightsStarted;
  const flocksStarted=String(gardenBirds?.stats.flocksStarted??0);
  if(renderer.domElement.dataset.birdsFlocks!==flocksStarted)renderer.domElement.dataset.birdsFlocks=flocksStarted;
  const lastFlockSize=String(gardenBirds?.stats.lastFlockSize??0);
  if(renderer.domElement.dataset.birdsLastFlock!==lastFlockSize)renderer.domElement.dataset.birdsLastFlock=lastFlockSize;
  const activeCamera=firstPerson?.active?firstPerson.camera:camera;
  const rainState={enabled:climate.rain>.001||climate.wetness>.001,intensity:climate.rain,wetness:climate.wetness,night,camera:activeCamera,quality:rainQuality?.state.settings};
  exteriorRain?.update(reducedMotion?0:elapsed,delta,rainState);
  wetGround?.update(reducedMotion?0:elapsed,delta,rainState);
  wetMaterials?.update(reducedMotion?0:elapsed,delta,rainState);
  // A temporary lens change brings the garden forward without moving authored
  // objects or changing the saved orbit zoom. First-person views keep their lens.
  introApproach.render(activeCamera,introVisuals.approachProgress,()=>{
    if(rainRenderer)rainRenderer.render(activeCamera,delta,rainState);
    else renderer.render(scene,activeCamera);
  });
  renderPerformance?.end({view:firstPerson?.active?String(currentFloor):'world',rain:climate.rain.toFixed(2),quality:rainQuality?.state.effective});
}

function musicContext(){return {indoor:!!firstPerson?.active&&(currentFloor===1||currentFloor===2),
  entered:!introBlocking&&!closing&&$('error').hidden,visible:!document.hidden&&!musicPageAway};}

function syncCafeMusic(){cafeMusic?.sync();}

function syncSoundEnvironment(){
  soundEnvironment?.update({weather,rainAmount:climate.rain,enabled:soundOn&&!introBlocking,indoor:Boolean(firstPerson?.active&&(currentFloor===1||currentFloor===2))});
}

function syncSoundButton(){
  const state=soundOn?(audioContext?.state??'pending'):'off';
  $('sound').dataset.audioState=state;
  $('sound').setAttribute('aria-pressed',String(soundOn));
  $('sound').setAttribute('aria-label',!soundOn?'자연 소리 켜기':state==='running'?'자연 소리 끄기':'자연 소리 시작');
}

function ensureAudio(){
  if(!audioContext){
    const AudioContext=window.AudioContext||window.webkitAudioContext;if(!AudioContext)throw new Error('Audio unavailable');
    audioContext=new AudioContext();audioGain=audioContext.createGain();audioGain.gain.value=0;audioGain.connect(audioContext.destination);
    audioFilter=audioContext.createBiquadFilter();audioFilter.type='lowpass';audioFilter.frequency.value=600;audioFilter.Q.value=.5;audioFilter.connect(audioGain);
    soundEnvironment=createSoundEnvironment(audioContext,{filter:audioFilter,gain:audioGain});
    const length=audioContext.sampleRate*4,buffer=audioContext.createBuffer(1,length,audioContext.sampleRate),data=buffer.getChannelData(0);let previous=0;
    for(let i=0;i<length;i++){previous=(previous+Math.random()*.04-.02)/1.02;data[i]=previous*3;}
    const noise=audioContext.createBufferSource();noise.buffer=buffer;noise.loop=true;noise.connect(audioFilter);noise.start();
    const lfo=audioContext.createOscillator(),lfoGain=audioContext.createGain();lfo.frequency.value=.16;lfoGain.gain.value=180;lfo.connect(lfoGain);lfoGain.connect(audioFilter.frequency);lfo.start();
    audioContext.addEventListener('statechange',syncSoundButton);
  }
  return audioContext;
}

async function resumeSound({announceFailure=false}={}){
  if(closing||!soundOn)return;
  try{
    const context=ensureAudio();syncSoundEnvironment();
    // Call resume during the input event, before any await or entry animation.
    const resumed=context.resume();syncSoundButton();
    await resumed;
    if(!closing){syncSoundEnvironment();syncSoundButton();}
  }catch{syncSoundButton();if(announceFailure)toast('이 브라우저에서는 소리를 재생할 수 없어요.');}
}

function unlockDefaultSound(event){
  if(!loaded||closing||!soundOn||event.isTrusted===false||event.target?.closest?.('#sound'))return;
  if(event.type==='keydown'&&(event.key==='Escape'||event.ctrlKey||event.metaKey||event.altKey))return;
  if(audioContext?.state!=='running')void resumeSound();
}

function onSceneEntered(){
  if(closing)return;
  renderer?.domElement.focus({preventScroll:true});
  if(soundOn){
    void resumeSound();
    if(audioContext?.state==='suspended')toast('자연 소리를 시작하려면 화면을 한 번 눌러주세요.');
  }
}

function toggleSound(){
  if(soundOn&&audioContext?.state!=='running'){void resumeSound({announceFailure:true});return;}
  soundOn=!soundOn;syncSoundEnvironment();syncSoundButton();
  if(soundOn)void resumeSound({announceFailure:true});
  toast(soundOn?'자연 소리를 켰어요':'자연 소리를 껐어요');
}

addEventListener('resize',()=>{if(renderer&&camera)resize();});
for(const type of ['pointerdown','pointerup','touchend','keydown'])document.addEventListener(type,unlockDefaultSound,{capture:true,passive:true});
$('start-enter').addEventListener('click',()=>{if(soundOn)void resumeSound();intro.setProgress(1);});
$('intro-return').addEventListener('click',()=>{if(!walkDissolve?.active&&!document.querySelector('dialog[open]'))intro.setProgress(0);});
document.addEventListener('keydown',event=>{if(introBlocking&&firstPerson?.active&&event.key==='Escape'){event.preventDefault();event.stopPropagation();}},true);
$('time').addEventListener('input',event=>{minutes=Number(event.target.value);updateTime();});
document.querySelectorAll('[data-time]').forEach(button=>button.addEventListener('click',()=>{minutes=Number(button.dataset.time);updateTime();}));
document.querySelectorAll('[data-weather]').forEach(button=>button.addEventListener('click',()=>setWeather(button.dataset.weather)));
$('weather-auto').addEventListener('click',()=>{weatherCycle.setAuto(!climate.auto);climate=weatherCycle.state;syncWeatherUI();toast(climate.auto?'날씨가 천천히 자동으로 바뀌어요':'선택한 날씨를 유지해요');});
document.querySelectorAll('[data-view]').forEach(button=>button.addEventListener('click',()=>setView(button.dataset.view)));
$('time-play').addEventListener('click',()=>{timePlaying=!timePlaying;$('time-play').textContent=timePlaying?'Ⅱ':'▶';$('time-play').setAttribute('aria-pressed',String(timePlaying));$('time-play').setAttribute('aria-label',timePlaying?'시간 자동 흐름 끄기':'시간 자동 흐름 켜기');toast(timePlaying?'5분 동안 하루가 흘러요':'이 순간에 잠깐 머물러요');});
$('rotate').addEventListener('click',()=>{controls.autoRotate=!controls.autoRotate;$('rotate').setAttribute('aria-pressed',String(controls.autoRotate));$('rotate').setAttribute('aria-label',controls.autoRotate?'자동 회전 끄기':'자동 회전 켜기');});
$('sound').addEventListener('click',toggleSound);
$('dither-toggle').addEventListener('click',()=>{
  ditherEnabled=!ditherEnabled;
  toonShadows?.setDitherEnabled(ditherEnabled);
  $('dither-toggle').setAttribute('aria-pressed',String(ditherEnabled));
  $('dither-toggle').setAttribute('aria-label',ditherEnabled?'디더링 끄기':'디더링 켜기');
  $('dither-toggle').textContent=ditherEnabled?'디더링 ON':'디더링 OFF';
});
$('fullscreen').addEventListener('click',async()=>{try{if(!document.fullscreenElement)await document.documentElement.requestFullscreen();else await document.exitFullscreen();}catch{toast('전체 화면은 별도 브라우저에서 사용할 수 있어요.');}});
document.addEventListener('fullscreenchange',()=>$('fullscreen').setAttribute('aria-pressed',String(!!document.fullscreenElement)));
$('reset').addEventListener('click',()=>{if(firstPerson?.active)exitIndoor();minutes=900;setWeather('clear',{immediate:true});setView('orbit');controls.autoRotate=false;$('rotate').setAttribute('aria-pressed','false');$('rotate').setAttribute('aria-label','자동 회전 켜기');if(timePlaying)$('time-play').click();toast('처음의 오후 풍경으로 돌아왔어요');});
$('enter-indoor').addEventListener('click',()=>enterIndoor(1));
$('exit-indoor').addEventListener('click',exitIndoor);
$('door-action').addEventListener('click',useDoor);
$('seat-action').addEventListener('click',useSeat);
document.querySelectorAll('[data-floor]').forEach(button=>button.addEventListener('click',()=>switchFloor(Number(button.dataset.floor))));
document.querySelectorAll('[data-move]').forEach(button=>{
  let pointer=null,timer;
  const stop=()=>{clearTimeout(timer);firstPerson?.setMove(button.dataset.move,false);button.classList.remove('pressed');pointer=null;};
  movementStops.push(stop);
  button.addEventListener('pointerdown',event=>{event.preventDefault();pointer=event.pointerId;button.setPointerCapture?.(pointer);firstPerson?.setMove(button.dataset.move,true);button.classList.add('pressed');});
  button.addEventListener('pointerup',stop);button.addEventListener('pointercancel',stop);button.addEventListener('lostpointercapture',stop);
  button.addEventListener('click',event=>{if(event.detail===0){clearTimeout(timer);firstPerson?.setMove(button.dataset.move,true);timer=setTimeout(stop,180);}});
});
$('info').addEventListener('click',()=>$('about').showModal());$('close-info').addEventListener('click',()=>$('about').close());$('about').addEventListener('click',e=>{if(e.target===$('about')){const r=$('about').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)$('about').close();}});
$('reload').addEventListener('click',()=>location.reload());
$('rain-quality').addEventListener('change',event=>{rainQuality?.setMode(event.target.value);syncRainQuality();});
document.addEventListener('visibilitychange',()=>{rainQuality?.reset();syncCafeMusic();restUI?.update();scenePanels?.update();if(audioContext){if(document.hidden)audioContext.suspend().catch(()=>{});else if(soundOn)void resumeSound();}});
addEventListener('pagehide',event=>{musicPageAway=true;syncCafeMusic();if(!event.persisted){closing=true;renderPerformance?.dispose();musicUI?.dispose();cafeMusic?.dispose();scenePanels?.dispose();restUI?.dispose();cafeDrinks?.dispose();intro?.dispose();gardenBirds?.dispose();cafeNpcs?.dispose();rainRenderer?.dispose();exteriorRain?.dispose();wetGround?.dispose();windowRain?.dispose();modelOutlines?.dispose();toonShadows?.dispose();wetMaterials?.dispose();}});

addEventListener('pageshow',event=>{if(event.persisted){musicPageAway=false;rainQuality?.reset();syncCafeMusic();}});
