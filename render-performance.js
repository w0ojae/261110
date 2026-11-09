// Opt-in diagnostics: ?profileRain=1. No timer queries or counters in normal use.
// The DOM summary lets browser QA compare the entire multipass frame, rather
// than accidentally counting only the final fullscreen postprocess draw.
export function createRenderPerformance(renderer,{enabled=false,clock=()=>performance.now()}={}){
  if(!enabled)return {begin(){},end(){},dispose(){}};
  const info=renderer.info,oldAutoReset=info.autoReset;info.autoReset=false;
  const canvas=renderer.domElement;let gl,ext,active=null,pending=[],started=0,lastEnd=null,windowStart=null;
  let frames=0,intervals=0,cpu=0,calls=0,triangles=0,maxFrame=0,gpu=0,gpuCount=0,disposed=false;
  try{gl=renderer.getContext();ext=gl.getExtension('EXT_disjoint_timer_query_webgl2');}catch{}
  function drain(){
    if(!ext)return;
    try{
      const disjoint=gl.getParameter(ext.GPU_DISJOINT_EXT);
      if(disjoint){
        for(const query of pending)gl.deleteQuery(query);
        pending=[];gpu=0;gpuCount=0;return;
      }
      pending=pending.filter(query=>{
        if(!gl.getQueryParameter(query,gl.QUERY_RESULT_AVAILABLE))return true;
        if(!disjoint){gpu+=gl.getQueryParameter(query,gl.QUERY_RESULT)/1e6;gpuCount++;}
        gl.deleteQuery(query);return false;
      });
    }catch{ext=null;}
  }
  return {
    begin(){
      if(disposed)return;drain();info.reset();started=clock();
      if(ext&&pending.length<4)try{active=gl.createQuery();if(active)gl.beginQuery(ext.TIME_ELAPSED_EXT,active);}catch{
        if(active)try{gl.deleteQuery(active);}catch{}active=null;ext=null;
      }
    },
    end(context={}){
      if(disposed)return;
      if(active){try{gl.endQuery(ext.TIME_ELAPSED_EXT);pending.push(active);}catch{}active=null;}
      const now=clock();cpu+=Math.max(0,now-started);calls+=info.render.calls;triangles+=info.render.triangles;frames++;
      if(lastEnd!==null){maxFrame=Math.max(maxFrame,now-lastEnd);intervals++;}lastEnd=now;
      if(windowStart===null)windowStart=now;
      if(now-windowStart<1500)return;
      const summary={...context,frames,fps:Number((intervals*1000/(now-windowStart)).toFixed(1)),
        cpuMs:Number((cpu/frames).toFixed(2)),gpuMs:gpuCount?Number((gpu/gpuCount).toFixed(2)):null,
        calls:Math.round(calls/frames),triangles:Math.round(triangles/frames),maxFrameMs:Number(maxFrame.toFixed(1))};
      canvas.dataset.rainPerformance=JSON.stringify(summary);
      windowStart=now;frames=0;intervals=0;cpu=0;calls=0;triangles=0;maxFrame=0;gpu=0;gpuCount=0;
    },
    dispose(){
      if(disposed)return;disposed=true;info.autoReset=oldAutoReset;
      if(active)try{gl.endQuery(ext.TIME_ELAPSED_EXT);gl.deleteQuery(active);}catch{}
      for(const query of pending)try{gl.deleteQuery(query);}catch{}pending=[];
    },
  };
}
