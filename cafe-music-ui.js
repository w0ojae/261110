const statusText={idle:'유튜브 링크를 넣고 음악을 선택해주세요.',loading:'음악을 불러오고 있어요.',playing:'카페에서 음악을 듣고 있어요.',buffering:'잠시 음악을 불러오고 있어요.',paused:'음악을 잠시 멈췄어요.',outside:'카페에 들어가면 선택한 음악을 이어서 들을 수 있어요.',blocked:'재생이 시작되지 않았어요. 카페 안에서 음악 재생을 눌러주세요.',ended:'음악이 끝났어요. 다시 재생하거나 다른 링크를 선택하세요.'};

export function createCafeMusicUI({music,document:doc=globalThis.document,canvas}={}){
  const $=id=>doc.getElementById(id),abort=new AbortController();
  const toggle=$('music-toggle'),dialog=$('music-dialog'),url=$('music-url');
  let disposed=false,initialized=false,formError='',pendingId=null,pendingInput=null,serial=0;
  const listen=(node,event,handler)=>node.addEventListener(event,handler,{signal:abort.signal});
  const text=(node,value)=>{if(node.textContent!==value)node.textContent=value;};
  function update(){
    if(disposed)return;
    const state=music.state;
    if(!initialized){url.value=state.url??'';initialized=true;}
    const waiting=state.wanted&&state.gate!=='inside';
    const message=formError||state.error||(waiting?'카페 밖에서는 음악이 멈춰 있어요. 실내에서 이어 들을 수 있어요.':statusText[state.status]??statusText.idle);
    text($('music-status'),message);
    $('music-volume').value=String(state.volume);text($('music-volume-value'),state.volume+'%');
    $('music-play').disabled=!state.videoId||!!pendingId||state.status==='loading'||state.playing||state.status==='buffering';
    $('music-pause').disabled=!state.wanted&&!state.playing&&state.status!=='loading';
    text($('music-apply'),pendingId?'불러오는 중':'선택한 음악 재생');
    const current=$('music-current');current.hidden=!state.videoId;
    if(state.url){current.href=state.url;text(current,state.title||'선택한 YouTube 음악');}
    toggle.dataset.playing=String(!!state.playing);toggle.dataset.musicState=state.status;
    toggle.setAttribute('aria-expanded',String(!!dialog.open));
    toggle.setAttribute('aria-label',state.playing?'카페 음악 설정 · 재생 중':'카페 음악 설정');
    dialog.dataset.state=state.status;dialog.dataset.gate=state.gate;dialog.dataset.wanted=String(!!state.wanted);
    dialog.dataset.videoId=state.videoId??'';
    if(canvas){canvas.dataset.musicState=state.status;canvas.dataset.musicGate=state.gate;canvas.dataset.musicPlaying=String(!!state.playing);}
  }
  function play(){
    if(disposed||!music.state.videoId||pendingId===music.state.videoId)return;
    formError='';pendingId=music.state.videoId;pendingInput=url.value.trim();const token=++serial;update();
    try{
      // Invoke immediately during the click; an already-ready player keeps the gesture.
      Promise.resolve(music.play()).catch(()=>{if(token===serial)formError='음악을 불러오지 못했어요. 다시 시도해주세요.';}).finally(()=>{
        if(disposed||token!==serial)return;pendingId=null;pendingInput=null;update();
      });
    }catch{pendingId=null;pendingInput=null;formError='음악을 불러오지 못했어요. 다시 시도해주세요.';update();}
  }
  function open(){
    if(disposed)return;if(!dialog.open)dialog.showModal();update();url.focus({preventScroll:true});
  }
  listen(toggle,'click',open);
  listen($('music-close'),'click',()=>dialog.close());
  listen(dialog,'close',()=>{if(disposed)return;update();toggle.focus({preventScroll:true});});
  listen($('music-form'),'submit',event=>{
    event.preventDefault();const value=url.value.trim();
    if(pendingId&&value===pendingInput)return;
    formError='';
    if(!music.setLink(value)){formError='재생할 유튜브 영상 링크를 확인해주세요.';update();return;}
    url.value=music.state.url;play();update();
  });
  listen($('music-play'),'click',play);
  listen($('music-pause'),'click',()=>{serial++;pendingId=null;pendingInput=null;formError='';music.pause();update();});
  listen($('music-volume'),'input',event=>{music.setVolume(Number(event.target.value));update();});
  listen(url,'input',()=>{if(formError){formError='';update();}});
  update();
  return {open,update,dispose(){if(disposed)return;disposed=true;serial++;abort.abort();}};
}
