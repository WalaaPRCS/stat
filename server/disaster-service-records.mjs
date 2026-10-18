import {randomUUID} from 'node:crypto';
const regions=['شمال غزة','غزة','الوسطى','خانيونس','رفح'];
const healthGroups=['المجتمعات','مراكز إيواء الجمعية','تجمعات النزوح'];
const sanitationTypes=['إدارة النفايات الصلبة','الصرف الصحي','تنظيف وتعقيم المرافق','توفير مرافق النظافة','التوعية بالنظافة والإصحاح','أخرى'];
const validDate=v=>typeof v==='string'&&/^\\d{4}-\\d{2}-\\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
export function disasterServiceRecords(sql,out){
 sql.exec('CREATE TABLE IF NOT EXISTS disaster_service_records(id TEXT PRIMARY KEY,service TEXT NOT NULL,date TEXT NOT NULL,region TEXT NOT NULL,payload TEXT NOT NULL,updated_by TEXT NOT NULL,updated_at TEXT NOT NULL);CREATE INDEX IF NOT EXISTS disaster_service_by_date ON disaster_service_records(service,date,region)');
 return async(req,u)=>{
  const url=new URL(req.url),service=url.searchParams.get('service'),id=url.searchParams.get('id');
  if(!['health-facilities','sanitation'].includes(service))return out({error:'اختر نوع الخدمة الصحيح'},400);
  if(req.method==='GET')return out(sql.prepare('SELECT id,service,date,region,payload,updated_at FROM disaster_service_records WHERE service=? ORDER BY date DESC,updated_at DESC').all(service).map(r=>({...r,...JSON.parse(r.payload)})));
  if(u?.role!=='admin'&&!(u?.role==='entry'&&u.scope==='disaster'))return out({error:'ليست لديك صلاحية لإدخال بيانات مواجهة الكوارث'},403);
  let b;try{b=await req.json()}catch{return out({error:'بيانات النموذج غير صالحة'},400)}
  if(req.method==='DELETE'||req.method==='POST'&&b?.delete===true){
   const key=b.id||id;if(!key)return out({error:'السجل غير محدد'},400);
   sql.prepare('DELETE FROM disaster_service_records WHERE id=? AND service=?').run(key,service);return out({deleted:true});
  }
  if(!['POST','PUT'].includes(req.method))return out({error:'طلب غير مدعوم'},405);
  const region=String(b.region||'').trim(),date=b.date,notes=String(b.notes||'').trim();
  if(!validDate(date)||!regions.includes(region)||notes.length>2000)return out({error:'تحقق من التاريخ والمحافظة والملاحظات'},400);
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
