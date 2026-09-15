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
  function draftForQuotation(quotation,previous){
    const values=Object.create(null);
    for(const item of quotation.items){
      const answer=(previous&&Object.hasOwn(previous,item.id)?previous[item.id]:null)||(quotation.answers||[]).find(value=>value.itemId===item.id);
      const allowed=customMeasures(item),customValid=answer?.unitId==='__custom__'&&allowed.some(measure=>measure.id===answer.customUnit?.measure),unitValid=customValid||item.units.some(unit=>unit.id===answer?.unitId),unitId=unitValid?answer.unitId:item.unitId;
      values[item.id]={unavailable:answer?.unavailable===true,unitId,brand:clean(answer?.brand).slice(0,120),brandMode:answer?.brandMode||'',otherBrand:clean(answer?.otherBrand).slice(0,120),quantity:answer?(unitValid?String(answer.quantity??''):''):inputNumber(item.quantity),unitPrice:answer&&unitValid?String(answer.unitPrice??''):'',customUnit:{label:clean(answer?.customUnit?.label).slice(0,120),amount:String(answer?.customUnit?.amount??''),measure:allowed.some(measure=>measure.id===answer?.customUnit?.measure)?answer.customUnit.measure:allowed[0]?.id||''}};
    }
    return values;
  }
  function buildAnswers(quotation,values){
    const answers=[],errors=[];
    for(const item of quotation.items){
      const value=values[item.id]||{};
      if(value.unavailable===true){answers.push({itemId:item.id,unavailable:true});continue;}
      const quantity=decimal(value.quantity),unitPrice=decimal(value.unitPrice),brand=clean(value.brand);
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
      answers.push({itemId:item.id,unitId:value.unitId,brand,quantity,unitPrice,unavailable:false,...(customUnit?{customUnit}:{})});
    }
    return {answers,errors};
  }
  function summary(answers){
    const available=answers.filter(answer=>!answer.unavailable&&Number.isFinite(answer.quantity)&&Number.isFinite(answer.unitPrice));
    return {count:available.length,total:available.reduce((sum,answer)=>sum+answer.quantity*answer.unitPrice,0),unavailable:answers.filter(answer=>answer.unavailable).length};
  }
  function signature(revision,answers){return JSON.stringify({expectedRevision:revision,answers});}
  const api={tokenFromFragment,decimal,inputNumber,formatPrice,priceFromTyping,priceFromPaste,customMeasures,offerUnit,offerUnitLabel,quotationFromResponse,draftForQuotation,buildAnswers,summary,signature};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.AloQuotationCore=api;
})(typeof window==='object'?window:globalThis);
