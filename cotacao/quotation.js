(function(global){
  'use strict';
  const Core=global.AloQuotationCore;
  const instances=new WeakMap();
  const ENDPOINT='https://sxbcjzshcjxzladwptiu.supabase.co/functions/v1/alo-cozinha-sync?publicquotation=1';
  const currency=(value,precision=2)=>Number(value).toLocaleString('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:precision});
  const number=value=>Number(value).toLocaleString('pt-BR',{maximumFractionDigits:6});
  const hasAlternatives=answers=>{const active=(answers||[]).filter(answer=>!answer.unavailable&&!answer.excluded);return active.length>new Set(active.map(answer=>answer.itemId)).size;};
  const date=value=>{const parsed=new Date(value);return Number.isFinite(parsed.getTime())?parsed.toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}):'Prazo não informado';};
  const el=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=String(text);return node;};
  function icon(name){
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
    for(const [key,value]of Object.entries({viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':'1.8','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true',class:'icon'}))svg.setAttribute(key,value);
    const paths={check:'m5 12 4 4L19 6',x:'m6 6 12 12M18 6 6 18',arrow:'M4 12h16m-6-6 6 6-6 6',clock:'M12 8v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',alert:'M12 8v5m0 3h.01M12 3 2 21h20z'};
    const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d',paths[name]||paths.alert);svg.append(path);return svg;
  }
  function button(text,kind,action){const node=el('button',`button ${kind}`,text);node.type='button';if(action)node.addEventListener('click',action);return node;}
  function notice(text,kind=''){const box=el('div',`notice ${kind}`);box.setAttribute('role',kind==='error'?'alert':'status');box.append(icon(kind==='success'?'check':'alert'),el('p','',text));return box;}
  function apiError(code){const error=new Error(code);error.code=code;return error;}
  function errorText(code){return ({quotation_unavailable:'Este link expirou ou não está mais disponível. Peça um novo link ao restaurante.',quotation_closed:'O restaurante já encerrou esta cotação.',quotation_conflict:'A cotação foi atualizada. Seus dados foram mantidos; confira os itens e revise a proposta novamente.',quotation_limit:'Esta cotação atingiu o limite de alterações. Peça um novo link ao restaurante.',invalid_quotation:'Confira as quantidades, as embalagens e os preços antes de enviar.',rate_limited:'Muitas tentativas em sequência. Aguarde um momento e tente novamente.',invalid_response:'Não foi possível carregar os dados da cotação. Tente novamente.'})[code]||'Não foi possível confirmar a operação. Confira sua conexão e tente novamente. Seus dados foram mantidos.';}
  async function request(token,action,payload={}){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
    try{
      const response=await fetch(ENDPOINT,{method:'POST',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',signal:controller.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({action,token,...payload})});
      const body=await response.json();
      if(!response.ok||body.status!=='ok')throw apiError(body.code|| (response.status===429?'rate_limited':'network_error'));
      return body;
    }catch(error){if(error.code)throw error;throw apiError('network_error');}finally{clearTimeout(timer);}
  }
  function operationId(){
    if(global.crypto?.randomUUID)return global.crypto.randomUUID();
    const bytes=new Uint8Array(16);global.crypto.getRandomValues(bytes);bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
    const hex=Array.from(bytes,value=>value.toString(16).padStart(2,'0')).join('');return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
  }
  async function draftKey(token){
    if(!global.crypto?.subtle)return '';
    const hash=await global.crypto.subtle.digest('SHA-256',new TextEncoder().encode(token));
    return 'alo_quotation_draft_v1_'+Array.from(new Uint8Array(hash),value=>value.toString(16).padStart(2,'0')).join('');
  }
  async function start(options={}){
    const root=options.root||document.getElementById('quotationApp'),token=options.token||'';
    instances.get(root)?.();
    const transport=options.transport||((action,payload)=>request(token,action,payload));
    const state={quotation:null,values:null,pending:null,busy:false,loading:false,dirty:false,key:'',storage:null,localSaved:false,fields:new Map(),offerValues:new Map(),itemSaveButtons:new Map(),dialog:null,offerDialog:null,unitChoice:null};
    let auctionTimer=null,auctionBusy=false,disposed=false,auctionClosed=false;
    const stopAuction=()=>{clearTimeout(auctionTimer);auctionTimer=null;};
    function auctionOpen(){return !disposed&&!auctionClosed&&state.quotation?.auctionEnabled&&state.quotation.status==='answered'&&Date.parse(state.quotation.expiresAt)>Date.now();}
    function scheduleAuction(){stopAuction();if(auctionOpen()&&!document.hidden)auctionTimer=setTimeout(()=>refreshAuction(),60000);}
    function auctionText(itemId){const minimum=Core.auctionMinimum(state.quotation,itemId);return minimum?`Menor preço nesta rodada: ${currency(minimum.unitPrice,4)} / ${minimum.unit}`:'Ainda sem preço comparável para este item.';}
    function auctionPrice(itemId){const node=el('p','auction-item-price',auctionText(itemId));node.dataset.auctionItem=itemId;return node;}
    async function refreshAuction(){
      if(auctionBusy||disposed||state.busy||state.loading){scheduleAuction();return;}
      if(!auctionOpen()){stopAuction();return;}
      auctionBusy=true;const status=root.querySelector('[data-auction-status]');if(status)status.textContent='Atualizando preços…';
      root.querySelectorAll('[data-auction-refresh]').forEach(button=>button.disabled=true);
      try{
        const result=await transport('quotation_auction');if(disposed)return;
        if(result.status!=='ok'||!Array.isArray(result.auctionMinima))throw apiError('invalid_response');
        state.quotation.auctionMinima=result.auctionMinima;
        auctionClosed=result.statusCotacao==='ordered'||Date.parse(result.expiresAt)<=Date.now();
        root.querySelectorAll('[data-auction-item]').forEach(node=>node.textContent=auctionText(node.dataset.auctionItem));
        if(status)status.textContent=auctionClosed?'Cotação encerrada.':`Preços atualizados às ${new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}.`;
      }catch(error){if(disposed)return;if(error.code==='quotation_unavailable'){auctionClosed=true;if(status)status.textContent='O prazo terminou ou o restaurante encerrou o link.';}else if(status)status.textContent='Não foi possível atualizar. Tente novamente; sua edição foi preservada.';}
      finally{auctionBusy=false;root.querySelectorAll('[data-auction-refresh]').forEach(button=>button.disabled=auctionClosed);scheduleAuction();}
    }
    function auctionPanel(){
      const q=state.quotation;if(!q.auctionEnabled||q.status==='ordered'){stopAuction();return null;}
      const panel=el('section','auction-panel');panel.append(el('strong','','Leilão reverso'));
      if(q.status!=='answered')panel.append(el('p','','Envie sua proposta para consultar o menor preço dos itens disponíveis que você ofertar.'));
      if(q.status==='answered'){
        const status=el('p','auction-status',auctionClosed?'Cotação encerrada.':'Atualização automática a cada minuto nesta página.');status.dataset.auctionStatus='';status.setAttribute('role','status');
        const refresh=button('Atualizar preços','secondary',refreshAuction);refresh.dataset.auctionRefresh='';refresh.disabled=auctionClosed;panel.append(status,refresh);
      }
      scheduleAuction();return panel;
    }
    const visibility=()=>{if(document.hidden)stopAuction();else if(auctionOpen())refreshAuction();};
    document.addEventListener('visibilitychange',visibility);
    instances.set(root,()=>{disposed=true;stopAuction();document.removeEventListener('visibilitychange',visibility);});
    let progress,totalAmount,summaryCount,formNotice;
    const fieldKey=(itemId,offerId)=>itemId+'::'+(offerId||'default');
    const valueFor=id=>state.offerValues.get(id)?.value||state.values[id];
    const sourceFor=id=>state.offerValues.get(id)?.item||state.quotation.items.find(item=>item.id===id);
    function quantityFor(item,value){if(Core.offerQuantity)return Core.offerQuantity(item,value);const requested=item.units.find(u=>u.id===item.unitId),offered=Core.offerUnit(item,value);return requested?.factor>0&&offered?.factor>0&&requested.base===offered.base?Math.round(item.quantity*requested.factor/offered.factor*1e6)/1e6:item.quantity;}
    try{state.storage=options.storage===false?null:options.storage||global.localStorage;state.key=await draftKey(token);}catch(error){state.storage=null;}
    function saveDraft(){
      if(!state.quotation||!state.values||!state.key||!state.storage)return;
      try{
        const deadline=Date.parse(state.quotation.expiresAt),expiresAt=Math.min(Date.now()+7*86400000,Number.isFinite(deadline)?deadline+86400000:Infinity);
        state.storage.setItem(state.key,JSON.stringify({quotationId:state.quotation.id,revision:state.quotation.revision,expiresAt,values:state.values,pending:state.pending,dirty:state.dirty}));state.localSaved=true;
      }catch(error){state.localSaved=false;}
    }
    function savedDraft(){
      try{const saved=JSON.parse(state.storage?.getItem(state.key)||'null');if(saved?.quotationId===state.quotation.id&&saved.expiresAt>Date.now())return saved;}catch(error){}
      return null;
    }
    function clearDraft(){try{state.storage?.removeItem(state.key);}catch(error){}state.dirty=false;state.pending=null;state.localSaved=false;}
    function closeReview(){if(state.busy)return;state.dialog?.close();}
    function fatal(code,retry=true){
      stopAuction();auctionClosed=true;
      state.dialog?.close();root.setAttribute('aria-busy','false');
      const panel=el('section','state-panel'),mark=el('div','state-mark');mark.append(icon('alert'));
      const heading=el('h1','',code==='missing_token'?'Abra o link da cotação':'Cotação indisponível');heading.tabIndex=-1;
      panel.append(mark,heading,el('p','',code==='missing_token'?'Use o link que o restaurante enviou para você responder à cotação.':errorText(code)));
      if(retry)panel.append(button('Tentar novamente','primary',()=>load({preserve:true})));
      root.replaceChildren(panel);heading.focus({preventScroll:true});
    }
    function header(quotation){
      const panel=el('section','request-summary');
      const supplier=el('div','request-line');supplier.append(el('span','eyebrow','Fornecedor'),el('h1','',quotation.supplierName||'Sua cotação'));
      const recipient=el('div','request-line'),identity=el('div','request-identity');identity.append(el('strong','',quotation.legalName||quotation.restaurantName||'Restaurante'));if(quotation.cnpj)identity.append(el('small','', 'CNPJ: '+String(quotation.cnpj).replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,'$1.$2.$3/$4-$5')));recipient.append(el('span','eyebrow','Solicitante'),identity);
      const brand=document.querySelector('.brand-inner');if(brand){if(!brand.dataset.appBrand){brand.dataset.appBrand='true';const app=el('div','app-brand');while(brand.firstChild)app.append(brand.firstChild);brand.append(app);}brand.querySelector('.restaurant-brand')?.remove();const restaurant=el('div','restaurant-brand');if(/^data:image\/(png|jpeg|webp);base64,/i.test(quotation.logoDataUrl||'')){const logo=el('img','restaurant-logo');logo.src=quotation.logoDataUrl;logo.alt=quotation.restaurantName||'Restaurante';restaurant.append(logo);}else restaurant.append(el('span','restaurant-name',quotation.restaurantName||''));brand.append(restaurant);}
      panel.append(supplier,recipient);
      return panel;
    }
    function quotationDeadline(quotation){const node=el('p','deadline quotation-deadline');node.append(icon('clock'),el('span','',`Responder até ${date(quotation.expiresAt)}`));return node;}
    function answerList(quotation,answers){
      const list=el('ul','answer-list');
      for(const item of quotation.items){
        const alternatives=answers.filter(value=>value.itemId===item.id&&!value.excluded);if(!alternatives.length)continue;
        const row=el('li','answer-item');row.append(el('strong','answer-product-name',`${quotation.items.indexOf(item)+1}. ${item.name}`));
        for(const answer of alternatives){
          const offer=el('div','answer-alternative');
          if(answer.unavailable)offer.append(el('p','','Indisponível'));
          else{
            if(answer.brand)offer.append(el('strong','answer-brand',answer.brand));
            offer.append(el('p','',`${number(answer.quantity)} × ${Core.offerUnitLabel(item,answer)}`));
            offer.append(el('p','answer-price',`${currency(answer.unitPrice,4)} por ${Core.priceUnitLabel(item,answer)} · Total ${currency(Core.offerTotal(item,answer))}`));
            if(answer.commercialization){const c=answer.commercialization;offer.append(el('p','',c.kind==='unit'?c.label:`${c.label} com ${number(c.amount)} ${c.measure}`));}
            if(answer.observation)offer.append(el('p','answer-observation',answer.observation));
          }
          row.append(offer);
        }
        if(quotation.auctionEnabled&&quotation.status==='answered'&&alternatives.some(answer=>!answer.unavailable))row.append(auctionPrice(item.id));
        list.append(row);
      }
      return list;
    }
    function receipt(){
      const q=state.quotation,closed=q.status==='ordered',panel=el('section','state-panel'),mark=el('div',closed?'state-mark':'state-mark success');mark.append(icon(closed?'clock':'check'));
      const heading=el('h1','',closed?'Cotação encerrada':'Proposta enviada');heading.tabIndex=-1;
      panel.append(mark,heading,el('p','',closed?'O restaurante encerrou esta cotação. Não é mais possível enviar ou alterar a proposta.':`${q.restaurantName||'O restaurante'} recebeu sua proposta.`));
      if(q.submittedAt)panel.append(el('p','',`Enviada em ${date(q.submittedAt)}`));
      const auction=auctionPanel();if(auction)panel.append(auction);
      if((q.answers||[]).length){panel.append(el('h2','submitted-heading','Sua resposta'),answerList(q,q.answers));const totals=Core.summary(q.answers,q.items),line=el('div','review-total',hasAlternatives(q.answers)?'Menor total por item':'Total ofertado');line.append(el('strong','',currency(totals.total)));panel.append(line);}
      if(!closed)panel.append(button('Editar proposta','secondary',()=>{state.values=Core.draftForQuotation(q);state.pending=null;renderForm();}));
      root.replaceChildren(header(q),panel);panel.classList.add('receipt-panel');root.setAttribute('aria-busy','false');heading.focus({preventScroll:true});global.scrollTo?.({top:0,behavior:'auto'});
    }
    function updateTotals(){
      const built=Core.buildAnswers(state.quotation,state.values),invalid=new Set(built.errors.map(error=>error.itemId)),totals=Core.summary(built.answers,state.quotation.items);
      progress.textContent='';progress.hidden=true;
      totalAmount.textContent=currency(totals.total);
      summaryCount.textContent=`${totals.count} ${totals.count===1?'item ofertado':'itens ofertados'}${totals.unavailable?' · '+totals.unavailable+(totals.unavailable===1?' indisponível':' indisponíveis'):''}`;
      for(const [key,entry] of state.offerValues){const refs=state.fields.get(key),item=entry.item,value=entry.value,quantity=quantityFor(item,value),price=Core.decimal(value.unitPrice);if(!refs)continue;value.quantity=quantity===null?'':Core.inputNumber(quantity);refs.quantity.input.textContent=quantity===null?'—':number(quantity);refs.total.textContent=!state.values[item.id].unavailable&&quantity>0&&price>0?currency(Core.offerTotal(item,{...value,quantity,unitPrice:price})):'—';refs.refreshPriceUnit();refs.refreshPackaging?.();}
    }
    function changed(itemId,field,value){
      const customKey={customLabel:'label',customAmount:'amount',customMeasure:'measure'}[field];
      if(customKey)valueFor(itemId).customUnit[customKey]=value;else valueFor(itemId)[field]=value;
      if(field==='brand'&&valueFor(itemId).brandMode==='other')valueFor(itemId).otherBrand=value;
      state.dirty=true;state.pending=null;
      const savedButton=state.itemSaveButtons.get(sourceFor(itemId)?.id);if(savedButton)savedButton.textContent='Salvar';
      const refs=state.fields.get(itemId);
      if(field==='unitId'){const resolved=Core.offerUnit(sourceFor(itemId),valueFor(itemId));if(!resolved?.factor)valueFor(itemId).priceBasis='package';}
      if(['unitId','priceBasis'].includes(field)||(['customAmount','customMeasure'].includes(field)&&valueFor(itemId).priceBasis!=='base')){valueFor(itemId).unitPrice='';refs.unitPrice.input.value='';}
      for(const ref of Object.values(refs)){if(ref?.input){ref.input.removeAttribute('aria-invalid');ref.error.hidden=true;}}

      refs.refreshPackaging?.();
      updateTotals();saveDraft();
    }
    function closeUnitChoice(focus=false){
      const choice=state.unitChoice;if(!choice)return;
      choice.menu.hidden=true;choice.trigger.setAttribute('aria-expanded','false');choice.cleanup?.();state.unitChoice=null;
      if(focus)choice.trigger.focus();
    }
    function choiceMenu(item,index,key,label,options,selected,onPick){
      const container=el('div','unit-choice'),trigger=el('button','unit-choice-trigger'),copy=el('span'),menu=el('div','unit-choice-menu');
      trigger.type='button';trigger.value=selected;copy.textContent=options.find(unit=>unit.id===selected)?.label||'Escolher';
      trigger.append(copy,icon('arrow'));trigger.setAttribute('aria-haspopup','listbox');trigger.setAttribute('aria-expanded','false');trigger.setAttribute('aria-controls',key+'-options-'+index);
      menu.id=key+'-options-'+index;menu.hidden=true;menu.setAttribute('role','listbox');menu.setAttribute('aria-label',`${label} de ${item.name}`);
      const choice={container,trigger,menu,copy};
      for(const [position,unit]of options.entries()){
        const option=el('button','unit-choice-option');option.type='button';option.setAttribute('role','option');option.setAttribute('aria-selected',String(unit.id===trigger.value));option.append(el('span','',unit.label),icon('check'));
        option.dataset.value=unit.id;option.disabled=Boolean(unit.disabled);if(unit.disabled)option.classList.add('brand-rejected');
        if(unit.separator)menu.append(el('div','brand-separator',unit.separator));
        option.addEventListener('click',()=>{
          if(onPick(unit.id)===false){closeUnitChoice();return;}
          trigger.value=unit.id;copy.textContent=unit.label;
          menu.querySelectorAll('[role=option]').forEach(node=>node.setAttribute('aria-selected',String(node.dataset.value===unit.id)));closeUnitChoice(true);
        });
        option.addEventListener('keydown',event=>{
          const buttons=Array.from(menu.querySelectorAll('[role=option]:not(:disabled)')),cursor=buttons.indexOf(option);
          const steps={ArrowDown:Math.min(buttons.length-1,cursor+1),ArrowUp:Math.max(0,cursor-1),Home:0,End:buttons.length-1};
          if(Object.hasOwn(steps,event.key)){event.preventDefault();buttons[steps[event.key]].focus();}
          else if(event.key==='Escape'){event.preventDefault();closeUnitChoice(true);}
        });
        menu.append(option);
      }
      function open(){
        closeUnitChoice();menu.hidden=false;trigger.setAttribute('aria-expanded','true');state.unitChoice=choice;
        function position(){
          const v=window.visualViewport,top=v?.offsetTop||0,left=v?.offsetLeft||0,height=v?.height||innerHeight,width=v?.width||innerWidth,rect=trigger.getBoundingClientRect(),pad=10;
          if(rect.bottom<top||rect.top>top+height){closeUnitChoice();return;}
          const below=Math.max(0,top+height-rect.bottom-pad),above=Math.max(0,rect.top-top-pad),up=below<220&&above>below,space=Math.min(430,Math.max(above,below));
          const w=Math.min(Math.max(rect.width,220),width-pad*2);menu.style.position='fixed';menu.style.width=w+'px';menu.style.maxHeight=Math.min(430,up?above:below,Math.max(44,height-pad*2))+'px';menu.style.left=Math.max(left+pad,Math.min(rect.left,left+width-w-pad))+'px';menu.style.right='auto';menu.style.bottom='auto';
          const h=Math.min(menu.scrollHeight,parseFloat(menu.style.maxHeight));menu.style.top=Math.max(top+pad,Math.min(up?rect.top-h-5:rect.bottom+5,top+height-h-pad))+'px';
        }
        const outside=e=>{if(!container.contains(e.target))closeUnitChoice();};const scrolled=e=>{if(!menu.contains(e.target))position();};
        choice.cleanup=()=>{window.removeEventListener('resize',position);document.removeEventListener('scroll',scrolled,true);document.removeEventListener('pointerdown',outside,true);window.visualViewport?.removeEventListener('resize',position);window.visualViewport?.removeEventListener('scroll',position);};
        window.addEventListener('resize',position);document.addEventListener('scroll',scrolled,true);document.addEventListener('pointerdown',outside,true);window.visualViewport?.addEventListener('resize',position);window.visualViewport?.addEventListener('scroll',position);
        position();(menu.querySelector('[aria-selected="true"]')||menu.firstElementChild)?.focus({preventScroll:true});
      }
      trigger.addEventListener('click',()=>menu.hidden?open():closeUnitChoice());
      trigger.addEventListener('keydown',event=>{if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();open();}else if(event.key==='Escape')closeUnitChoice();});
      container.addEventListener('focusout',event=>{if(state.unitChoice===choice&&!container.contains(event.relatedTarget))closeUnitChoice();});
      container.append(trigger,menu);return choice;
    }
    function unitChoice(item,index){
      const value=valueFor(item.id),options=[...item.units];
      if(value.unitId==='__custom__')options.unshift({id:'__custom__',label:Core.offerUnitLabel(item,value)});
      return choiceMenu(item,index,'unit','Unidade',options,value.unitId,id=>{if(value.unitId!==id){value.priceBasis='package';changed(item.id,'unitId',id);}});
    }
    function editPackaging(item,index,kind){
      closeUnitChoice();const value=valueFor(item.id),old=value.commercialization||{},editing=old.kind===kind,source=sourceFor(item.id),available=Core.customMeasures(source),requested=source.units.find(unit=>unit.id===source.unitId);
      const allowed=available.length?available:[{id:requested.id,label:requested.label}];
      const label=kind==='other'?(editing?old.label:''):kind==='box'?'Caixa':'Fardo',dialog=el('dialog','review-dialog packaging-dialog'),title=el('h2','',kind==='other'?'Qual a composição da embalagem?':kind==='box'?'Qual a composição da caixa?':'Qual a composição do fardo?'),body=el('div','packaging-body'),actions=el('div','review-actions'),error=el('p','field-error');
      title.id='packagingTitle';dialog.setAttribute('aria-labelledby',title.id);error.hidden=true;error.setAttribute('role','alert');
      let nameInput;if(kind==='other'){const wrap=el('div','field'),nameLabel=el('label','','Nome da embalagem');nameInput=el('input');nameInput.id='packagingName';nameLabel.htmlFor=nameInput.id;nameInput.maxLength=120;nameInput.value=label;wrap.append(nameLabel,nameInput);body.append(wrap);}
      const row=el('div','custom-content-row'),amountWrap=el('div','field'),amountLabel=el('label','','Qtde'),amount=el('input'),measureWrap=el('div','field'),measureLabel=el('label','','Subunidade');
      amount.id='packagingAmount';amount.type='text';amount.inputMode='decimal';amount.autocomplete='off';amount.maxLength=17;amountLabel.htmlFor=amount.id;amount.value=editing?Core.inputNumber(old.amount):'';amount.placeholder='Ex.: 15';amount.addEventListener('focus',()=>amount.select());amount.addEventListener('click',()=>amount.select());amount.addEventListener('input',()=>{amount.value=Core.quantityFromTyping(amount.value);});
      let measure=allowed.some(m=>m.id===old.measure)?old.measure:allowed[0]?.id;const choice=choiceMenu(item,index,'packMeasure','Subunidade',allowed,measure,id=>{measure=id;});choice.trigger.id='packagingMeasure';measureLabel.htmlFor=choice.trigger.id;
      amountWrap.append(amountLabel,amount);measureWrap.append(measureLabel,choice.container);row.append(amountWrap,measureWrap);body.append(row,error);
      const cancel=button('Cancelar','secondary',()=>dialog.close()),save=button('Salvar','primary',()=>{
        const name=nameInput?nameInput.value.trim():label,count=Core.decimal(amount.value);
        if(!name||/[\u0000-\u001f]/.test(name)){error.textContent='Informe o nome da embalagem.';error.hidden=false;nameInput?.focus();return;}
        if(!(count>0)||count>1e9||!allowed.some(m=>m.id===measure)){error.textContent='Informe uma quantidade maior que zero e a medida.';error.hidden=false;amount.focus();return;}
        changed(item.id,'commercialization',{kind,label:name,amount:count,measure});dialog.close();
      });
      amount.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();save.click();}});actions.append(save,cancel);dialog.append(title,body,actions);document.body.append(dialog);
      dialog.addEventListener('close',()=>{closeUnitChoice();dialog.remove();state.fields.get(item.id)?.commercialization.input.focus({preventScroll:true});});dialog.showModal();
      const fitDialog=()=>{const vp=window.visualViewport;dialog.style.top=((vp?.offsetTop||0)+12)+'px';dialog.style.maxHeight=Math.max(160,(vp?.height||innerHeight)-24)+'px';};
      fitDialog();window.visualViewport?.addEventListener('resize',fitDialog);window.visualViewport?.addEventListener('scroll',fitDialog);
      dialog.addEventListener('close',()=>{window.visualViewport?.removeEventListener('resize',fitDialog);window.visualViewport?.removeEventListener('scroll',fitDialog);});
      (nameInput||amount).focus({preventScroll:true});(nameInput||amount).select();
    }
    function field(item,index,key,label,type='text'){
      const wrap=el('div','field'),id=`offer-${index}-${key}`,labelNode=el('label','',label);labelNode.htmlFor=id;
      const choice=type==='select'?unitChoice(item,index):null,input=choice?choice.trigger:el('input');input.id=id;
      if(type!=='select'){input.type='text';input.autocomplete='off';input.maxLength=key==='observation'?500:['brand','customLabel'].includes(key)?120:24;if(!['brand','customLabel','observation'].includes(key))input.inputMode='decimal';}
      const customKey={customLabel:'label',customAmount:'amount'}[key];
      input.value=(customKey?valueFor(item.id).customUnit[customKey]:valueFor(item.id)[key])??'';
      if(key==='unitPrice'){
        const initial=Core.decimal(input.value);if(Number.isFinite(initial))input.value=Core.formatPrice(initial);
        let precise=Number.isFinite(initial)&&Math.abs(initial-Number(initial.toFixed(2)))>1e-9;
        input.addEventListener('beforeinput',event=>{if(event.inputType==='insertText'&&input.selectionStart===0&&input.selectionEnd===input.value.length)precise=false;});
        input.addEventListener('paste',event=>{event.preventDefault();const pasted=event.clipboardData?.getData('text')||'',formatted=Core.priceFromPaste(pasted);input.value=formatted===null?pasted.trim().slice(0,24):formatted;const amount=Core.decimal(input.value);precise=Number.isFinite(amount)&&Math.abs(amount-Number(amount.toFixed(2)))>1e-9;changed(item.id,key,input.value);});
        input.addEventListener('input',()=>{if(!precise)input.value=Core.priceFromTyping(input.value);if(!input.value)precise=false;changed(item.id,key,input.value);});
      }else if(type!=='select')input.addEventListener('input',()=>{if(key==='quantity'||key==='customAmount')input.value=Core.quantityFromTyping(input.value);changed(item.id,key,input.value);});
      const error=el('p','field-error');error.id=id+'-error';error.hidden=true;input.setAttribute('aria-describedby',error.id);
      wrap.append(labelNode);
      if(key==='unitPrice'){const money=el('div','money-input');money.append(el('span','','R$'),input);wrap.append(money);input.placeholder='0,00';}else wrap.append(choice?choice.container:input);
      wrap.append(error);return {wrap,input,error,label:labelNode,choice};
    }
    function brandField(item,index){
      const ref=field(item,index,'brand','Marca'),value=valueFor(item.id),key=text=>String(text||'').trim().toLocaleLowerCase('pt-BR');
      const rejected=Array.from(new Set(item.rejectedBrands||[])),brands=Array.from(new Set(item.brands||[])).filter(brand=>!rejected.some(name=>key(name)===key(brand)));
      const match=brands.findIndex(name=>key(name)===key(value.brand)),selected=match>=0?'brand-'+match:value.brand?'other':'';
      value.brandMode=selected==='other'?'other':'';
      const options=[...brands.map((label,position)=>({id:'brand-'+position,label})),{id:'other',label:'Outra marca'},...rejected.map((label,position)=>({id:'rejected-'+position,label,disabled:true,...(!position?{separator:'Marcas não aceitas'}:{})}))];
      const choice=choiceMenu(item,index,'brand','Marca',options,selected,id=>{
        if(id==='other'){openOtherBrand();return false;}
        setBrand(brands[Number(id.slice(6))]);
      });
      function setBrand(name){
        const matched=brands.findIndex(brand=>key(brand)===key(name));value.brandMode=matched<0?'other':'';value.otherBrand=matched<0?name:'';
        changed(item.id,'brand',matched>=0?brands[matched]:name);refreshBrand();
      }
      function refreshBrand(){
        choice.copy.textContent=value.brand||'Selecionar marca';choice.trigger.classList.toggle('brand-other',Boolean(value.brand)&&!brands.some(name=>key(name)===key(value.brand)));
        choice.trigger.value=value.brand;choice.menu.querySelectorAll('[role=option]').forEach(node=>node.setAttribute('aria-selected',String(node.dataset.value===(value.brandMode==='other'?'other':'brand-'+brands.findIndex(name=>key(name)===key(value.brand))))));
      }
      function openOtherBrand(){
        const dialog=el('dialog','review-dialog other-brand-dialog'),title=el('h2','','Outra marca'),wrap=el('div','field'),label=el('label','','Marca'),input=el('input'),error=el('p','field-error'),actions=el('div','review-actions');
        title.id='otherBrandTitle';dialog.setAttribute('aria-labelledby',title.id);input.id='otherBrandName';label.htmlFor=input.id;input.maxLength=120;input.autocomplete='off';input.value=value.brandMode==='other'?value.brand:'';error.hidden=true;error.setAttribute('role','alert');
        const cancel=button('Cancelar','secondary',()=>dialog.close()),save=button('Salvar','primary',()=>{
          const name=input.value.trim();if(!name){error.textContent='Informe a marca.';error.hidden=false;input.focus();return;}
          if(rejected.some(brand=>key(brand)===key(name))){error.textContent='Esta marca não é aceita pelo restaurante.';error.hidden=false;input.focus();return;}
          if(/[\u0000-\u001f]/.test(name)){error.textContent='Confira o nome da marca.';error.hidden=false;return;}
          setBrand(name);dialog.close();
        });
        input.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();save.click();}});wrap.append(label,input,error);actions.append(save,cancel);dialog.append(title,wrap,actions);document.body.append(dialog);
        dialog.addEventListener('close',()=>{dialog.remove();choice.trigger.focus({preventScroll:true});});dialog.showModal();input.focus({preventScroll:true});
      }
      ref.input.remove();ref.input=choice.trigger;choice.trigger.id=`offer-${index}-brand-choice`;ref.label.htmlFor=choice.trigger.id;choice.trigger.setAttribute('aria-describedby',ref.error.id);ref.wrap.insertBefore(choice.container,ref.error);refreshBrand();return ref;
    }
    function offerCard(item,index,offerIndex){
      const value=valueFor(item.id),source=sourceFor(item.id),fields=el('div','brand-offer-fields');
      const bar=el('div','brand-offer-heading');
      if(state.values[source.id].offers.length>1)bar.append(button('Remover','text-button',()=>{state.offerDialog?.removeOffer?.();}));
      if(bar.children.length)fields.append(bar);
      const brand=brandField(item,index);brand.label.classList.add('visually-hidden');fields.append(brand.wrap);
      const quantityWrap=el('div','field fixed-quantity'),quantityLabel=el('span','field-label','Qtde'),quantityText=el('output');quantityText.textContent=number(quantityFor(source,value));quantityWrap.append(quantityLabel,quantityText);
      const quantity={wrap:quantityWrap,input:quantityText,error:el('p','field-error')},unitId=field(item,index,'unitId','Unidade','select'),unitPrice=field(item,index,'unitPrice','Preço por unidade'),row=el('div','unit-price-row');
      row.append(quantityWrap,unitId.wrap,unitPrice.wrap);fields.append(row);
      function refreshPriceUnit(){unitPrice.label.textContent='Preço por '+Core.priceUnitLabel(source,value);}
      const commercializationWrap=el('div','field commercialization-field'),commercializationLabel=el('label','','Forma de comercialização'),commercializationError=el('p','field-error');commercializationError.hidden=true;
      const resolved=Core.offerUnit(source,value),ownMeasure=resolved?.base||source.unitId;
      const choice=choiceMenu(item,index,'commercialization','Forma de comercialização',[{id:'unit',label:ownMeasure},{id:'box',label:'Caixa'},{id:'bundle',label:'Fardo'},{id:'other',label:'Outra embalagem'}],value.commercialization?.kind||'',kind=>{
        if(kind!=='unit'){editPackaging(item,index,kind);return false;}
        changed(item.id,'commercialization',{kind:'unit',label:ownMeasure,amount:1,measure:ownMeasure});
      });
      commercializationLabel.htmlFor=choice.trigger.id='commercialization-'+index;commercializationWrap.append(commercializationLabel,choice.container,commercializationError);
      function refreshPackaging(){const form=value.commercialization;choice.copy.textContent=!form?'Selecionar':form.kind==='unit'?form.label:`${form.label} com ${number(form.amount)} ${form.measure}`;choice.trigger.value=form?.kind||'';choice.menu.querySelectorAll('[role=option]').forEach(node=>node.setAttribute('aria-selected',String(node.dataset.value===form?.kind)));}
      const observation=field(item,index,'observation','Observação');observation.input.placeholder='Detalhes desta oferta';observation.wrap.hidden=!value.observation;
      const addObservation=button(value.observation?'Observação':'Adicionar observação','observation-toggle',()=>{observation.wrap.hidden=!observation.wrap.hidden;addObservation.setAttribute('aria-expanded',String(!observation.wrap.hidden));if(!observation.wrap.hidden)observation.input.focus();});addObservation.setAttribute('aria-expanded',String(!observation.wrap.hidden));
      const commercialRow=el('div','commercialization-row');commercialRow.append(commercializationWrap,addObservation);fields.append(commercialRow,observation.wrap);
      const itemTotal=el('div','item-total'),total=el('strong','','—');itemTotal.append(el('span','','Total'),total);fields.append(itemTotal);
      state.fields.set(item.id,{brand,quantity,unitId,unitPrice,observation,fields,total,commercialization:{wrap:commercializationWrap,input:choice.trigger,error:commercializationError},priceLabel:unitPrice.label,refreshPriceUnit,refreshPackaging});
      return fields;
    }
    function editOffer(item,index,offerId,adding=false){
      if(state.offerDialog?.open)return;
      const original=JSON.parse(JSON.stringify(state.values[item.id])),priorDirty=state.dirty,priorPending=state.pending;
      const data=state.values[item.id];data.unavailable=false;
      let value=data.offers.find(v=>v.offerId===offerId);
      if(adding){if(data.offers.length>=5)return;value=Core.emptyOffer(item,operationId());data.offers.push(value);}
      if(!value)value=data.offers[0];
      if(!value){value=Core.emptyOffer(item,operationId());data.offers.push(value);}
      const key=fieldKey(item.id,value.offerId),dialog=el('dialog','review-dialog offer-edit-dialog'),title=el('h2','',`${index+1}. ${item.name}`),body=el('div','offer-edit-body');
      title.id='offerEditTitle';title.tabIndex=-1;dialog.setAttribute('aria-labelledby',title.id);state.offerDialog=dialog;
      state.fields.clear();state.offerValues.clear();state.offerValues.set(key,{item,value});
      body.append(offerCard({...item,id:key},index+'-edit',0));
      let committed=false;
      function commit(){committed=true;state.dirty=true;state.pending=null;saveDraft();dialog.close();}
      dialog.removeOffer=()=>{data.offers=data.offers.filter(v=>v!==value);commit();};
      const actions=el('div','offer-edit-actions'),save=button('Salvar','primary',()=>{
        const built=Core.buildAnswers({...state.quotation,items:[item]},{[item.id]:data});
        const errors=built.errors.filter(error=>error.offerId===value.offerId);
        if(data.offers.some(other=>other!==value&&other.brand&&other.brand.trim().toLocaleLowerCase('pt-BR')===value.brand.trim().toLocaleLowerCase('pt-BR'))&&!errors.some(e=>e.field==='brand'))errors.push({itemId:item.id,offerId:value.offerId,field:'brand',message:'Esta marca já foi informada. Edite a oferta existente.'});
        if(errors.length){showErrors(errors);return;}commit();
      }),back=button('Voltar','secondary',()=>dialog.close());actions.append(save,back);dialog.append(title,body,actions);document.body.append(dialog);
      const fit=()=>{const vp=window.visualViewport;dialog.style.top=((vp?.offsetTop||0)+12)+'px';dialog.style.maxHeight=Math.max(160,(vp?.height||innerHeight)-24)+'px';};
      dialog.addEventListener('close',()=>{
        closeUnitChoice();if(!committed){state.values[item.id]=original;state.dirty=priorDirty;state.pending=priorPending;saveDraft();}
        window.visualViewport?.removeEventListener('resize',fit);window.visualViewport?.removeEventListener('scroll',fit);dialog.remove();state.offerDialog=null;renderForm();
        document.getElementById('item-'+index)?.focus({preventScroll:true});
      });
      dialog.showModal();fit();window.visualViewport?.addEventListener('resize',fit);window.visualViewport?.addEventListener('scroll',fit);updateTotals();title.focus({preventScroll:true});
    }
    function itemCard(item,index){
      const data=state.values[item.id],card=el('section','item-card compact-quotation-item'),head=el('div','item-header'),name=el('h3','',`${index+1}. ${item.name}`);
      name.id='item-'+index;name.tabIndex=-1;card.setAttribute('aria-labelledby',name.id);
      const requestedUnit=item.units.find(unit=>unit.id===item.unitId),requested=el('p','requested',`${number(item.quantity)} × ${requestedUnit.label}`);head.append(name,requested);card.append(head);
      const filled=data.offers.filter(v=>!v.excluded&&(v.brand||Core.decimal(v.unitPrice)>0||v.commercialization));
      const complete=!data.unavailable&&filled.some(v=>v.brand&&Core.decimal(v.unitPrice)>0&&v.commercialization);
      if(!data.unavailable&&filled.length){
        for(const value of filled){
          const row=el('div','saved-offer-summary'),copy=el('div'),price=Core.decimal(value.unitPrice),quantity=quantityFor(item,value);
          copy.append(el('strong','',value.brand||'Selecionar marca'));
          if(price>0)copy.append(el('span','',`${currency(price,4)} / ${Core.priceUnitLabel(item,value)} · Total ${currency(Core.offerTotal(item,{...value,quantity,unitPrice:price}))}`));
          const c=value.commercialization;if(c)copy.append(el('small','',c.kind==='unit'?c.label:`${c.label} com ${number(c.amount)} ${c.measure}`));
          if(value.observation)copy.append(el('small','summary-observation',value.observation));
          row.append(copy,button('Editar','summary-edit',()=>editOffer(item,index,value.offerId)));card.append(row);
        }
      }
      const actions=el('div','compact-item-actions');
      if(!complete){
        actions.append(button('Informar preço','inform-price',()=>editOffer(item,index,data.offers[0]?.offerId)));
        const unavailable=button('Item\nindisponível','availability-toggle',()=>{data.unavailable=!data.unavailable;state.dirty=true;state.pending=null;saveDraft();renderForm();});unavailable.setAttribute('aria-pressed',String(data.unavailable));unavailable.setAttribute('aria-label',`Indisponível: ${item.name}`);actions.append(unavailable);
      }else if(data.offers.length<5)actions.append(button('Adicionar nova marca','add-brand-offer',()=>editOffer(item,index,null,true)));
      card.append(actions);if(state.quotation.auctionEnabled&&state.quotation.status==='answered')card.append(auctionPrice(item.id));return card;
    }
    function renderForm(message=''){
      closeUnitChoice();
      state.fields.clear();state.offerValues.clear();state.itemSaveButtons.clear();const form=el('form');form.noValidate=true;form.addEventListener('submit',event=>{event.preventDefault();review();});
      const heading=el('div','section-heading quotation-heading');progress=el('span','progress');progress.setAttribute('role','status');heading.append(el('h2','','Cotação'),quotationDeadline(state.quotation),progress);form.append(heading);
      formNotice=el('div');if(message)formNotice.append(notice(message,'warning'));form.append(formNotice);
      const auction=auctionPanel();if(auction)form.append(auction);
      const list=el('div','item-list');state.quotation.items.forEach((item,index)=>list.append(itemCard(item,index)));form.append(list);
      const actions=el('div','proposal-actions'),summary=el('div','proposal-summary');summaryCount=el('span');totalAmount=el('strong');summary.append(summaryCount,totalAmount);const submit=button('Revisar proposta','primary');submit.type='submit';submit.append(icon('arrow'));actions.append(summary,submit);form.append(actions);
      root.replaceChildren(header(state.quotation),form);root.setAttribute('aria-busy','false');updateTotals();
    }
    function showErrors(errors){
      const firstError=errors[0];
      if(firstError&&!state.offerDialog?.open){const index=state.quotation.items.findIndex(item=>item.id===firstError.itemId);if(index>=0)editOffer(state.quotation.items[index],index,firstError.offerId);}
      for(const {itemId,offerId,field,message}of errors){const ref=state.fields.get(fieldKey(itemId,offerId))?.[field];if(!ref)continue;ref.input.setAttribute('aria-invalid','true');ref.error.textContent=message;ref.error.hidden=false;}
      const first=errors[0],ref=state.fields.get(fieldKey(first?.itemId,first?.offerId))?.[first?.field];if(ref){ref.input.focus();ref.wrap.scrollIntoView({block:'center',behavior:'auto'});}
    }
    function review(){
      if(state.busy)return;
      closeUnitChoice();
      const {answers,errors}=Core.buildAnswers(state.quotation,state.values);if(errors.length){showErrors(errors);return;}
      const signature=Core.signature(state.quotation.revision,answers);
      if(state.pending?.signature!==signature)state.pending={operationId:operationId(),expectedRevision:state.quotation.revision,answers,signature};
      saveDraft();state.dialog?.remove();
      const dialog=el('dialog','review-dialog');state.dialog=dialog;dialog.setAttribute('aria-labelledby','reviewTitle');dialog.addEventListener('cancel',event=>{if(state.busy)event.preventDefault();});
      const title=el('h2','','Revisar proposta');title.id='reviewTitle';title.tabIndex=-1;
      const body=el('div','review-body');body.append(el('p','',`Confira os dados que serão enviados para ${state.quotation.restaurantName}.`),answerList(state.quotation,answers));
      const totals=el('div','review-total',hasAlternatives(answers)?'Menor total por item':'Total ofertado');totals.append(el('strong','',currency(Core.summary(answers,state.quotation.items).total)));body.append(totals);
      const feedback=el('div'),actions=el('div','dialog-actions'),back=button('Voltar','secondary',closeReview),send=button('Enviar proposta','primary',()=>submit(feedback,back,send));actions.append(back,send);dialog.append(title,body,feedback,actions);document.body.append(dialog);dialog.showModal();title.focus({preventScroll:true});
    }
    async function submit(feedback,back,send){
      if(state.busy||!state.pending)return;
      state.busy=true;back.disabled=true;send.disabled=true;send.textContent='Enviando…';feedback.replaceChildren();
      const {operationId,expectedRevision,answers}=state.pending;
      try{
        const result=await transport('quotation_submit',{operationId,expectedRevision,answers});state.quotation=Core.quotationFromResponse(result);clearDraft();state.dialog.close();receipt();
      }catch(error){
        const code=error.code||error.message;
        if(code==='quotation_conflict'||code==='quotation_closed'){state.dialog.close();state.pending=null;await load({preserve:true,message:errorText(code)});}
        else if(code==='quotation_unavailable'){state.dialog.close();fatal(code,false);}
        else feedback.replaceChildren(notice(errorText(code),'error'));
      }finally{state.busy=false;back.disabled=false;send.disabled=false;send.textContent='Enviar proposta';}
    }
    async function load({preserve=false,message=''}={}){
      if(state.loading)return;state.loading=true;
      root.setAttribute('aria-busy','true');if(!preserve)root.replaceChildren(el('div','state-panel','Carregando cotação…'));
      try{
        state.quotation=Core.quotationFromResponse(await transport('quotation_view'));
        auctionClosed=false;
        const keepMemory=preserve&&Boolean(state.values),saved=keepMemory?null:savedDraft(),previous=keepMemory?state.values:saved?.values;
        state.values=Core.draftForQuotation(state.quotation,previous);state.pending=keepMemory?state.pending:saved?.pending||null;state.dirty=keepMemory?state.dirty:Boolean(saved?.dirty);state.localSaved=Boolean(saved)||keepMemory&&state.localSaved;
        const currentAnswers=Core.buildAnswers(state.quotation,Core.draftForQuotation(state.quotation)).answers;
        const accepted=state.pending&&state.pending.expectedRevision!==state.quotation.revision&&Core.signature(0,state.pending.answers)===Core.signature(0,currentAnswers);
        if(state.quotation.status==='ordered'||accepted||state.quotation.status==='answered'&&!state.dirty){clearDraft();receipt();return;}
        if(saved&&saved.revision!==state.quotation.revision){state.pending=null;message=errorText('quotation_conflict');}
        renderForm(message);
      }catch(error){fatal(error.code||error.message,error.code!=='quotation_unavailable');}finally{state.loading=false;}
    }
    if(!token){fatal('missing_token',false);return;}
    await load();
  }
  global.AloPublicQuotation={start};
})(window);
