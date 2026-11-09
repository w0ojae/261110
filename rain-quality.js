const MODES=new Set(['auto','low','medium','high']);
const LEVELS=['low','medium','high'];
const STORAGE_KEY='lazy-day-rain-quality-v1';
const PRESETS=Object.freeze({
  low:Object.freeze({captureScale:.65,maxCaptureSize:960,samples:0}),
  medium:Object.freeze({captureScale:.85,maxCaptureSize:1280,samples:2}),
  high:Object.freeze({captureScale:1,maxCaptureSize:1600,samples:4}),
});

// Only optical captures and rain-target antialiasing vary. Camera, canvas,
// logical water coordinates, drop populations and the 30 Hz physics stay fixed.
export function createRainQuality({mobile=false,storage,onChange}={}){
  let mode='auto',level=mobile?0:1,elapsed=0,total=0,frames=0,bad=0,good=0,severe=0,warmup=2000,lastContext;
  try{const saved=storage?.getItem(STORAGE_KEY);if(MODES.has(saved))mode=saved;}catch{}
  const high=mobile?Object.freeze({...PRESETS.high,samples:2}):PRESETS.high;
  const settings=()=>{const key=mode==='auto'?LEVELS[level]:mode;return key==='high'?high:PRESETS[key];};
  const state=()=>Object.freeze({mode,effective:mode==='auto'?LEVELS[level]:mode,settings:settings()});
  function reset(){elapsed=0;total=0;frames=0;bad=0;good=0;severe=0;warmup=2000;}
  function publish(){onChange?.(state());}
  return {
    get state(){return state();},
    setMode(value){
      if(!MODES.has(value))return false;if(value===mode)return true;
      mode=value;reset();try{storage?.setItem(STORAGE_KEY,mode);}catch{}publish();return true;
    },
    sample(frameMs,{active=false,blocked=false,context}={}){
      if(mode!=='auto')return;
      if(!active||blocked||context!==lastContext||!Number.isFinite(frameMs)||frameMs<=0){
        lastContext=context;reset();return;
      }
      // Ignore an isolated loading/GC stall, but still rescue a device that
      // continuously renders below 8 FPS instead of restarting warmup forever.
      if(frameMs>120){
        severe++;elapsed=0;total=0;frames=0;bad=0;good=0;
        if(severe>=8&&level>0){level--;reset();publish();}
        return;
      }
      severe=0;
      if(warmup>0){warmup-=frameMs;return;}
      elapsed+=frameMs;total+=frameMs;frames++;
      if(elapsed<1000)return;
      const mean=total/frames;elapsed=0;total=0;frames=0;
      bad=mean>23?bad+1:0;good=mean<17.5?good+1:0;
      if(level>0&&(bad>=2||mean>38)){
        level--;reset();warmup=4000;publish();
      }else if(level<(mobile?1:2)&&good>=12){
        level++;reset();warmup=6000;publish();
      }
    },
    reset,
  };
}
