import {createRainPane} from './rain/simulation.js?v=45';
import {createRainWindow} from './rain/window-material.js?v=52';
import {createPaneVisibility} from './rain/pane-visibility.js?v=52';

// Logical glass sizes are fixed in model space: moving the camera or resizing
// the viewport must never move, stretch or reseed the water on a pane.
const pixelsPerModelUnit=256;

export function createWindowRain(THREE,renderer,scene,panes,{reducedMotion=false,onError=console.error,visibilityBlockers=[]}={}){
  // One water body per outer glass surface, shared by views from both sides.
  const entries=panes.map((pane,index)=>({pane,index,original:pane.material,simulation:null,window:null,pending:null,failed:false}));
  const dryMaterial=panes[0].material.clone();dryMaterial.transmission=0;
  const visibilityTest=createPaneVisibility(THREE,renderer,panes,{opaqueRoots:visibilityBlockers});
  const frustum=new THREE.Frustum(),projection=new THREE.Matrix4(),bufferSize=new THREE.Vector2();
  const hdr=renderer.extensions.has('EXT_color_buffer_float')?THREE.HalfFloatType:THREE.UnsignedByteType;
  let capture,blurA,blurB,lens,disposed=false,active=false;
  const stats={opaqueDraws:0,overlayDraws:0,sharedOpaque:false,captureWidth:0,captureHeight:0};
  const canvas=renderer.domElement;
  function record(key,value){if(canvas.dataset[key]!==value)canvas.dataset[key]=value;}
  function report(ready=[],candidates=[],visible=candidates){
    const ids=ready.map(entry=>entry.index).join(',');
    const revision=ready.map(entry=>`${entry.index}:${entry.simulation.map.revision||0}`).join(',');
    record('rainPanes',ids);
    record('rainRevision',revision);
    record('rainVisibility',visibilityTest.stats.supported?'gpu-occlusion':'frustum');
    record('rainCpuOccluded',String(visibilityTest.stats.cpuOccluded??0));
    record('rainBlockers',String(visibilityTest.stats.blockers??0));
    record('rainCandidates',candidates.map(entry=>entry.index).join(','));
    record('rainOccluded',candidates.filter(entry=>!visible.includes(entry)).map(entry=>entry.index).join(','));
    record('rainStoredRevision',entries.filter(entry=>entry.simulation).map(entry=>`${entry.index}:${entry.simulation.map.revision||0}`).join(','));
    record('rainOpaqueDraws',String(stats.opaqueDraws));
    record('rainOverlayDraws',String(stats.overlayDraws));
    record('rainCaptureSize',`${stats.captureWidth}x${stats.captureHeight}`);
    record('rainPipeline',stats.sharedOpaque?'opaque-reuse':'direct');
  }
  const quadCamera=new THREE.OrthographicCamera(-1,1,1,-1,0,1);
  const quadScene=new THREE.Scene();
  const filterMaterial=new THREE.ShaderMaterial({
    uniforms:{source:{value:null},stepUV:{value:new THREE.Vector2()}},
    vertexShader:'varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
    fragmentShader:`uniform sampler2D source;uniform vec2 stepUV;varying vec2 vUv;
      void main(){vec3 c=texture2D(source,vUv).rgb*.227027;
      c+=(texture2D(source,vUv+stepUV*1.384615).rgb+texture2D(source,vUv-stepUV*1.384615).rgb)*.316216;
      c+=(texture2D(source,vUv+stepUV*3.230769).rgb+texture2D(source,vUv-stepUV*3.230769).rgb)*.070270;
      gl_FragColor=vec4(c,1.);}`,
    depthTest:false,depthWrite:false,toneMapped:false
  });
  const quad=new THREE.Mesh(new THREE.PlaneGeometry(2,2),filterMaterial);quad.frustumCulled=false;quadScene.add(quad);
  const copyMaterial=new THREE.ShaderMaterial({
    uniforms:{source:{value:null}},vertexShader:filterMaterial.vertexShader,
    fragmentShader:'uniform sampler2D source;varying vec2 vUv;void main(){gl_FragColor=texture2D(source,vUv);}',
    depthTest:false,depthWrite:false,toneMapped:false,
  });
  // The scene's full-resolution MSAA color/depth remain in the final target.
  // A separate optics target is safe to sample while drawing the wet panes.
  const depthCopyMaterial=new THREE.ShaderMaterial({
    name:'Rain optics color and depth copy',
    uniforms:{source:{value:null},sourceDepth:{value:null}},vertexShader:filterMaterial.vertexShader,
    fragmentShader:'uniform sampler2D source;uniform sampler2D sourceDepth;varying vec2 vUv;void main(){gl_FragColor=texture2D(source,vUv);gl_FragDepth=texture2D(sourceDepth,vUv).r;}',
    depthTest:true,depthFunc:THREE.AlwaysDepth,depthWrite:true,toneMapped:false,blending:THREE.NoBlending,
  });
  function target(width,height,depth=false){
    const t=new THREE.WebGLRenderTarget(width,height,{type:hdr,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,depthBuffer:depth,stencilBuffer:false});
    if(depth)t.depthTexture=new THREE.DepthTexture(width,height,THREE.UnsignedIntType);
    t.texture.colorSpace=THREE.LinearSRGBColorSpace;return t;
  }
  function resizeTargets(quality={}){
    renderer.getDrawingBufferSize(bufferSize);
    // The scene is captured once, shared by every pane; blur is entirely GPU work.
    const captureScale=Number.isFinite(quality.captureScale)?Math.max(.25,Math.min(1,quality.captureScale)):1;
    const limit=Number.isFinite(quality.maxCaptureSize)?Math.max(256,Math.min(4096,quality.maxCaptureSize)):1600;
    const scale=Math.min(1,limit/Math.max(bufferSize.x,bufferSize.y))*captureScale;
    const w=Math.max(1,Math.round(bufferSize.x*scale)),h=Math.max(1,Math.round(bufferSize.y*scale));
    const bw=Math.max(1,Math.round(w/3)),bh=Math.max(1,Math.round(h/3));
    const lh=Math.max(1,Math.round(96*h/w));
    if(!capture){capture=target(w,h,true);blurA=target(bw,bh);blurB=target(bw,bh);lens=target(96,lh);}
    else if(capture.width!==w||capture.height!==h){capture.setSize(w,h);blurA.setSize(bw,bh);blurB.setSize(bw,bh);lens.setSize(96,lh);}
    stats.captureWidth=w;stats.captureHeight=h;
  }
  function start(entry,intensity){
    if(entry.pending||entry.failed||entry.simulation||disposed)return;
    const {width:w,height:h}=entry.pane.geometry.parameters;
    const width=Math.max(1,Math.round(w*pixelsPerModelUnit)),height=Math.max(1,Math.round(h*pixelsPerModelUnit));
    entry.pending=createRainPane({width,height,intensity}).then(simulation=>{
      if(disposed){simulation.dispose();return;}
      entry.simulation=simulation;entry.window=createRainWindow(THREE,simulation);
    }).catch(error=>{entry.failed=true;onError(error);}).finally(()=>{entry.pending=null;});
  }
  function filter(source,destination,x=0,y=0){
    quad.material=filterMaterial;
    filterMaterial.uniforms.source.value=source;
    filterMaterial.uniforms.stepUV.value.set(x,y);
    renderer.setRenderTarget(destination);renderer.render(quadScene,quadCamera);
  }
  function render(camera,delta,{enabled=false,intensity=1,wetness=1,rainCapture,quality}={}){
    stats.opaqueDraws=0;stats.overlayDraws=0;stats.sharedOpaque=false;stats.captureWidth=0;stats.captureHeight=0;
    if(disposed){rainCapture?.beforeFinal();renderer.render(scene,camera);return;}
    intensity=Math.max(0,Math.min(1,Number.isFinite(intensity)?intensity:1));
    wetness=Math.max(0,Math.min(1,Number.isFinite(wetness)?wetness:1));
    active=enabled;
    // Restore ordinary glass immediately on leaving first-person or rainy weather.
    for(const entry of entries)entry.pane.material=enabled?dryMaterial:entry.original;
    if(!enabled){visibilityTest.reset();for(const entry of entries)entry.simulation?.setActive(false);stats.opaqueDraws=1;report();rainCapture?.beforeFinal();renderer.render(scene,camera);return;}
    scene.updateMatrixWorld();camera.updateMatrixWorld();
    projection.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);frustum.setFromProjectionMatrix(projection);
    // Outdoor walking can see windows on either floor. Visibility comes from
    // the camera and opaque scene depth, never the selected indoor room.
    const candidates=entries.filter(entry=>entry.pane.visible&&frustum.intersectsObject(entry.pane));
    const visiblePanes=visibilityTest.select(camera,candidates.map(entry=>entry.pane));
    const visible=candidates.filter(entry=>visiblePanes.includes(entry.pane));
    for(const entry of visible)start(entry,intensity);
    const ready=visible.filter(entry=>entry.simulation&&entry.window);
    for(const entry of entries)if(!ready.includes(entry))entry.simulation?.setActive(false);
    if(!ready.length){stats.opaqueDraws=1;report(ready,candidates,visible);rainCapture?.beforeFinal();visibilityTest.render(camera,()=>renderer.render(scene,camera));return;}
    resizeTargets(quality??rainCapture?.quality);
    for(const entry of ready){
      entry.simulation.setIntensity(intensity);
      entry.simulation.setActive(!reducedMotion);entry.simulation.update(delta);
      entry.pane.material=entry.window.material;
    }
    const previousTarget=renderer.getRenderTarget(),shadowAuto=renderer.shadowMap.autoUpdate,shadowNeeds=renderer.shadowMap.needsUpdate;
    const sharedOpaque=rainCapture?.opaqueTarget===previousTarget&&Boolean(previousTarget?.depthTexture);
    stats.sharedOpaque=sharedOpaque;
    const visibility=entries.map(entry=>entry.pane.visible);
    const extraHidden=(rainCapture?.hide||[]).map(object=>[object,object.visible]);
    const viewport=renderer.getViewport(new THREE.Vector4()),scissor=renderer.getScissor(new THREE.Vector4()),scissorTest=renderer.getScissorTest();
    try{
      for(const entry of entries)entry.pane.visible=false;
      for(const [object] of extraHidden)object.visible=false;
      renderer.setScissorTest(false);
      if(sharedOpaque){
        // Render original models, outlines, lights and shadows at final resolution
        // exactly once. Neither water shader can sample this attachment later.
        renderer.render(scene,camera);stats.opaqueDraws++;
        renderer.shadowMap.autoUpdate=false;renderer.shadowMap.needsUpdate=false;
        depthCopyMaterial.uniforms.source.value=previousTarget.texture;
        depthCopyMaterial.uniforms.sourceDepth.value=previousTarget.depthTexture;
        quad.material=depthCopyMaterial;
        renderer.setRenderTarget(capture);renderer.render(quadScene,quadCamera);
      }else{
        // Standalone callers without an owned, sampleable final depth target keep
        // the original capture/final path rather than losing depth or MSAA.
        renderer.shadowMap.autoUpdate=false;renderer.shadowMap.needsUpdate=false;
        renderer.setRenderTarget(capture);renderer.render(scene,camera);stats.opaqueDraws++;
      }
      if(rainCapture){
        rainCapture.onOpaqueCaptured({texture:capture.texture,width:capture.width,height:capture.height});
        for(const [object,visible] of extraHidden)object.visible=visible;
        rainCapture.renderRain();
      }
      filter(capture.texture,blurA,1.2/blurA.width,0);
      filter(blurA.texture,blurB,0,1.2/blurA.height);
      copyMaterial.uniforms.source.value=capture.texture;quad.material=copyMaterial;
      renderer.setRenderTarget(lens);renderer.render(quadScene,quadCamera);
    }finally{
      entries.forEach((entry,index)=>{entry.pane.visible=visibility[index];});
      for(const [object,visible] of extraHidden)object.visible=visible;
      renderer.shadowMap.autoUpdate=shadowAuto;renderer.shadowMap.needsUpdate=shadowNeeds;
      renderer.setRenderTarget(previousTarget);renderer.setViewport(viewport);renderer.setScissor(scissor);renderer.setScissorTest(scissorTest);
    }
    for(const entry of ready)entry.window.update(capture.texture,{width:bufferSize.x,height:bufferSize.y},{blurTexture:blurB.texture,lensTexture:lens.texture,depthTexture:capture.depthTexture,projectionInverse:camera.projectionMatrixInverse,depthMargin:.06,wetness});
    rainCapture?.beforeFinal();
    if(sharedOpaque){
      // Layers suppress model draws without hiding their children: synthetic panes
      // and ground/pane probes can be nested below otherwise opaque meshes.
      const masks=[],allowed=new Set(entries.map(entry=>entry.pane));
      for(const [object] of extraHidden)object.traverse(child=>allowed.add(child));
      const background=scene.background,autoClear=renderer.autoClear;
      try{
        scene.traverse(object=>{
          if(!(object.isMesh||object.isLine||object.isPoints||object.isSprite)||allowed.has(object)||
              object.userData.rainVisibilityProbe||object.userData.groundReflectionProbe)return;
          masks.push([object,object.layers.mask]);object.layers.mask=0;
        });
        scene.background=null;renderer.autoClear=false;
        renderer.shadowMap.autoUpdate=false;renderer.shadowMap.needsUpdate=false;
        visibilityTest.render(camera,()=>renderer.render(scene,camera));stats.overlayDraws++;
      }finally{
        for(const [object,mask] of masks)object.layers.mask=mask;
        scene.background=background;renderer.autoClear=autoClear;
        renderer.shadowMap.autoUpdate=shadowAuto;renderer.shadowMap.needsUpdate=shadowNeeds;
      }
    }else{visibilityTest.render(camera,()=>renderer.render(scene,camera));stats.opaqueDraws++;}
    rainCapture?.onWindowRendered?.(stats);
    report(ready,candidates,visible);
  }
  function dispose(){
    disposed=true;active=false;
    visibilityTest.dispose();
    for(const entry of entries){entry.pane.material=entry.original;entry.window?.dispose();entry.simulation?.dispose();}
    for(const t of [capture,blurA,blurB,lens])t?.dispose();quad.geometry.dispose();filterMaterial.dispose();copyMaterial.dispose();depthCopyMaterial.dispose();
    dryMaterial.dispose();
  }
  return {render,dispose,stats,get visibilityStats(){return visibilityTest.stats;},get active(){return active;}};
}
