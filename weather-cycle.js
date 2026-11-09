const levels={clear:0,cloudy:1,rain:2};
const clamp=value=>Math.max(0,Math.min(1,value));
const smooth=value=>value*value*(3-2*value);
const defaultHolds={clear:[40,70],cloudy:[20,35],rain:[40,65]};

// One scalar crosses overcast before rain can start, including manual jumps.
// No timers, rendering, allocations of particles, or wall-clock catch-up.
export function createWeatherCycle({random=Math.random,auto=true,holdRanges=defaultHolds,transitionRange=[16,24],manualSeconds=10}={}){
  const unit=()=>{const value=random();return Number.isFinite(value)?clamp(value):.5;};
  const range=([low,high])=>Math.max(.01,low+(high-low)*unit());
  const holdFor=key=>range(holdRanges[key]??defaultHolds[key]);
  let severity=0,wetness=0,target='clear',origin=0,elapsed=0,duration=0,hold=holdFor('clear');
  let automatic=!!auto,state;
  function publish(){
    const rain=clamp(severity-1),cloudiness=clamp(severity);
    const next={severity,cloudiness,rain,wetness,target,auto:automatic,transitioning:duration>0,
      key:rain>.001?'rain':cloudiness>.001?'cloudy':'clear'};
    if(!state||Object.keys(next).some(key=>next[key]!==state[key]))state=Object.freeze(next);
  }
  function select(key,{immediate=false,seconds=manualSeconds}={}){
    if(!Object.hasOwn(levels,key))return false;
    if(!immediate&&target===key&&duration>0)return false;
    target=key;origin=severity;elapsed=0;
    if(immediate){severity=levels[key];wetness=clamp(severity-1);duration=0;hold=holdFor(key);}
    else if(Math.abs(levels[key]-severity)<1e-10){duration=0;hold=holdFor(key);}
    else duration=Number.isFinite(seconds)?Math.max(.01,seconds):manualSeconds;
    publish();return true;
  }
  function nextWeather(){return target==='clear'?'cloudy':target==='rain'?'cloudy':unit()<.42?'clear':'rain';}
  function update(delta,{enabled=true}={}){
    if(!enabled||!Number.isFinite(delta)||delta<=0)return false;
    const previous=state;
    // Small bounded integration also keeps residual water consistent across FPS.
    let remaining=Math.min(delta,300);
    while(remaining>1e-9){
      if(!duration&&automatic&&hold<=1e-9){select(nextWeather(),{seconds:range(transitionRange)});continue;}
      const dt=Math.min(remaining,1/30,duration?duration-elapsed:automatic?hold:remaining);
      if(dt<=1e-9){if(duration){severity=levels[target];duration=0;hold=holdFor(target);}else hold=0;continue;}
      if(duration){
        elapsed=Math.min(duration,elapsed+dt);
        severity=origin+(levels[target]-origin)*smooth(elapsed/duration);
        if(duration-elapsed<1e-8){severity=levels[target];duration=0;hold=holdFor(target);}
      }else if(automatic)hold=Math.max(0,hold-dt);
      const rain=clamp(severity-1);
      wetness=Math.max(rain,wetness-dt/22);
      if(wetness<.001&&rain===0)wetness=0;
      remaining-=dt;
    }
    publish();return state!==previous;
  }
  publish();
  return {select,update,setAuto(value){automatic=!!value;hold=holdFor(target);publish();},get state(){return state;}};
}

export function weatherCaption(state,night=0){
  if(state.transitioning){
    if(state.target==='rain')return state.rain>.05?'빗줄기가 짙어지는 중':'비구름이 모이는 중';
    if(state.rain>.01)return '비가 서서히 그치는 중';
    return state.target==='clear'?'하늘이 맑아지는 중':'구름 낀 하늘로 바뀌는 중';
  }
  return {clear:night>.5?'고요한 밤하늘':'맑은 하늘',cloudy:'구름 낀 하늘',rain:'촉촉한 빗소리'}[state.key];
}
