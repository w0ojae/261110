export const REST_MINUTES=Object.freeze([5,10,15,null]);
const drinks=new Set(['coffee','tea','cocoa']);

/** A real-time rest clock. Rendering, the scene's day and tab visibility do not own time. */
export function createRestSession({now=Date.now,onComplete}={}){
  if(typeof now!=='function')throw new TypeError('A rest session clock is required.');
  let id=0,status='idle',seatId=null,drink=null,minutes=null,durationMs=null;
  let elapsedMs=0,baseElapsed=0,startedAt=0,lastClock=-Infinity,state;
  function clock(){
    const value=now();
    if(Number.isFinite(value))lastClock=Math.max(Number.isFinite(lastClock)?lastClock:value,value);
    return Number.isFinite(lastClock)?lastClock:0;
  }
  function publish(){
    const next={id,status,seatId,drink,minutes,durationMs,elapsedMs,
      remainingMs:durationMs===null?null:Math.max(0,durationMs-elapsedMs)};
    if(!state||Object.keys(next).some(key=>next[key]!==state[key]))state=Object.freeze(next);
    return state;
  }
  function update(){
    if(status!=='running')return state;
    elapsedMs=Math.min(Number.MAX_SAFE_INTEGER,baseElapsed+Math.max(0,clock()-startedAt));
    if(durationMs!==null&&elapsedMs>=durationMs){
      elapsedMs=durationMs;baseElapsed=elapsedMs;status='completed';
      const completed=publish();onComplete?.(completed);return state;
    }
    return publish();
  }
  publish();
  return {
    start(options){
      if(status!=='idle'||!options||typeof options!=='object')return false;
      const selected=options.minutes===undefined?5:options.minutes,selectedDrink=options.drink??'coffee';
      if(typeof options.seatId!=='string'||!options.seatId.trim()||!REST_MINUTES.includes(selected)||!drinks.has(selectedDrink))return false;
      id++;seatId=options.seatId;drink=selectedDrink;minutes=selected;
      durationMs=minutes===null?null:minutes*60000;elapsedMs=0;baseElapsed=0;startedAt=clock();status='running';publish();return true;
    },
    pause(){
      update();if(status!=='running')return false;
      baseElapsed=elapsedMs;status='paused';publish();return true;
    },
    resume(){
      if(status!=='paused')return false;
      startedAt=clock();baseElapsed=elapsedMs;status='running';publish();return true;
    },
    finish(){
      if(status==='idle')return false;
      status='idle';seatId=null;drink=null;minutes=null;durationMs=null;elapsedMs=0;baseElapsed=0;publish();return true;
    },
    extend(extraMinutes=5){
      update();if(status==='idle'||durationMs===null||!Number.isFinite(extraMinutes)||extraMinutes<=0||extraMinutes>60)return false;
      durationMs+=extraMinutes*60000;minutes=durationMs/60000;baseElapsed=elapsedMs;startedAt=clock();status='running';publish();return true;
    },
    update,
    snapshot:update,
    get state(){return state;},
  };
}
