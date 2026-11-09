const drinkNames={coffee:'커피',tea:'차',cocoa:'코코아'};
const active=status=>status!=='idle';
const clock=value=>{const total=Math.max(0,Math.ceil(value/1000));return String(Math.floor(total/60)).padStart(2,'0')+':'+String(total%60).padStart(2,'0');};

export function createCafeRestUI({session,seats,placement,getNpcs,getDrinks,getView,takeSeat,toast,canvas,document:doc=globalThis.document}={}){
  const $=id=>doc.getElementById(id),abort=new AbortController();
  let drink='coffee',serial=0,order=null,servedSession=0,lastViewSeated=false,lastSeat=null,disposed=false,retryAt=0;
  const listen=(node,event,handler)=>node.addEventListener(event,handler,{signal:abort.signal});
  const text=(node,value)=>{if(node.textContent!==value)node.textContent=value;};
  const ownSeat=()=>active(session.state.status)?session.state.seatId:null;
  const seatedHere=()=>{const view=getView();return view.seated&&view.seatId===session.state.seatId;};
  function cancelOrder(){const pending=order;order=null;retryAt=0;if(pending)getNpcs()?.cancelDrink(pending.id);}
  function end({release=true}={}){
    cancelOrder();session.finish();servedSession=0;getDrinks()?.clear();
    if(release&&!getView().seated)getNpcs()?.releasePlayerSeat();
    update();
  }
  function requestOrder(){
    const state=session.state;
    if(!active(state.status)||!seatedHere()||servedSession===state.id||order)return;
    order={id:++serial,sessionId:state.id,seatId:state.seatId,drink:state.drink,state:'queued'};retryAt=0;
  }
  function start(){
    const view=getView();if(!view.seated||view.busy||!seats.some(seat=>seat.id===view.seatId))return;
    if(active(session.state.status)&&session.state.seatId===view.seatId)return;
    if(active(session.state.status))end({release:false});
    const minutes=Number($('rest-duration').value)||null;
    if(session.start({seatId:view.seatId,minutes,drink})){
      getDrinks()?.showSeat(view.seatId);requestOrder();toast('편하게 쉬세요. 음료를 준비할게요.');update();
    }
  }
  function pauseForLeave(){
    if(session.state.status==='running')session.pause();
    cancelOrder();
  }
  function chooseSeat(seat){
    $('rest-picker').close();
    if(takeSeat(seat)){
      if(active(session.state.status)&&session.state.seatId!==seat.id)end({release:false});
      update();
    }
  }
  function openSeats(){
    if(!getNpcs()||getView().busy)return;
    const list=$('rest-seat-list');list.replaceChildren();
    for(const seat of seats){
      const button=doc.createElement('button');button.type='button';button.dataset.restSeat=seat.id;
      const free=getNpcs().isSeatAvailable(seat.id)||ownSeat()===seat.id||getView().seatId===seat.id;
      button.disabled=!free;button.textContent=seat.label+(free?'':' · 손님 이용 중');
      listen(button,'click',()=>chooseSeat(seat));list.appendChild(button);
    }
    $('rest-picker').showModal();
  }
  function onServiceState(event){
    if(!order||event.id!==order.id||order.sessionId!==session.state.id)return;
    order.state=event.state;update();
  }
  function onServe(event){
    if(!order||event.id!==order.id||order.sessionId!==session.state.id||event.seatId!==order.seatId||event.seatId!==session.state.seatId||event.drink!==order.drink||!seatedHere())return;
    const position=placement.seats[event.seatId];if(!position)return;
    if(getDrinks()?.serve({...event,position:position.cup,yaw:position.yaw??0})){
      servedSession=session.state.id;order.state='served';toast('따뜻한 '+drinkNames[event.drink]+'가 도착했어요.');
    }
    update();
  }
  function update(){
    if(disposed)return;
    const state=session.update(),view=getView();
    if(lastViewSeated&&(!view.seated||lastSeat!==view.seatId))pauseForLeave();
    lastViewSeated=!!view.seated;lastSeat=view.seatId;
    if(view.seated&&active(session.state.status)&&view.seatId!==session.state.seatId){end({release:false});return;}
    if(order&&order.sessionId===state.id&&view.seated&&view.seatId===state.seatId&&order.state==='queued'&&Date.now()>=retryAt){
      retryAt=Date.now()+800;
      const pending=order;pending.state='preparing';
      if(!getNpcs()?.requestDrink({id:pending.id,seatId:pending.seatId,drink:pending.drink})&&order===pending)pending.state='queued';
    }
    const current=session.state,isHere=view.seated&&view.seatId===current.seatId,hasSession=active(current.status);
    const panelVisible=!!view.seated&&!view.introBlocked;
    $('rest-panel').hidden=!panelVisible;
    $('rest-enter').hidden=!!view.active||!!view.introBlocked;
    $('rest-paused').hidden=!!view.introBlocked||!hasSession||isHere;
    $('rest-setup').hidden=hasSession&&isHere;
    $('rest-session-controls').hidden=!hasSession||!isHere;
    doc.body.classList.toggle('rest-mode',panelVisible);
    const seat=seats.find(candidate=>candidate.id===view.seatId);
    text($('rest-seat-name'),seat?.label??'창가 휴식');
    text($('rest-clock'),clock(current.remainingMs??current.elapsedMs??0));
    text($('rest-clock-caption'),current.status==='completed'?'잘 쉬었어요':current.status==='paused'?'잠시 멈춘 휴식':current.minutes===null?'시간에 쫓기지 않고 쉬는 중':'나를 위한 휴식');
    text($('rest-pause'),current.status==='paused'?'계속 쉬기':'잠시 멈춤');
    $('rest-pause').hidden=current.status==='completed';
    $('rest-more').hidden=current.status!=='completed';
    const drinkReady=servedSession===current.id&&hasSession;
    $('rest-sip').hidden=!drinkReady;
    $('rest-sip').disabled=!getDrinks()?.stats?.sipsRemaining||!!getDrinks()?.stats?.placing;
    text($('rest-sip'),getDrinks()?.stats?.sipsRemaining?'한 모금 마시기':'다 마셨어요');
    const messages={queued:'직원이 주문을 받을 준비를 하고 있어요',preparing:'음료를 준비하고 있어요',waiting:'직원이 통로가 비기를 기다려요',delivering:'직원이 음료를 가져오고 있어요',placing:'음료를 내려놓고 있어요',returning:'직원이 자리로 돌아가고 있어요',cancelled:'자리에 돌아오면 다시 주문할 수 있어요',served:drinkNames[current.drink]+'와 함께 쉬어가세요'};
    text($('rest-order-status'),drinkReady?messages.served:order?messages[order.state]??messages.delivering:'');
    $('rest-panel').dataset.state=current.status;$('rest-panel').dataset.order=order?.state??'none';
    $('rest-panel').dataset.seat=view.seatId??'';
    if(canvas){canvas.dataset.restStatus=current.status;canvas.dataset.restSeat=current.seatId??'';canvas.dataset.restOrder=order?.state??'none';}
  }
  listen($('rest-enter'),'click',openSeats);listen($('rest-picker-close'),'click',()=>$('rest-picker').close());
  listen($('rest-start'),'click',start);
  for(const button of doc.querySelectorAll('[data-drink]'))listen(button,'click',()=>{
    drink=button.dataset.drink;
    for(const option of doc.querySelectorAll('[data-drink]'))option.setAttribute('aria-pressed',String(option===button));
  });
  listen($('rest-pause'),'click',()=>{if(session.state.status==='paused'){session.resume();requestOrder();}else session.pause();update();});
  listen($('rest-more'),'click',()=>{session.extend(5);requestOrder();update();});
  listen($('rest-finish'),'click',()=>end());listen($('rest-paused-finish'),'click',()=>end());
  listen($('rest-return-seat'),'click',()=>{const seat=seats.find(candidate=>candidate.id===ownSeat());if(seat)chooseSeat(seat);});
  listen($('rest-sip'),'click',()=>{if(seatedHere()&&getDrinks()?.sip())update();});
  return {update,onServiceState,onServe,openSeats,pauseForLeave,end,
    get holdsSeatClaim(){return active(session.state.status);},get reservedSeatId(){return ownSeat();},
    get visibleDrink(){return seatedHere()&&active(session.state.status)&&!getView().introBlocked;},
    dispose(){if(disposed)return;abort.abort();cancelOrder();disposed=true;}};
}
