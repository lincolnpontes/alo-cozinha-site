(function(root){
  'use strict';
  const clean=value=>String(value??'').trim();
  function tokenFromFragment(fragment){
    if(!String(fragment||'').startsWith('#'))return '';
    const token=new URLSearchParams(String(fragment||'').replace(/^#/, '')).get('token')||'';
    return /^[A-Za-z0-9_-]{43}$/.test(token)?token:'';
  }
  function decimal(value){
    let input=clean(value).replace(/\s/g,'');
    if(!input)return NaN;
    if(input.includes(',')){
      if(!/^(?:\d+|\d{1,3}(?:\.\d{3})+),\d{1,6}$/.test(input))return NaN;
      input=input.replace(/\./g,'').replace(',','.');
    }
    if(!/^\d+(?:\.\d{1,6})?$/.test(input))return NaN;
    return Number(input);
  }
  function inputNumber(value){return Number.isFinite(Number(value))?String(value).replace('.',','):'';}
  function quantityFromTyping(value){const parts=String(value??'').replace(/[^\d,.]/g,'').replace(/\./g,',').split(',');return parts[0].slice(0,10)+(parts.length>1?','+parts.slice(1).join('').slice(0,6):'');}
  function formatPrice(value){return Number.isFinite(Number(value))?Number(value).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:4}):'';}
  function priceFromTyping(value){
    const digits=String(value??'').replace(/\D/g,'');
    return digits?formatPrice(Number(digits)/100):'';
  }
  function priceFromPaste(value){
    let text=clean(value).replace(/^R\$\s*/i,'').replace(/\s/g,'');
    if(!text.includes(',')&&/^\d{1,3}(?:\.\d{3})+$/.test(text))text=text.replace(/\./g,'');
    const amount=decimal(text);
    return Number.isFinite(amount)&&Math.abs(amount-Number(amount.toFixed(4)))<=1e-9?formatPrice(amount):null;
  }
  const measures=[{id:'kg',label:'kg',base:'kg',factor:1},{id:'g',label:'g',base:'kg',factor:.001},{id:'L',label:'L',base:'L',factor:1},{id:'mL',label:'mL',base:'L',factor:.001},{id:'un',label:'un',base:'un',factor:1}];
  function customMeasures(item){
    const requested=item.units.find(unit=>unit.id===item.unitId),base=requested?.base==='l'?'L':requested?.base;
    return measures.filter(measure=>measure.base===base);
  }
  function offerUnit(item,answer){
    if(answer?.unit?.id===answer.unitId)return answer.unit;
    if(answer?.unitId!=='__custom__')return item.units.find(unit=>unit.id===answer?.unitId);
    const custom=answer.customUnit,measure=customMeasures(item).find(value=>value.id===custom?.measure),amount=decimal(custom?.amount);
    if(!custom||!measure||!(amount>0))return null;
    const label=clean(custom.label)||'Embalagem',suffix=label.match(/([\d.,]+)\s*(kg|g|ml|l|un)\.?$/i),hasContent=suffix&&decimal(suffix[1])===amount&&suffix[2].toLowerCase()===measure.id.toLowerCase();
    return {id:'__custom__',label:hasContent?label:`${label} · ${amount.toLocaleString('pt-BR',{maximumFractionDigits:6})} ${measure.label}`,factor:amount*measure.factor,base:measure.base,custom:true};
  }
  function offerUnitLabel(item,answer){
    const unit=offerUnit(item,answer);
    return unit?.label||(answer?.unitId==='__custom__'?'embalagem':'unidade');
  }
  function priceUnitLabel(item,answer){return answer?.priceBasis==='base'?(offerUnit(item,answer)?.base||'unidade'):offerUnitLabel(item,answer);}
  function offerTotal(item,answer){const factor=answer?.priceBasis==='base'?Number(offerUnit(item,answer)?.factor):1;return Number(answer?.quantity)*Number(answer?.unitPrice)*factor;}
  function quotationFromResponse(response){
    const q=response?.quotation;
    if(response?.status!=='ok'||!q||!q.id||!['open','answered','ordered'].includes(q.status)||!Array.isArray(q.items)||!q.items.length||q.items.length>200)throw new Error('invalid_response');
    const ids=new Set();
    for(const item of q.items){
      if(!item.id||ids.has(item.id)||!Array.isArray(item.units)||!item.units.length||!item.units.some(unit=>unit.id===item.unitId))throw new Error('invalid_response');
      ids.add(item.id);
    }
    return q;
  }
  function draftSingle(quotation,previous){
    const values=Object.create(null);
    for(const item of quotation.items){
      const answer=(previous&&Object.hasOwn(previous,item.id)?previous[item.id]:null)||(quotation.answers||[]).find(value=>value.itemId===item.id);
      const allowed=customMeasures(item),customValid=answer?.unitId==='__custom__'&&allowed.some(measure=>measure.id===answer.customUnit?.measure),unitValid=customValid||item.units.some(unit=>unit.id===answer?.unitId),unitId=unitValid?answer.unitId:item.unitId;
      values[item.id]={priceBasis:answer?.priceBasis==='base'?'base':'package',unavailable:answer?.unavailable===true,unitId,brand:clean(answer?.brand).slice(0,120),observation:clean(answer?.observation).slice(0,500),brandMode:answer?.brandMode||'',otherBrand:clean(answer?.otherBrand).slice(0,120),quantity:answer?(unitValid?String(answer.quantity??''):''):inputNumber(item.quantity),unitPrice:answer&&unitValid?String(answer.unitPrice??''):'',customUnit:{label:clean(answer?.customUnit?.label).slice(0,120),amount:String(answer?.customUnit?.amount??''),measure:allowed.some(measure=>measure.id===answer?.customUnit?.measure)?answer.customUnit.measure:allowed[0]?.id||''}};
    }
    return values;
  }
  function buildSingleAnswers(quotation,values){
    const answers=[],errors=[];
    for(const item of quotation.items){
      const value=values[item.id]||{};
      if(value.unavailable===true){answers.push({itemId:item.id,unavailable:true});continue;}
      const quantity=decimal(value.quantity),unitPrice=decimal(value.unitPrice),brand=clean(value.brand),observation=clean(value.observation);
      if(observation.length>500||/[\u0000-\u001f\u007f]/.test(observation))errors.push({itemId:item.id,field:'observation',message:'Use até 500 caracteres na observação, em uma linha.'});
      let customUnit;
      if(value.unitId==='__custom__'){
        const allowed=customMeasures(item),custom=value.customUnit||{},label=clean(custom.label),amount=decimal(custom.amount);
        if(!allowed.length)errors.push({itemId:item.id,field:'unitId',message:'Escolha uma embalagem cadastrada para este item.'});
        if(!label||label.length>120||/[\u0000-\u001f]/.test(label))errors.push({itemId:item.id,field:'customLabel',message:'Dê um nome à embalagem, com até 120 caracteres.'});
        if(!Number.isFinite(amount)||amount<=0||amount>1e9)errors.push({itemId:item.id,field:'customAmount',message:'Informe o conteúdo de uma embalagem, maior que zero.'});
        if(!allowed.some(measure=>measure.id===custom.measure))errors.push({itemId:item.id,field:'customMeasure',message:'Escolha uma medida compatível com o item solicitado.'});
        customUnit={label,amount,measure:custom.measure};
      }else if(!item.units.some(unit=>unit.id===value.unitId))errors.push({itemId:item.id,field:'unitId',message:'Escolha uma embalagem permitida.'});
      if(!Number.isFinite(quantity)||quantity<=0||quantity>1e9)errors.push({itemId:item.id,field:'quantity',message:'Informe uma quantidade maior que zero.'});
      if(!Number.isFinite(unitPrice)||unitPrice<=0||unitPrice>1e8)errors.push({itemId:item.id,field:'unitPrice',message:'Informe um preço válido para essa embalagem.'});
      else if(Math.abs(unitPrice-Number(unitPrice.toFixed(4)))>1e-9)errors.push({itemId:item.id,field:'unitPrice',message:'Use até 4 casas decimais no preço.'});
      if(!brand)errors.push({itemId:item.id,field:'brand',message:'Informe a marca deste produto.'});
      if((item.rejectedBrands||[]).some(name=>clean(name).toLocaleLowerCase('pt-BR')===brand.toLocaleLowerCase('pt-BR')))errors.push({itemId:item.id,field:'brand',message:'Esta marca não é aceita pelo restaurante.'});
      if(brand.length>120||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(brand))errors.push({itemId:item.id,field:'brand',message:'Confira a marca e use até 120 caracteres.'});
      if(value.priceBasis&& !['package','base'].includes(value.priceBasis))errors.push({itemId:item.id,field:'unitPrice',message:'Escolha a unidade do preço.'});
      if(value.priceBasis==='base'){const resolved=offerUnit(item,{...value,customUnit});if(!resolved?.factor||!['kg','L','un'].includes(resolved.base))errors.push({itemId:item.id,field:'unitPrice',message:'Informe o conteúdo da embalagem para cotar por medida.'});}
      answers.push({itemId:item.id,unitId:value.unitId,brand,quantity,unitPrice,unavailable:false,...(observation?{observation}:{}),...(value.priceBasis==='base'?{priceBasis:'base'}:{}),...(customUnit?{customUnit}:{})});
    }
    return {answers,errors};
  }
  function offerQuantity(item,answer){
    const requested=item.units.find(unit=>unit.id===item.unitId),offered=offerUnit(item,answer);
    if(requested?.base&&requested.base===offered?.base&&requested.factor>0&&offered.factor>0){
      // Decimal arithmetic matches PostgreSQL round(numeric,6), including half-way values.
      const fraction=value=>{const [mantissa,exponent='0']=String(value).toLowerCase().split('e'),parts=mantissa.split('.'),scale=(parts[1]?.length||0)-Number(exponent),n=BigInt(parts.join(''));return scale>=0?[n,10n**BigInt(scale)]:[n*10n**BigInt(-scale),1n];};
      try{const [qn,qd]=fraction(item.quantity),[rn,rd]=fraction(requested.factor),[on,od]=fraction(offered.factor),n=qn*rn*od*1000000n,d=qd*rd*on;return d>0n?Number(n/d+(n%d*2n>=d?1n:0n))/1000000:null;}catch{return null;}
    }
    return requested?.id===offered?.id?Number(item.quantity):null;
  }
  function emptyOffer(item,id){
    return {...draftSingle({items:[item]})[item.id],offerId:id||root.crypto?.randomUUID?.()||'offer-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2),commercialization:null};
  }
  const brandKey=value=>clean(value).toLocaleLowerCase('pt-BR').replace(/\s+/g,' ');
  function draftForQuotation(quotation,previous){
    const values=Object.create(null);
    for(const item of quotation.items){
      const saved=(quotation.answers||[]).filter(a=>a.itemId===item.id),excluded=saved.filter(a=>a.excluded),old=previous?.[item.id];
      const raw=Array.isArray(old?.offers)?old.offers:old?[old]:saved.filter(a=>!a.unavailable&&!a.excluded);
      const offers=raw.filter(a=>!a.excluded&&!excluded.some(e=>(e.offerId||'default')===(a.offerId||'default')||brandKey(e.brand)===brandKey(a.brand))).map(a=>{
        const single=draftSingle({items:[item],answers:[{...a,itemId:item.id}]})[item.id];
        const value={...single,offerId:a.offerId||'default',commercialization:a.commercialization?{...a.commercialization}:null},quantity=offerQuantity(item,value);value.quantity=quantity>0?inputNumber(quantity):'';return value;
      });
      values[item.id]={unavailable:old?.unavailable??saved.some(a=>a.unavailable),offers:offers.length?offers:[emptyOffer(item)],excludedOffers:excluded};
    }
    return values;
  }
  function buildAnswers(quotation,values){
    const answers=[],errors=[];
    for(const item of quotation.items){
      const entry=values[item.id]||{};
      if(!Array.isArray(entry.offers)){const built=buildSingleAnswers({items:[item]},{[item.id]:entry});answers.push(...built.answers);errors.push(...built.errors);continue;}
      if(entry.unavailable){answers.push({itemId:item.id,unavailable:true});continue;}
      if(!entry.offers.length||entry.offers.length>5){errors.push({itemId:item.id,field:'brand',message:'Informe de uma a cinco marcas para este item.'});continue;}
      const ids=new Set(),brands=new Set();
      for(const value of entry.offers){
        const id=value.offerId,quantity=offerQuantity(item,value),key=brandKey(value.brand);
        const localErrors=[];
        if(typeof id!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(id)||ids.has(id))localErrors.push({field:'brand',message:'Atualize a página para conferir esta oferta.'});ids.add(id);
        if(brands.has(key))localErrors.push({field:'brand',message:'Esta marca já foi informada neste item.'});brands.add(key);
        if((quotation.answers||[]).some(a=>a.itemId===item.id&&a.excluded&&((a.offerId||'default')===id||brandKey(a.brand)===key)))localErrors.push({field:'brand',message:'Esta oferta foi excluída pelo restaurante. Informe outra marca.'});
        if((item.rejectedBrands||[]).some(b=>brandKey(b)===key))localErrors.push({field:'brand',message:'Esta marca não é aceita pelo restaurante.'});
        const built=buildSingleAnswers({items:[item]},{[item.id]:{...value,quantity:inputNumber(quantity)}});localErrors.push(...built.errors);
        const c=value.commercialization,allowed=customMeasures(item),measuresAllowed=allowed.length?allowed.map(m=>m.id):[item.unitId];
        const commercialAmount=decimal(c?.amount);
        if(!c||!['unit','box','bundle','other'].includes(c.kind)||!clean(c.label)||clean(c.label).length>120||/[\u0000-\u001f\u007f]/.test(clean(c.label))||!Number.isFinite(commercialAmount)||commercialAmount<=0||commercialAmount>1e9||!measuresAllowed.includes(c.measure))localErrors.push({field:'commercialization',message:'Informe como este produto é comercializado.'});
        errors.push(...localErrors.map(error=>({...error,itemId:item.id,offerId:id})));
        if(built.answers[0])answers.push({...built.answers[0],offerId:id,...(c?{commercialization:{kind:c.kind,label:clean(c.label),amount:commercialAmount,measure:c.measure}}:{})});
      }
    }
    return {answers,errors};
  }
  function summary(answers,items=[]){
    const available=answers.filter(answer=>!answer.unavailable&&!answer.excluded&&Number.isFinite(answer.quantity)&&Number.isFinite(answer.unitPrice)),totals=new Map();
    for(const answer of available){const total=offerTotal(items.find(item=>item.id===answer.itemId)||{units:[]},answer);if(Number.isFinite(total)&&(!totals.has(answer.itemId)||totals.get(answer.itemId)>total))totals.set(answer.itemId,total);}
    return {count:totals.size,total:[...totals.values()].reduce((sum,total)=>sum+total,0),unavailable:new Set(answers.filter(answer=>answer.unavailable).map(a=>a.itemId)).size};
  }
  function signature(revision,answers){return JSON.stringify({expectedRevision:revision,answers});}
  function auctionMinimum(q,itemId){
    if(!q?.auctionEnabled||q.status!=="answered")return null;
    const item=q.items?.find(item=>item.id===itemId),answer=q.answers?.find(answer=>answer.itemId===itemId&&!answer.excluded&&!answer.unavailable),unit=item&&offerUnit(item,answer);
    const label=clean(unit?.id).toLowerCase().replace(/\s+/g,' ');
    return (q.auctionMinima||[]).find(entry=>entry.itemId===itemId&&typeof entry.unitPrice==="number"&&Number.isFinite(entry.unitPrice)&&entry.unitPrice>0&&
      (["kg","L","un"].includes(entry.unit)||!unit?.base&&!unit?.factor&&label&&label!=='__custom__'&&!/^(?:caixa|cx|fardo|fd|saco|sc|pacote|pct|embalagem|lata|balde|pote|garrafa)s?\.?$/i.test(label)&&entry.unit===label&&entry.comparisonKey==='label:'+label))||null;
  }
  const api={auctionMinimum,tokenFromFragment,decimal,inputNumber,quantityFromTyping,formatPrice,priceFromTyping,priceFromPaste,customMeasures,offerUnit,offerUnitLabel,priceUnitLabel,offerTotal,offerQuantity,emptyOffer,quotationFromResponse,draftForQuotation,buildAnswers,summary,signature};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.AloQuotationCore=api;
})(typeof window==='object'?window:globalThis);
