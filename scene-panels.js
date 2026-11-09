/** Presentation only: folding a panel never changes a rest session or its order. */
export function createScenePanels({document:doc=globalThis.document,getView=()=>({})}={}){
  const $=id=>doc.getElementById(id),abort=new AbortController();
  const landscape=$('landscape-drawer'),landscapeContent=$('landscape-content'),landscapeToggle=$('landscape-toggle');
  const rest=$('rest-panel'),restToggle=$('rest-toggle'),restSettings=$('rest-settings');
  let landscapeOpen=false,restOpen=false,wasReady=false,lastSeat=null,disposed=false;
  const listen=(node,event,handler,options={})=>node.addEventListener(event,handler,{...options,signal:abort.signal});
  const focus=node=>node?.focus({preventScroll:true});
  const inside=(node,target)=>node===target||!!node?.contains(target);
  const ready=view=>!!view.seated&&!view.introBlocked&&!view.busy;

  function paint(){
    landscape.dataset.open=String(landscapeOpen);landscapeContent.inert=!landscapeOpen;
    landscapeContent.setAttribute('aria-hidden',String(!landscapeOpen));
    landscapeToggle.setAttribute('aria-expanded',String(landscapeOpen));
    landscapeToggle.setAttribute('aria-label',landscapeOpen?'풍경 설정 접기':'풍경 설정 열기');
    restSettings.setAttribute('aria-expanded',String(landscapeOpen));
    rest.dataset.open=String(restOpen);rest.inert=!restOpen;rest.setAttribute('aria-hidden',String(!restOpen));
    restToggle.setAttribute('aria-expanded',String(restOpen));
    restToggle.hidden=!ready(getView())||restOpen;
    doc.body.classList.toggle('landscape-open',landscapeOpen);
    doc.body.classList.toggle('rest-open',restOpen);
  }
  function setLandscapeOpen(value){
    if(disposed||value&&(getView().introBlocked||getView().busy))return false;
    const next=!!value,fromRest=next&&inside(rest,doc.activeElement);
    if(!next&&inside(landscapeContent,doc.activeElement))focus(landscapeToggle);
    if(next)restOpen=false;
    landscapeOpen=next;paint();
    if(fromRest)focus(landscapeToggle);
    return true;
  }
  function setRestOpen(value,{automatic=false}={}){
    if(disposed||value&&!ready(getView()))return false;
    const next=!!value,restore=!next&&inside(rest,doc.activeElement)&&ready(getView());
    const fromLandscape=next&&inside(landscapeContent,doc.activeElement);
    if(next)landscapeOpen=false;
    restOpen=next;paint();
    if(restore)focus(restToggle);
    if(next&&(!automatic||fromLandscape))focus($('rest-close'));
    return true;
  }
  function update(){
    if(disposed)return;
    const view=getView(),isReady=ready(view);
    if(view.introBlocked){
      if(landscapeOpen||restOpen){landscapeOpen=false;restOpen=false;paint();}
    }else if(isReady&&(!wasReady||lastSeat!==view.seatId)){
      setRestOpen(true,{automatic:true});
    }else if(!isReady&&restOpen){
      restOpen=false;paint();
    }
    const hidden=!isReady||restOpen;
    if(restToggle.hidden!==hidden)restToggle.hidden=hidden;
    wasReady=isReady;lastSeat=view.seatId??null;
  }
  listen(landscapeToggle,'click',()=>setLandscapeOpen(!landscapeOpen));
  listen(restToggle,'click',()=>setRestOpen(true));
  listen($('rest-close'),'click',()=>setRestOpen(false));
  listen(restSettings,'click',()=>setLandscapeOpen(!landscapeOpen));
  listen(doc,'pointerdown',event=>{
    if(event.defaultPrevented||doc.querySelector('dialog[open]'))return;
    if([landscape,rest,restToggle].some(node=>inside(node,event.target)))return;
    if(landscapeOpen)setLandscapeOpen(false);
    if(restOpen)setRestOpen(false);
  },{capture:true});
  listen(doc,'keydown',event=>{
    if(event.key!=='Escape'||event.defaultPrevented||getView().busy||doc.querySelector('dialog[open]')||event.target?.closest?.('select,textarea,input,[contenteditable="true"]'))return;
    if(!landscapeOpen&&!restOpen)return;
    event.preventDefault();event.stopPropagation();
    if(landscapeOpen)setLandscapeOpen(false);else setRestOpen(false);
  },{capture:true});
  paint();update();
  return {update,setLandscapeOpen,setRestOpen,
    get state(){return {landscapeOpen,restOpen};},
    dispose(){if(disposed)return;disposed=true;abort.abort();}};
}
