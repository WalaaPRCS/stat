import {randomUUID} from 'node:crypto';
const regions=['شمال غزة','غزة','الوسطى','خانيونس','رفح'];
const healthGroups=['المجتمعات','مراكز إيواء الجمعية','تجمعات النزوح'];
const sanitationTypes=['إدارة النفايات الصلبة','الصرف الصحي','تنظيف وتعقيم المرافق','توفير مرافق النظافة','التوعية بالنظافة والإصحاح','أخرى'];
const validDate=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
const sensitiveCampFields=new Set(['عنوان المخيم','إحداثية الموقع','مشرف المخيم','الصفة','رقم التواصل']);
const safeFields=v=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.entries(v).length<=80&&Object.entries(v).every(([k,x])=>typeof k==='string'&&k.length<=180&&!sensitiveCampFields.has(k)&&(x===null||['string','number','boolean'].includes(typeof x))&&(typeof x!=='string'||x.length<=2000));
export function disasterServiceRecords(sql,out){
 sql.exec('CREATE TABLE IF NOT EXISTS disaster_service_records(id TEXT PRIMARY KEY,service TEXT NOT NULL,date TEXT NOT NULL,region TEXT NOT NULL,payload TEXT NOT NULL,updated_by TEXT NOT NULL,updated_at TEXT NOT NULL);CREATE INDEX IF NOT EXISTS disaster_service_by_date ON disaster_service_records(service,date,region)');
 return async(req,u)=>{
  const url=new URL(req.url),service=url.searchParams.get('service'),id=url.searchParams.get('id');
  if(!['health-facilities','sanitation','camps'].includes(service))return out({error:'اختر نوع الخدمة الصحيح'},400);
  if(req.method==='GET')return out(sql.prepare('SELECT id,service,date,region,payload,updated_at FROM disaster_service_records WHERE service=? ORDER BY date DESC,updated_at DESC').all(service).map(r=>({...r,...JSON.parse(r.payload)})));
  if(u?.role!=='admin'&&!(u?.role==='entry'&&u.scope==='disaster'))return out({error:'ليست لديك صلاحية لإدخال بيانات مواجهة الكوارث'},403);
  let b;try{b=await req.json()}catch{return out({error:'بيانات النموذج غير صالحة'},400)}
  if(b?.action==='import'){
   const data=b.data;
   if(!data||data.format!=='prcs-disaster-service-import-v1'||data.service!==service||!Array.isArray(data.records)||data.records.length>5000)return out({error:'ملف الاستيراد غير مطابق للخدمة أو يحتوي على سجلات أكثر من المسموح'},400);
   const insert=sql.prepare('INSERT OR IGNORE INTO disaster_service_records(id,service,date,region,payload,updated_by,updated_at) VALUES(?,?,?,?,?,?,?)');
   let added=0,skipped=0;const stamp=new Date().toISOString();
   for(const r of data.records){
    if(!r||typeof r!=='object'||!validDate(r.date)||!regions.includes(r.region)||typeof r.id!=='string'||!r.id||r.id.length>200)return out({error:'توجد سجلات بتاريخ أو محافظة أو معرّف غير صالح'},400);
    let payload;
    if(service==='camps'){
   const campName=String(b.campName||'').trim(),status=String(b.status||''),closedDate=b.closedDate||null,closureReason=String(b.closureReason||'').trim();
   if(b.kind!=='profile'||!campName||campName.length>180||!['active','inactive','unknown'].includes(status)||closedDate&&(!validDate(closedDate)||closedDate<date)||closureReason.length>300||!safeFields(b.fields))return out({error:'أكمل اسم التجمع والمحافظة والحالة والحقول بصورة صحيحة'},400);
   if(b.id){const old=sql.prepare('SELECT payload FROM disaster_service_records WHERE id=? AND service=?').get(b.id,service);if(!old)return out({error:'ملف التجمع غير موجود'},404);if(JSON.parse(old.payload).kind!=='profile')return out({error:'لا يمكن تغيير سجل إحصائي إلى ملف تجمع'},409);}
   payload={kind:'profile',campName,region,status,createdDate:date,closedDate,closureReason,fields:b.fields,notes,sourceRow:null};
  }else if(service==='health-facilities'){
     const kind=String(r.kind||''),group=String(r.beneficiary_group||''),status=String(r.status||''),count=Number(r.count);
     if(!['monthly','historical','cumulative_snapshot'].includes(kind)||!healthGroups.includes(group)||!['created','inactive','active'].includes(status)||!Number.isSafeInteger(count)||count<0||count>100000||!validDate(r.period_start)||!validDate(r.period_end))return out({error:'توجد إحصائية مرافق صحية غير صالحة'},400);
     payload={kind,periodStart:r.period_start,periodEnd:r.period_end,beneficiaryGroup:group,status,count,facilityName:'',notes:String(r.notes||'').slice(0,2000),sourceRow:Number(r.source_row)||null};
    }else if(service==='sanitation'&&r.kind==='camp_wash_profile'){
     if(typeof r.camp_name!=='string'||r.camp_name.length>180||!safeFields(r.fields)||!['active','inactive','unknown'].includes(r.camp_status))return out({error:'توجد بيانات إصحاح للمخيم غير صالحة'},400);
     payload={kind:'camp_wash_profile',activity:'بيانات الإصحاح بالمخيم',unit:'عملية',quantity:1,beneficiaries:0,location:r.camp_name,campName:r.camp_name,campStatus:r.camp_status,campCreatedDate:r.camp_created_date||null,dateLabel:'تاريخ قياس التفاصيل غير محدد في المصدر',fields:r.fields,notes:String(r.notes||'').slice(0,2000),sourceRow:Number(r.source_row)||null};
    }else if(service==='camps'){
     if(r.kind==='profile'){
      if(typeof r.camp_name!=='string'||r.camp_name.length>180||!['active','inactive','unknown'].includes(r.status)||!safeFields(r.fields))return out({error:'توجد بيانات مخيم غير صالحة'},400);
      payload={kind:'profile',campName:r.camp_name,region:r.region,status:r.status,createdDate:r.created_date||null,closedDate:r.closed_date||null,closureReason:String(r.closure_reason||'').slice(0,300),fields:r.fields,sourceRow:Number(r.source_row)||null};
     }else{
      const kind=String(r.kind||''),metric=String(r.metric||''),status=String(r.status||''),count=Number(r.count);
      if(!['monthly','historical','cumulative_snapshot'].includes(kind)||!['camps','beneficiaries'].includes(metric)||!['created','inactive','active'].includes(status)||!Number.isSafeInteger(count)||count<0||count>100000000||!validDate(r.period_start)||!validDate(r.period_end))return out({error:'توجد إحصائية تجمعات نزوح غير صالحة'},400);
      payload={kind,metric,status,count,periodStart:r.period_start,periodEnd:r.period_end,notes:String(r.notes||'').slice(0,2000),sourceRow:Number(r.source_row)||null};
     }
    }else return out({error:'نوع السجل لا يطابق الخدمة المحددة'},400);
    const result=insert.run(r.id,service,r.date,r.region,JSON.stringify(payload),u?.id||'system',stamp);
    if(result.changes)added++;else skipped++;
   }
   return out({added,skipped,total:data.records.length});
  }
  if(req.method==='DELETE'||req.method==='POST'&&b?.delete===true){
   const key=b.id||id;if(!key)return out({error:'السجل غير محدد'},400);
   sql.prepare('DELETE FROM disaster_service_records WHERE id=? AND service=?').run(key,service);return out({deleted:true});
  }
  if(!['POST','PUT'].includes(req.method))return out({error:'طلب غير مدعوم'},405);
  const region=String(b.region||'').trim(),date=service==='camps'&&b.kind==='profile'?b.createdDate:b.date,notes=String(b.notes||'').trim();
  if(!validDate(date)||!regions.includes(region)||notes.length>2000)return out({error:'تحقق من تاريخ الإنشاء والمحافظة والملاحظات'},400);
  let payload;
  if(service==='health-facilities'){
   const group=String(b.beneficiaryGroup||''),status=String(b.status||''),count=Number(b.count),facilityName=String(b.facilityName||'').trim();
   if(!healthGroups.includes(group)||!['created','inactive','active'].includes(status)||!Number.isSafeInteger(count)||count<0||count>100000||facilityName.length>180)return out({error:'أكمل فئة المستفيدين والحالة وعدد المرافق بصورة صحيحة'},400);
   payload={beneficiaryGroup:group,status,count,facilityName,notes};
  }else{
   const activity=String(b.activity||''),unit=String(b.unit||''),quantity=Number(b.quantity),beneficiaries=Number(b.beneficiaries||0),location=String(b.location||'').trim();
   if(!sanitationTypes.includes(activity)||!['مرفق','متر مكعب','طن','حزمة','جلسة','شخص','عملية'].includes(unit)||!Number.isFinite(quantity)||quantity<0||quantity>1e12||!Number.isSafeInteger(beneficiaries)||beneficiaries<0||beneficiaries>1e9||location.length>180)return out({error:'أكمل نوع النشاط والكمية والوحدة والمستفيدين بصورة صحيحة'},400);
   payload={activity,unit,quantity,beneficiaries,location,notes};
  }
  const key=b.id||randomUUID(),stamp=new Date().toISOString();
  sql.prepare('INSERT INTO disaster_service_records(id,service,date,region,payload,updated_by,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET date=excluded.date,region=excluded.region,payload=excluded.payload,updated_by=excluded.updated_by,updated_at=excluded.updated_at').run(key,service,date,region,JSON.stringify(payload),u?.id||'system',stamp);
  return out({saved:true,id:key,...payload,date,region,updated_at:stamp});
 };
}
