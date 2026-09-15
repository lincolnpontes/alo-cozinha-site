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
      const unitValid=item.units.some(unit=>unit.id===answer?.unitId),unitId=unitValid?answer.unitId:item.unitId;
      values[item.id]={unavailable:answer?.unavailable===true,unitId,brand:clean(answer?.brand).slice(0,120),quantity:answer?(unitValid?String(answer.quantity??''):''):inputNumber(item.quantity),unitPrice:answer&&unitValid?String(answer.unitPrice??''):''};
    }
    return values;
  }
  function buildAnswers(quotation,values){
    const answers=[],errors=[];
    for(const item of quotation.items){
      const value=values[item.id]||{};
      if(value.unavailable===true){answers.push({itemId:item.id,unavailable:true});continue;}
      const quantity=decimal(value.quantity),unitPrice=decimal(value.unitPrice),brand=clean(value.brand);
      if(!item.units.some(unit=>unit.id===value.unitId))errors.push({itemId:item.id,field:'unitId',message:'Escolha uma embalagem permitida.'});
      if(!Number.isFinite(quantity)||quantity<=0||quantity>1e9)errors.push({itemId:item.id,field:'quantity',message:'Informe uma quantidade maior que zero.'});
      if(!Number.isFinite(unitPrice)||unitPrice<=0||unitPrice>1e8)errors.push({itemId:item.id,field:'unitPrice',message:'Informe um preço válido para essa embalagem.'});
      else if(Math.abs(unitPrice-Number(unitPrice.toFixed(4)))>1e-9)errors.push({itemId:item.id,field:'unitPrice',message:'Use até 4 casas decimais no preço.'});
      if(brand.length>120||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(brand))errors.push({itemId:item.id,field:'brand',message:'Confira a marca e use até 120 caracteres.'});
      answers.push({itemId:item.id,unitId:value.unitId,brand,quantity,unitPrice,unavailable:false});
    }
    return {answers,errors};
  }
  function summary(answers){
    const available=answers.filter(answer=>!answer.unavailable&&Number.isFinite(answer.quantity)&&Number.isFinite(answer.unitPrice));
    return {count:available.length,total:available.reduce((sum,answer)=>sum+answer.quantity*answer.unitPrice,0),unavailable:answers.filter(answer=>answer.unavailable).length};
  }
  function signature(revision,answers){return JSON.stringify({expectedRevision:revision,answers});}
  const api={tokenFromFragment,decimal,inputNumber,quotationFromResponse,draftForQuotation,buildAnswers,summary,signature};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.AloQuotationCore=api;
})(typeof window==='object'?window:globalThis);
