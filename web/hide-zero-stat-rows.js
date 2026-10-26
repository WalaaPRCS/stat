'use strict';
(()=>{
  const main=document.querySelector('#main');
  if(!main)return;
  const normalize=value=>value.replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g,d=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٬,]/g,'').replace(/٫/g,'.').trim();
  const isNumericCell=cell=>{
    const raw=(cell.innerText||cell.textContent||'').replace(/\u00a0/g,' ').trim();
    if(!raw)return null;
    const value=normalize(raw);
    if(!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(value))return null;
    const number=Number(value);
    return Number.isFinite(number)?number:null;
  };
  const refresh=()=>{
    main.querySelectorAll('table tbody tr').forEach(row=>{
      if(row.dataset.zeroStatOriginalHidden!==undefined){
        row.hidden=row.dataset.zeroStatOriginalHidden==='true';
        delete row.dataset.zeroStatOriginalHidden;
      }
      const label=(row.innerText||row.textContent||'').toLocaleLowerCase();
      if(/مجموع|الإجمالي|اجمالي|المجموع|المعدل|متوسط|total|average/.test(label))return;
      if(row.querySelector('input,select,textarea'))return;
      const values=[...row.querySelectorAll('td')].map(isNumericCell).filter(v=>v!==null);
      if(values.length>0&&values.every(v=>v===0)){
        row.dataset.zeroStatOriginalHidden=String(row.hidden);
        row.hidden=true;
      }
    });
  };
  const observer=new MutationObserver(refresh);
  observer.observe(main,{childList:true,subtree:true});
  refresh();
})();
