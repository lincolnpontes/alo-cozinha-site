(function(global){
  'use strict';
  const Core=global.AloQuotationCore;
  const ENDPOINT='https://sxbcjzshcjxzladwptiu.supabase.co/functions/v1/alo-cozinha-sync?publicquotation=1';
  const currency=value=>Number(value).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  const number=value=>Number(value).toLocaleString('pt-BR',{maximumFractionDigits:6});
  const date=value=>{const parsed=new Date(value);return Number.isFinite(parsed.getTime())?parsed.toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',timeZoneName:'short'}):'Prazo não informado';};
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
    const transport=options.transport||((action,payload)=>request(token,action,payload));
    const state={quotation:null,values:null,pending:null,busy:false,loading:false,dirty:false,key:'',storage:null,localSaved:false,fields:new Map(),dialog:null,unitChoice:null};
    let progress,totalAmount,summaryCount,draftNote,formNotice;
    try{state.storage=options.storage===false?null:options.storage||global.localStorage;state.key=await draftKey(token);}catch(error){state.storage=null;}
    function saveDraft(){
      if(!state.quotation||!state.values||!state.key||!state.storage)return;
      try{
        const deadline=Date.parse(state.quotation.expiresAt),expiresAt=Math.min(Date.now()+7*86400000,Number.isFinite(deadline)?deadline+86400000:Infinity);
        state.storage.setItem(state.key,JSON.stringify({quotationId:state.quotation.id,revision:state.quotation.revision,expiresAt,values:state.values,pending:state.pending,dirty:state.dirty}));state.localSaved=true;
      }catch(error){state.localSaved=false;}
      if(draftNote)draftNote.textContent=state.localSaved?'Rascunho salvo neste navegador.':'Rascunho mantido enquanto esta página estiver aberta.';
    }
    function savedDraft(){
      try{const saved=JSON.parse(state.storage?.getItem(state.key)||'null');if(saved?.quotationId===state.quotation.id&&saved.expiresAt>Date.now())return saved;}catch(error){}
      return null;
    }
    function clearDraft(){try{state.storage?.removeItem(state.key);}catch(error){}state.dirty=false;state.pending=null;state.localSaved=false;}
    function closeReview(){if(state.busy)return;state.dialog?.close();}
    function fatal(code,retry=true){
      state.dialog?.close();root.setAttribute('aria-busy','false');
      const panel=el('section','state-panel'),mark=el('div','state-mark');mark.append(icon('alert'));
      const heading=el('h1','',code==='missing_token'?'Abra o link da cotação':'Cotação indisponível');heading.tabIndex=-1;
      panel.append(mark,heading,el('p','',code==='missing_token'?'Use o link que o restaurante enviou para você responder à cotação.':errorText(code)));
      if(retry)panel.append(button('Tentar novamente','primary',()=>load({preserve:true})));
      root.replaceChildren(panel);heading.focus({preventScroll:true});
    }
    function header(quotation){
      const panel=el('section','request-summary');
      panel.append(el('span','eyebrow','Solicitação de cotação'),el('h1','',quotation.restaurantName||'Restaurante'));
      const recipient=el('p','recipient','Para ');recipient.append(el('strong','',quotation.supplierName||'Fornecedor'));panel.append(recipient);
      const deadline=el('p','deadline');deadline.append(icon('clock'),el('span','',`Responder até ${date(quotation.expiresAt)}`));panel.append(deadline);
      if(quotation.title)panel.append(el('p','quotation-title',quotation.title));
      return panel;
    }
    function answerList(quotation,answers){
      const list=el('ul','answer-list');
      for(const item of quotation.items){
        const answer=answers.find(value=>value.itemId===item.id);if(!answer)continue;
        const row=el('li',`answer-item${answer.unavailable?' unavailable':''}`);row.append(el('strong','',item.name));
        if(answer.unavailable)row.append(el('p','','Indisponível'));
        else{
          const unit=item.units.find(unit=>unit.id===answer.unitId);
          row.append(el('p','',`${number(answer.quantity)} × ${unit?.label||'Unidade'}${answer.brand?' · '+answer.brand:''}`));
          row.append(el('p','answer-price',`${currency(answer.unitPrice)} por ${unit?.label||'unidade'} · Total ${currency(answer.quantity*answer.unitPrice)}`));
        }
        list.append(row);
      }
      return list;
    }
    function receipt(){
      const q=state.quotation,closed=q.status==='ordered',panel=el('section','state-panel'),mark=el('div',closed?'state-mark':'state-mark success');mark.append(icon(closed?'clock':'check'));
      const heading=el('h1','',closed?'Cotação encerrada':'Proposta enviada');heading.tabIndex=-1;
      panel.append(mark,heading,el('p','',closed?'O restaurante encerrou esta cotação. Não é mais possível enviar ou alterar a proposta.':`${q.restaurantName||'O restaurante'} recebeu sua proposta.`));
      if(q.submittedAt)panel.append(el('p','',`Enviada em ${date(q.submittedAt)}`));
      if(!closed)panel.append(el('p','','Você pode atualizar os valores até o prazo da cotação.'));
      if((q.answers||[]).length){panel.append(el('h2','submitted-heading','Sua resposta'),answerList(q,q.answers));const totals=Core.summary(q.answers),line=el('div','review-total','Total ofertado');line.append(el('strong','',currency(totals.total)));panel.append(line);}
      if(!closed)panel.append(button('Editar proposta','secondary',()=>{state.values=Core.draftForQuotation(q);state.pending=null;renderForm();}));
      root.replaceChildren(header(q),panel);panel.classList.add('receipt-panel');root.setAttribute('aria-busy','false');heading.focus({preventScroll:true});
    }
    function updateTotals(){
      const built=Core.buildAnswers(state.quotation,state.values),invalid=new Set(built.errors.map(error=>error.itemId)),totals=Core.summary(built.answers);
      progress.textContent=`${state.quotation.items.length-invalid.size} de ${state.quotation.items.length} respondidos`;
      totalAmount.textContent=currency(totals.total);
      summaryCount.textContent=`${totals.count} ${totals.count===1?'item ofertado':'itens ofertados'}${totals.unavailable?' · '+totals.unavailable+' indisponíveis':''}`;
      for(const item of state.quotation.items){const refs=state.fields.get(item.id),value=state.values[item.id],quantity=Core.decimal(value.quantity),price=Core.decimal(value.unitPrice),unit=item.units.find(unit=>unit.id===value.unitId);refs.total.textContent=!value.unavailable&&quantity>0&&price>0?currency(quantity*price):'—';refs.priceLabel.textContent=`Preço por ${unit?.label||'unidade'}`;}
    }
    function changed(itemId,field,value){
      state.values[itemId][field]=value;state.dirty=true;state.pending=null;
      const refs=state.fields.get(itemId);
      if(field==='unitId'){state.values[itemId].quantity='';state.values[itemId].unitPrice='';refs.quantity.input.value='';refs.unitPrice.input.value='';}
      for(const ref of Object.values(refs)){if(ref?.input){ref.input.removeAttribute('aria-invalid');ref.error.hidden=true;}}
      refs.fields.hidden=state.values[itemId].unavailable;refs.unavailable.hidden=!state.values[itemId].unavailable;
      updateTotals();saveDraft();
    }
    function closeUnitChoice(focus=false){
      const choice=state.unitChoice;if(!choice)return;
      choice.menu.hidden=true;choice.trigger.setAttribute('aria-expanded','false');state.unitChoice=null;
      if(focus)choice.trigger.focus();
    }
    function unitChoice(item,index){
      const container=el('div','unit-choice'),trigger=el('button','unit-choice-trigger'),copy=el('span'),menu=el('div','unit-choice-menu');
      trigger.type='button';trigger.value=state.values[item.id].unitId;copy.textContent=item.units.find(unit=>unit.id===trigger.value)?.label||'Escolher embalagem';
      trigger.append(copy,icon('arrow'));trigger.setAttribute('aria-haspopup','listbox');trigger.setAttribute('aria-expanded','false');trigger.setAttribute('aria-controls','unit-options-'+index);
      menu.id='unit-options-'+index;menu.hidden=true;menu.setAttribute('role','listbox');menu.setAttribute('aria-label',`Embalagem de ${item.name}`);
      const choice={container,trigger,menu};
      for(const [position,unit]of item.units.entries()){
        const option=el('button','unit-choice-option');option.type='button';option.setAttribute('role','option');option.setAttribute('aria-selected',String(unit.id===trigger.value));option.append(el('span','',unit.label),icon('check'));
        option.addEventListener('click',()=>{
          if(trigger.value!==unit.id){trigger.value=unit.id;copy.textContent=unit.label;changed(item.id,'unitId',unit.id);}
          Array.from(menu.children).forEach((node,i)=>node.setAttribute('aria-selected',String(item.units[i].id===unit.id)));closeUnitChoice(true);
        });
        option.addEventListener('keydown',event=>{
          const steps={ArrowDown:Math.min(item.units.length-1,position+1),ArrowUp:Math.max(0,position-1),Home:0,End:item.units.length-1};
          if(Object.hasOwn(steps,event.key)){event.preventDefault();menu.children[steps[event.key]].focus();}
          else if(event.key==='Escape'){event.preventDefault();closeUnitChoice(true);}
        });
        menu.append(option);
      }
      function open(){closeUnitChoice();menu.hidden=false;trigger.setAttribute('aria-expanded','true');state.unitChoice=choice;menu.querySelector('[aria-selected="true"]')?.focus({preventScroll:true});}
      trigger.addEventListener('click',()=>menu.hidden?open():closeUnitChoice());
      trigger.addEventListener('keydown',event=>{if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();open();}else if(event.key==='Escape')closeUnitChoice();});
      container.addEventListener('focusout',event=>{if(state.unitChoice===choice&&!container.contains(event.relatedTarget))closeUnitChoice();});
      container.append(trigger,menu);return choice;
    }
    function field(item,index,key,label,type='text'){
      const wrap=el('div','field'),id=`offer-${index}-${key}`,labelNode=el('label','',label);labelNode.htmlFor=id;
      const choice=type==='select'?unitChoice(item,index):null,input=choice?choice.trigger:el('input');input.id=id;
      if(type!=='select'){input.type='text';input.autocomplete='off';input.maxLength=key==='brand'?120:24;if(key!=='brand')input.inputMode='decimal';}
      input.value=state.values[item.id][key]??'';if(type!=='select')input.addEventListener('input',()=>changed(item.id,key,input.value));
      const error=el('p','field-error');error.id=id+'-error';error.hidden=true;input.setAttribute('aria-describedby',error.id);
      wrap.append(labelNode);
      if(key==='unitPrice'){const money=el('div','money-input');money.append(el('span','','R$'),input);wrap.append(money);input.placeholder='0,00';}else wrap.append(choice?choice.container:input);
      wrap.append(error);return {wrap,input,error,label:labelNode};
    }
    function itemCard(item,index){
      const card=el('section','item-card'),head=el('div','item-header'),name=el('h3','',item.name);name.id='item-'+index;head.append(el('span','item-number',String(index+1).padStart(2,'0')),name);card.setAttribute('aria-labelledby',name.id);card.append(head);
      const requestedUnit=item.units.find(unit=>unit.id===item.unitId);card.append(el('p','requested',`Solicitado: ${number(item.quantity)} × ${requestedUnit.label}`));
      const availability=el('fieldset','availability');availability.append(el('legend','',`Disponibilidade de ${item.name}`));
      for(const [value,text,symbol]of [['available','Tenho','check'],['unavailable','Indisponível','x']]){
        const label=el('label'),input=el('input'),copy=el('span');input.type='radio';input.name='availability-'+index;input.value=value;input.checked=(value==='unavailable')===state.values[item.id].unavailable;
        input.addEventListener('change',()=>changed(item.id,'unavailable',value==='unavailable'));copy.append(icon(symbol),document.createTextNode(text));label.append(input,copy);availability.append(label);
      }
      card.append(availability);
      const fields=el('div','offer-fields'),brand=field(item,index,'brand','Marca (opcional)'),quantity=field(item,index,'quantity','Quantidade ofertada'),unitId=field(item,index,'unitId','Embalagem / unidade','select'),unitPrice=field(item,index,'unitPrice','Preço por unidade'),row=el('div','offer-row');
      brand.input.placeholder='Nome da marca';row.append(quantity.wrap,unitId.wrap);fields.append(brand.wrap,row,unitPrice.wrap);
      const itemTotal=el('p','item-total','Total deste item'),total=el('strong','','—');itemTotal.append(total);fields.append(itemTotal);
      const unavailable=el('p','unavailable-copy','Este item será informado como indisponível.');fields.hidden=state.values[item.id].unavailable;unavailable.hidden=!fields.hidden;card.append(fields,unavailable);
      state.fields.set(item.id,{brand,quantity,unitId,unitPrice,fields,unavailable,total,priceLabel:unitPrice.label});return card;
    }
    function renderForm(message=''){
      closeUnitChoice();
      state.fields.clear();const form=el('form');form.noValidate=true;form.addEventListener('submit',event=>{event.preventDefault();review();});
      const heading=el('div','section-heading');progress=el('span','progress');progress.setAttribute('role','status');heading.append(el('h2','','Sua proposta'),progress);form.append(heading,el('p','section-help','Informe o que você pode fornecer e o preço de cada embalagem.'));
      formNotice=el('div');if(message)formNotice.append(notice(message,'warning'));form.append(formNotice);
      const list=el('div','item-list');state.quotation.items.forEach((item,index)=>list.append(itemCard(item,index)));form.append(list);
      const actions=el('div','proposal-actions'),summary=el('div','proposal-summary');summaryCount=el('span');totalAmount=el('strong');summary.append(summaryCount,totalAmount);const submit=button('Revisar proposta','primary');submit.type='submit';submit.append(icon('arrow'));draftNote=el('p','draft-note',state.localSaved?'Rascunho salvo neste navegador.':'Seus dados serão enviados após a confirmação.');actions.append(summary,submit,draftNote);form.append(actions);
      root.replaceChildren(header(state.quotation),form);root.setAttribute('aria-busy','false');updateTotals();
    }
    function showErrors(errors){
      for(const {itemId,field,message}of errors){const ref=state.fields.get(itemId)?.[field];if(!ref)continue;ref.input.setAttribute('aria-invalid','true');ref.error.textContent=message;ref.error.hidden=false;}
      const first=errors[0],ref=state.fields.get(first?.itemId)?.[first?.field];if(ref){ref.input.focus();ref.wrap.scrollIntoView({block:'center',behavior:'auto'});}
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
      const totals=el('div','review-total','Total ofertado');totals.append(el('strong','',currency(Core.summary(answers).total)));body.append(totals);
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
