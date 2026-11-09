const VIDEO_ID=/^[A-Za-z0-9_-]{11}$/;
const STORAGE_KEY='lazy-day-cafe-music-v1';
const clampVolume=value=>Math.max(0,Math.min(100,value));
const abortError=()=>Object.assign(new Error('Music loading cancelled'),{name:'AbortError'});

export function parseYouTubeLink(value){
  if(typeof value!=='string')return null;
  let input=value.trim(),id;
  if(VIDEO_ID.test(input))id=input;
  else{
    if(/^(?:www\.|m\.|music\.)?(?:youtube\.com|youtu\.be)\//i.test(input))input='https://'+input;
    let url;try{url=new URL(input);}catch{return null;}
    if(!['http:','https:'].includes(url.protocol)||url.username||url.password)return null;
    const host=url.hostname.toLowerCase(),parts=url.pathname.split('/').filter(Boolean);
    if(host==='youtu.be'||host==='www.youtu.be'){
      if(parts.length!==1)return null;id=parts[0];
    }else if(['youtube.com','www.youtube.com','m.youtube.com','music.youtube.com','youtube-nocookie.com','www.youtube-nocookie.com'].includes(host)){
      if(url.pathname==='/watch')id=url.searchParams.get('v');
      else if(parts.length===2&&['embed','shorts','live'].includes(parts[0]))id=parts[1];
    }
  }
  return VIDEO_ID.test(id??'')?Object.freeze({videoId:id,url:'https://www.youtube.com/watch?v='+id}):null;
}

function defaultStorage(){try{return globalThis.localStorage;}catch{return null;}}
const errorMessage=code=>({
  2:'유튜브 링크를 다시 확인해주세요.',
  5:'이 영상은 현재 브라우저에서 재생할 수 없어요.',
  100:'삭제되었거나 비공개인 영상이에요.',
  101:'다른 웹사이트에서 재생할 수 없는 영상이에요.',
  150:'다른 웹사이트에서 재생할 수 없는 영상이에요.',
  153:'유튜브에서 이 페이지의 재생 요청을 확인하지 못했어요.',
}[code]??'유튜브 음악을 불러오지 못했어요. 잠시 후 다시 시도해주세요.');

/** Own playback intent separately from room, introduction and tab suspension. */
export function createCafeMusic({createPlayer,getContext=()=>({}),onChange,storage=defaultStorage(),timers={}}={}){
  if(typeof createPlayer!=='function')throw new TypeError('A YouTube player factory is required.');
  const later=timers.setTimeout??globalThis.setTimeout,cancel=timers.clearTimeout??globalThis.clearTimeout;
  let videoId=null,url='',volume=30,wanted=false,status='idle',error=null,title='',ready=false,playing=false;
  let player=null,loading=null,controller=null,epoch=0,disposed=false,requested=false,silenced=true,watchdog=null,lastState;
  try{
    const saved=JSON.parse(storage?.getItem(STORAGE_KEY)??'null'),link=parseYouTubeLink(saved?.url);
    if(link){videoId=link.videoId;url=link.url;status='paused';}
    if(Number.isFinite(saved?.volume))volume=clampVolume(saved.volume);
  }catch{}
  const gate=()=>{const context=getContext()??{};return !context.entered?'intro':!context.visible?'hidden':!context.indoor?'outside':'inside';};
  function publish(){
    const next={videoId,url,volume,wanted,status,error,title,ready,playing,gate:gate()};
    if(!lastState||Object.keys(next).some(key=>next[key]!==lastState[key])){lastState=Object.freeze(next);onChange?.(lastState);}
    return lastState;
  }
  function save(){try{storage?.setItem(STORAGE_KEY,JSON.stringify({url,volume}));}catch{}}
  function clearWatchdog(){if(watchdog!==null){cancel(watchdog);watchdog=null;}}
  function quieten(force=false,target=player){
    if(!target||silenced&&!force)return;
    silenced=true;requested=false;playing=false;clearWatchdog();
    for(const [method,args] of [['mute',[]],['setVolume',[0]],['pauseVideo',[]]])try{target[method]?.(...args);}catch{}
  }
  function suspendStatus(){return !videoId?'idle':wanted&&['intro','outside'].includes(gate())?'outside':'paused';}
  function fail(message){error=message;status='error';quieten(true);publish();}
  function currentTitle(){try{title=player?.getVideoData?.().title||title;}catch{}}
  function handleState(event,token){
    if(disposed||token!==epoch)return;
    const value=typeof event==='number'?event:event?.data;
    if(value===1){
      if(!wanted||gate()!=='inside'||status==='error'||status==='blocked'){
        quieten(true,event?.target??player);status=status==='error'||status==='blocked'?status:suspendStatus();publish();return;
      }
      clearWatchdog();playing=true;requested=false;silenced=false;status='playing';error=null;currentTitle();publish();
    }else if(value===0){
      clearWatchdog();playing=false;requested=false;wanted=false;status='ended';quieten(true);publish();
    }else if(value===2){
      playing=false;
      // A pause queued while leaving can arrive after a new play request.
      // Keep that request alive until PLAYING or the autoplay watchdog answers.
      if(wanted&&gate()==='inside'&&!silenced&&requested){armWatchdog();return;}
      requested=false;clearWatchdog();
      if(wanted&&gate()==='inside'&&!silenced){
        status='blocked';quieten(true,event?.target??player);
      }else if(!['error','blocked','ended'].includes(status))status=suspendStatus();
      publish();
    }else if(value===3&&wanted&&gate()==='inside'){
      clearWatchdog();playing=false;requested=true;status='buffering';publish();
    }else if((value===3||value===5)&&gate()!=='inside')quieten(true,event?.target??player);
  }
  function armWatchdog(){
    if(watchdog!==null)return;
    watchdog=later(()=>{
      watchdog=null;if(disposed||!wanted||gate()!=='inside'||playing||!requested)return;
      status='blocked';quieten(true);publish();
    },10000);
  }
  function begin(){
    if(!ready||!player||!wanted||gate()!=='inside'||disposed||playing||requested)return false;
    error=null;status='loading';requested=true;silenced=false;publish();
    try{player.setVolume(volume);if(volume>0)player.unMute();else player.mute();player.playVideo();}
    catch{fail('음악을 시작하지 못했어요. 다시 재생해주세요.');return false;}
    if(!playing&&requested)armWatchdog();
    return true;
  }
  function ensure(){
    if(loading)return loading;
    if(ready)return Promise.resolve(player);
    const token=++epoch,signalController=new AbortController();controller=signalController;
    status='loading';publish();
    let created;
    try{created=createPlayer({videoId,signal:signalController.signal,
      onStateChange:event=>handleState(event,token),
      onAutoplayBlocked:()=>{if(disposed||token!==epoch)return;status=wanted&&gate()==='inside'?'blocked':suspendStatus();quieten(true);publish();},
      onError:event=>{if(!disposed&&token===epoch)fail(errorMessage(typeof event==='number'?event:event?.data));},
    });}catch(cause){created=Promise.reject(cause);}
    const pending=Promise.resolve(created).then(port=>{
      if(disposed||token!==epoch){try{port.destroy?.();}catch{}return null;}
      player=port;ready=true;loading=null;silenced=false;currentTitle();sync();return port;
    }).catch(cause=>{
      if(!disposed&&token===epoch&&cause?.name!=='AbortError'){
        signalController.abort();if(controller===signalController)controller=null;
        loading=null;ready=false;player=null;fail(cause?.musicMessage??'유튜브에 연결하지 못했어요. 연결을 확인하고 다시 재생해주세요.');
      }
      return null;
    });
    loading=pending;return pending;
  }
  function sync(){
    if(disposed)return lastState;
    if(gate()!=='inside'){
      quieten();if(!['error','ended'].includes(status))status=suspendStatus();publish();return lastState;
    }
    if(!wanted){quieten();if(!['error','ended'].includes(status))status=suspendStatus();publish();return lastState;}
    if(status==='blocked'||status==='error'){publish();return lastState;}
    if(!ready)void ensure();else begin();
    publish();return lastState;
  }
  function disconnect(){
    epoch++;controller?.abort();controller=null;quieten(true);clearWatchdog();
    try{player?.destroy?.();}catch{}
    player=null;loading=null;ready=false;playing=false;requested=false;silenced=true;
  }
  publish();
  return {
    setLink(value){
      if(disposed)return false;
      const parsed=parseYouTubeLink(value);
      if(!parsed){error='재생할 영상의 유튜브 링크를 확인해주세요.';publish();return false;}
      error=null;
      if(parsed.videoId!==videoId){disconnect();videoId=parsed.videoId;url=parsed.url;wanted=false;title='';status='paused';}
      save();publish();return true;
    },
    play(){
      if(disposed)return Promise.resolve(false);
      if(!videoId){error='먼저 유튜브 영상 링크를 넣어주세요.';publish();return Promise.resolve(false);}
      const ended=status==='ended';wanted=true;error=null;
      if(status==='blocked'||status==='error'||ended)status='paused';
      if(ended&&player)try{player.seekTo?.(0,true);}catch{}
      if(ready){sync();return Promise.resolve(gate()==='inside');}
      if(gate()!=='inside'){sync();return Promise.resolve(false);}
      return ensure().then(()=>!disposed&&wanted&&ready&&gate()==='inside');
    },
    pause(){if(disposed)return;wanted=false;quieten(true);status=videoId?'paused':'idle';publish();},
    setVolume(value){
      if(disposed||!Number.isFinite(value))return false;volume=clampVolume(value);save();
      if(ready&&wanted&&gate()==='inside'&&!silenced){try{player.setVolume(volume);if(volume>0)player.unMute();else player.mute();}catch{}}
      publish();return true;
    },
    sync,
    get state(){return lastState;},
    dispose(){if(disposed)return;disposed=true;disconnect();wanted=false;status='paused';},
  };
}

const apiLoads=new WeakMap();
function loadYouTubeApi(win,doc,timers){
  if(win.YT?.Player)return Promise.resolve(win.YT);
  if(apiLoads.has(win))return apiLoads.get(win);
  const later=timers.setTimeout??globalThis.setTimeout,cancel=timers.clearTimeout??globalThis.clearTimeout;
  const promise=new Promise((resolve,reject)=>{
    const previous=win.onYouTubeIframeAPIReady,script=doc.createElement('script');let timer;
    const cleanup=()=>{cancel(timer);script.onerror=null;if(win.onYouTubeIframeAPIReady===callback)win.onYouTubeIframeAPIReady=previous;};
    const callback=()=>{cleanup();try{previous?.();}catch{}if(win.YT?.Player)resolve(win.YT);else reject(new Error('YouTube API unavailable'));};
    win.onYouTubeIframeAPIReady=callback;script.src='https://www.youtube.com/iframe_api';script.async=true;
    script.onerror=()=>{cleanup();script.remove();reject(new Error('YouTube API request failed'));};
    timer=later(()=>{cleanup();script.remove();reject(new Error('YouTube API loading timed out'));},15000);
    doc.head.appendChild(script);
  });
  apiLoads.set(win,promise);promise.catch(()=>{if(apiLoads.get(win)===promise)apiLoads.delete(win);});return promise;
}

/** Lazy iframe transport. No audio extraction, proxying or media downloads. */
export function createYouTubeMusicPlayerFactory({host,window:win=globalThis.window,document:doc=globalThis.document,timers={}}={}){
  if(!host||!win||!doc)throw new TypeError('A music host and browser document are required.');
  const later=timers.setTimeout??globalThis.setTimeout,cancel=timers.clearTimeout??globalThis.clearTimeout;
  return async function createPlayer({videoId,signal,onStateChange,onAutoplayBlocked,onError}){
    if(signal?.aborted)throw abortError();
    const YT=await loadYouTubeApi(win,doc,timers);if(signal?.aborted)throw abortError();
    return new Promise((resolve,reject)=>{
      let player,settled=false,timeout;
      const frame=doc.createElement('iframe');frame.width='200';frame.height='200';frame.tabIndex=-1;
      frame.title='카페 음악 재생';frame.setAttribute('aria-hidden','true');frame.setAttribute('allow','autoplay; encrypted-media');
      frame.setAttribute('referrerpolicy','strict-origin-when-cross-origin');
      const origin=win.location.origin;
      frame.src='https://www.youtube-nocookie.com/embed/'+videoId+'?enablejsapi=1&origin='+encodeURIComponent(origin)+'&playsinline=1&autoplay=0&controls=0&rel=0';
      function destroy(){try{player?.mute?.();player?.pauseVideo?.();player?.destroy?.();}catch{}frame.remove();}
      function abort(){cancel(timeout);destroy();if(!settled){settled=true;reject(abortError());}}
      function failed(error){cancel(timeout);signal?.removeEventListener('abort',abort);destroy();if(!settled){settled=true;reject(error);}}
      signal?.addEventListener('abort',abort,{once:true});
      timeout=later(()=>failed(new Error('YouTube player loading timed out')),15000);
      host.replaceChildren(frame);
      try{player=new YT.Player(frame,{events:{
        onReady:event=>{
          if(signal?.aborted){abort();return;}
          cancel(timeout);signal?.removeEventListener('abort',abort);try{event.target.mute();event.target.setVolume(0);}catch{}
          if(!settled){settled=true;resolve(event.target);}
        },
        onStateChange:event=>{
          if(signal?.aborted){if(event.data===1)try{event.target.mute();event.target.pauseVideo();}catch{}return;}
          onStateChange?.(event);
        },
        onAutoplayBlocked:event=>{if(!signal?.aborted)onAutoplayBlocked?.(event);},
        onError:event=>{
          if(signal?.aborted)return;
          if(!settled)failed(Object.assign(new Error(errorMessage(event.data)),{musicMessage:errorMessage(event.data)}));
          else onError?.(event);
        },
      }});}catch(error){failed(error);}
    });
  };
}
