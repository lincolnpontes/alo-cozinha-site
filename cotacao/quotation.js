(function(global){
  'use strict';
  const Core=global.AloQuotationCore;
  const ENDPOINT='https://sxbcjzshcjxzladwptiu.supabase.co/functions/v1/alo-cozinha-sync?publicquotation=1';
  const currency=(value,precision=2)=>Number(value).toLocaleString('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:precision});
  const number=value=>Number(value).toLocaleString('pt-BR',{maximumFractionDigits:6});
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
    const transport=options.transport||((action,payload)=>request(token,action,payload));
    const state={quotation:null,values:null,pending:null,busy:false,loading:false,dirty:false,key:'',storage:null,localSaved:false,fields:new Map(),dialog:null,unitChoice:null};
    let progress,totalAmount,summaryCount,formNotice;
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
      const brand=document.querySelector('.brand-inner');if(brand){brand.replaceChildren();if(/^data:image\/(png|jpeg|webp);base64,/i.test(quotation.logoDataUrl||'')){const logo=el('img','restaurant-logo');logo.src=quotation.logoDataUrl;logo.alt=quotation.restaurantName||'Restaurante';brand.append(logo);}else brand.append(el('strong','restaurant-name',quotation.restaurantName||'Alô Cozinha'));}
      const deadline=el('p','deadline');deadline.append(icon('clock'),el('span','',`Responder até ${date(quotation.expiresAt)}`));panel.append(supplier,recipient,deadline);
      return panel;
    }
    function answerList(quotation,answers){
      const list=el('ul','answer-list');
      for(const item of quotation.items){
        const answer=answers.find(value=>value.itemId===item.id);if(!answer)continue;
        const row=el('li',`answer-item${answer.unavailable?' unavailable':''}`);row.append(el('strong','',item.name));
        if(answer.unavailable)row.append(el('p','','Indisponível'));
        else{
          const label=Core.offerUnitLabel(item,answer);
          row.append(el('p','',`${number(answer.quantity)} × ${label}${answer.brand?' · '+answer.brand:''}`));
          row.append(el('p','answer-price',`${currency(answer.unitPrice,4)} por ${Core.priceUnitLabel(item,answer)} · Total ${currency(Core.offerTotal(item,answer))}`));
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
      if((q.answers||[]).length){panel.append(el('h2','submitted-heading','Sua resposta'),answerList(q,q.answers));const totals=Core.summary(q.answers,q.items),line=el('div','review-total','Total ofertado');line.append(el('strong','',currency(totals.total)));panel.append(line);}
      if(!closed)panel.append(button('Editar proposta','secondary',()=>{state.values=Core.draftForQuotation(q);state.pending=null;renderForm();}));
      root.replaceChildren(header(q),panel);panel.classList.add('receipt-panel');root.setAttribute('aria-busy','false');heading.focus({preventScroll:true});
    }
    function updateTotals(){
      const built=Core.buildAnswers(state.quotation,state.values),invalid=new Set(built.errors.map(error=>error.itemId)),totals=Core.summary(built.answers,state.quotation.items);
      progress.textContent='';progress.hidden=true;
      totalAmount.textContent=currency(totals.total);
      summaryCount.textContent=`${totals.count} ${totals.count===1?'item ofertado':'itens ofertados'}${totals.unavailable?' · '+totals.unavailable+' indisponíveis':''}`;
      for(const item of state.quotation.items){const refs=state.fields.get(item.id),value=state.values[item.id],quantity=Core.decimal(value.quantity),price=Core.decimal(value.unitPrice);refs.total.textContent=!value.unavailable&&quantity>0&&price>0?currency(Core.offerTotal(item,{...value,quantity,unitPrice:price})):'—';refs.refreshPriceUnit();}
    }
    function changed(itemId,field,value){
      const customKey={customLabel:'label',customAmount:'amount',customMeasure:'measure'}[field];
      if(customKey)state.values[itemId].customUnit[customKey]=value;else state.values[itemId][field]=value;
      if(field==='brand'&&state.values[itemId].brandMode==='other')state.values[itemId].otherBrand=value;
      state.dirty=true;state.pending=null;
      const refs=state.fields.get(itemId);
      if(field==='unitId'){state.values[itemId].quantity='';refs.quantity.input.value='';const resolved=Core.offerUnit(state.quotation.items.find(item=>item.id===itemId),state.values[itemId]);if(!resolved?.factor)state.values[itemId].priceBasis='package';}
      if(['unitId','priceBasis'].includes(field)||(['customAmount','customMeasure'].includes(field)&&state.values[itemId].priceBasis!=='base')){state.values[itemId].unitPrice='';refs.unitPrice.input.value='';}
      for(const ref of Object.values(refs)){if(ref?.input){ref.input.removeAttribute('aria-invalid');ref.error.hidden=true;}}
      refs.fields.hidden=state.values[itemId].unavailable;refs.brand.wrap.hidden=state.values[itemId].unavailable;refs.availability.setAttribute('aria-pressed',String(state.values[itemId].unavailable));
      refs.availability.title=state.values[itemId].unavailable?'Voltar a ofertar este item':'Marcar item como indisponível';
      refs.customFields.hidden=state.values[itemId].unitId!=='__custom__';
      updateTotals();saveDraft();
    }
    function closeUnitChoice(focus=false){
      const choice=state.unitChoice;if(!choice)return;
      choice.menu.hidden=true;choice.trigger.setAttribute('aria-expanded','false');state.unitChoice=null;
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
      function open(){closeUnitChoice();menu.hidden=false;const rect=trigger.getBoundingClientRect(),below=window.innerHeight-rect.bottom-12,above=rect.top-12,useAbove=below<220&&above>below;menu.style.top=useAbove?'auto':'calc(100% + 5px)';menu.style.bottom=useAbove?'calc(100% + 5px)':'auto';menu.style.maxHeight=Math.max(100,Math.min(430,useAbove?above:below))+'px';trigger.setAttribute('aria-expanded','true');state.unitChoice=choice;(menu.querySelector('[aria-selected="true"]')||menu.firstElementChild)?.focus({preventScroll:true});}
      trigger.addEventListener('click',()=>menu.hidden?open():closeUnitChoice());
      trigger.addEventListener('keydown',event=>{if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();open();}else if(event.key==='Escape')closeUnitChoice();});
      container.addEventListener('focusout',event=>{if(state.unitChoice===choice&&!container.contains(event.relatedTarget))closeUnitChoice();});
      container.append(trigger,menu);return choice;
    }
    function unitChoice(item,index){
      const options=[...item.units];if(Core.customMeasures(item).length)options.push({id:'__custom__',label:'Outra embalagem'});
      return choiceMenu(item,index,'unit','Embalagem',options,state.values[item.id].unitId,id=>{if(state.values[item.id].unitId!==id)changed(item.id,'unitId',id);});
    }
    function field(item,index,key,label,type='text'){
      const wrap=el('div','field'),id=`offer-${index}-${key}`,labelNode=el('label','',label);labelNode.htmlFor=id;
      const choice=type==='select'?unitChoice(item,index):null,input=choice?choice.trigger:el('input');input.id=id;
      if(type!=='select'){input.type='text';input.autocomplete='off';input.maxLength=['brand','customLabel'].includes(key)?120:24;if(!['brand','customLabel'].includes(key))input.inputMode='decimal';}
      const customKey={customLabel:'label',customAmount:'amount'}[key];
      input.value=(customKey?state.values[item.id].customUnit[customKey]:state.values[item.id][key])??'';
      if(key==='unitPrice'){
        const initial=Core.decimal(input.value);if(Number.isFinite(initial))input.value=Core.formatPrice(initial);
        let precise=Number.isFinite(initial)&&Math.abs(initial-Number(initial.toFixed(2)))>1e-9;
        input.addEventListener('beforeinput',event=>{if(event.inputType==='insertText'&&input.selectionStart===0&&input.selectionEnd===input.value.length)precise=false;});
        input.addEventListener('paste',event=>{event.preventDefault();const pasted=event.clipboardData?.getData('text')||'',formatted=Core.priceFromPaste(pasted);input.value=formatted===null?pasted.trim().slice(0,24):formatted;const amount=Core.decimal(input.value);precise=Number.isFinite(amount)&&Math.abs(amount-Number(amount.toFixed(2)))>1e-9;changed(item.id,key,input.value);});
        input.addEventListener('input',()=>{if(!precise)input.value=Core.priceFromTyping(input.value);if(!input.value)precise=false;changed(item.id,key,input.value);});
      }else if(type!=='select')input.addEventListener('input',()=>changed(item.id,key,input.value));
      const error=el('p','field-error');error.id=id+'-error';error.hidden=true;input.setAttribute('aria-describedby',error.id);
      wrap.append(labelNode);
      if(key==='unitPrice'){const money=el('div','money-input');money.append(el('span','','R$'),input);wrap.append(money);input.placeholder='0,00';}else wrap.append(choice?choice.container:input);
      wrap.append(error);return {wrap,input,error,label:labelNode};
    }
    function brandField(item,index){
      const ref=field(item,index,'brand','Marca'),value=state.values[item.id],key=text=>String(text||'').trim().toLocaleLowerCase('pt-BR');
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
        input.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();save.click();}});wrap.append(label,input,error);actions.append(cancel,save);dialog.append(title,wrap,actions);document.body.append(dialog);
        dialog.addEventListener('close',()=>{dialog.remove();choice.trigger.focus({preventScroll:true});});dialog.showModal();input.focus({preventScroll:true});
      }
      ref.input.remove();ref.input=choice.trigger;choice.trigger.id=`offer-${index}-brand-choice`;ref.label.htmlFor=choice.trigger.id;choice.trigger.setAttribute('aria-describedby',ref.error.id);ref.wrap.insertBefore(choice.container,ref.error);refreshBrand();return ref;
    }
    function customPackaging(item,index){
      const group=el('div','custom-packaging'),label=field(item,index,'customLabel','Nome da embalagem'),amount=field(item,index,'customAmount','Conteúdo por embalagem'),wrap=el('div','field'),measureLabel=el('label','','Medida');
      const choice=choiceMenu(item,index,'measure','Medida',Core.customMeasures(item),state.values[item.id].customUnit.measure,id=>{if(state.values[item.id].customUnit.measure!==id)changed(item.id,'customMeasure',id);});
      choice.trigger.id=`offer-${index}-customMeasure`;measureLabel.htmlFor=choice.trigger.id;
      const error=el('p','field-error');error.id=choice.trigger.id+'-error';error.hidden=true;choice.trigger.setAttribute('aria-describedby',error.id);wrap.append(measureLabel,choice.container,error);
      const row=el('div','custom-content-row');row.append(amount.wrap,wrap);label.input.placeholder='Ex.: saco, caixa ou pote';amount.input.placeholder='Ex.: 5';group.append(label.wrap,row);group.hidden=state.values[item.id].unitId!=='__custom__';
      return {group,customLabel:label,customAmount:amount,customMeasure:{wrap,input:choice.trigger,error,label:measureLabel}};
    }
    function itemCard(item,index){
      const card=el('section','item-card'),head=el('div','item-header'),name=el('h3','',item.name),availability=el('button','availability-toggle','Item\nindisponível');
      name.id='item-'+index;availability.type='button';availability.setAttribute('aria-pressed',String(state.values[item.id].unavailable));availability.setAttribute('aria-label',`Indisponível: ${item.name}`);availability.title=state.values[item.id].unavailable?'Voltar a ofertar este item':'Marcar item como indisponível';availability.addEventListener('click',()=>changed(item.id,'unavailable',!state.values[item.id].unavailable));
      card.setAttribute('aria-labelledby',name.id);
      const requestedUnit=item.units.find(unit=>unit.id===item.unitId),requested=el('p','requested',`${number(item.quantity)} × ${requestedUnit.label}`);head.append(name,requested);card.append(head);
      const fields=el('div','offer-fields'),brand=brandField(item,index),quantity=field(item,index,'quantity','Qtde'),unitId=field(item,index,'unitId','Unidade','select'),unitPrice=field(item,index,'unitPrice','Preço por unidade'),row=el('div','offer-row'),custom=customPackaging(item,index);
      const brandRow=el('div','brand-row');brandRow.append(brand.wrap,availability);brand.wrap.hidden=state.values[item.id].unavailable;card.append(brandRow);
      row.append(quantity.wrap,unitId.wrap);fields.append(row,custom.group);
      const priceHeading=el('div','price-unit-heading');unitPrice.label.textContent='Preço por';unitPrice.label.replaceWith(priceHeading);priceHeading.append(unitPrice.label);
      let priceKey='';function refreshPriceUnit(){const value=state.values[item.id],resolved=Core.offerUnit(item,value),canBase=resolved?.factor>0&&['kg','L','un'].includes(resolved.base),label=Core.offerUnitLabel(item,value),key=JSON.stringify([label,canBase,resolved?.base,value.priceBasis]);if(key===priceKey)return;priceKey=key;priceHeading.replaceChildren(unitPrice.label);const options=[{id:'package',label}];if(canBase&&!(resolved.factor===1&&label===resolved.base))options.push({id:'base',label:resolved.base});if(options.length===1){unitPrice.label.textContent='Preço por '+(value.priceBasis==='base'?resolved.base:label);}else{unitPrice.label.textContent='Preço por';const choice=choiceMenu(item,index,'priceBasis','Unidade do preço',options,value.priceBasis||'package',id=>{if(id!==value.priceBasis)changed(item.id,'priceBasis',id);});priceHeading.append(choice.container);}}
      const itemTotal=el('div','item-total'),total=el('strong','','—'),priceRow=el('div','price-total-row');itemTotal.append(el('span','','Total'),total);priceRow.append(unitPrice.wrap,itemTotal);fields.append(priceRow);
      fields.hidden=state.values[item.id].unavailable;card.append(fields);
      state.fields.set(item.id,{brand,quantity,unitId,unitPrice,fields,availability,total,priceLabel:unitPrice.label,refreshPriceUnit,customFields:custom.group,customLabel:custom.customLabel,customAmount:custom.customAmount,customMeasure:custom.customMeasure});return card;
    }
    function renderForm(message=''){
      closeUnitChoice();
      state.fields.clear();const form=el('form');form.noValidate=true;form.addEventListener('submit',event=>{event.preventDefault();review();});
      const heading=el('div','section-heading');progress=el('span','progress');progress.setAttribute('role','status');heading.append(el('h2','','Proposta'),progress);form.append(heading);
      formNotice=el('div');if(message)formNotice.append(notice(message,'warning'));form.append(formNotice);
      const list=el('div','item-list');state.quotation.items.forEach((item,index)=>list.append(itemCard(item,index)));form.append(list);
      const actions=el('div','proposal-actions'),summary=el('div','proposal-summary');summaryCount=el('span');totalAmount=el('strong');summary.append(summaryCount,totalAmount);const submit=button('Revisar proposta','primary');submit.type='submit';submit.append(icon('arrow'));actions.append(summary,submit);form.append(actions);
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
      const totals=el('div','review-total','Total ofertado');totals.append(el('strong','',currency(Core.summary(answers,state.quotation.items).total)));body.append(totals);
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
