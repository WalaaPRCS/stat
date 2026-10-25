import {randomUUID} from 'node:crypto';

const regions=['شمال غزة','غزة','الوسطى','خانيونس','رفح'];
const services={
 field:['الأمراض المعدية','الصحة الإنجابية في الطوارئ','الأمراض المزمنة','العنف في حالات الطوارئ','المياه والإصحاح'],
 health_points:['إسعاف أولي طارئ','متابعة النساء الحوامل','متابعة ذوي الإعاقة وكبار السن','زيارات المصابين جرحى الحرب','استشارات فردية','جلسات توعية وتثقيف جماعي']
};
const countKeys=['female_0_17','male_0_17','female_18_59','male_18_59','female_60_plus','male_60_plus'];
const validPeriod=v=>typeof v==='string'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(v);
export function communityService(sql,out,hasPermission){
 sql.exec('CREATE TABLE IF NOT EXISTS community_records(id TEXT PRIMARY KEY,period TEXT NOT NULL,region TEXT NOT NULL,category TEXT NOT NULL,service TEXT NOT NULL,counts_json TEXT NOT NULL,notes TEXT NOT NULL DEFAULT \'\',updated_by TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(period,region,category,service));CREATE INDEX IF NOT EXISTS community_records_period ON community_records(period,category,region)');
 const decode=r=>({...r,counts:JSON.parse(r.counts_json),counts_json:undefined});
 return async(req,u)=>{
  const url=new URL(req.url),id=url.searchParams.get('id'),from=url.searchParams.get('from'),to=url.searchParams.get('to'),region=url.searchParams.get('region'),category=url.searchParams.get('category');
  if(req.method==='GET'){
   const rows=sql.prepare('SELECT * FROM community_records ORDER BY period DESC,region,category,service').all();
   return out(rows.filter(r=>(!from||r.period>=from)&&(!to||r.period<=to)&&(!region||r.region===region)&&(!category||r.category===category)).map(decode));
  }
  const allowed=u?.role==='admin'||['entry','custom'].includes(u?.role)&&u.scope==='community';
  if(!allowed)return out({error:'ليس لديك صلاحية إدخال إحصائيات دائرة العمل المجتمعي'},403);
  let b;try{b=await req.json()}catch{return out({error:'بيانات النموذج غير صالحة'},400)}
  if(req.method==='DELETE'||b?.delete===true){
   if(!hasPermission(u,'delete'))return out({error:'لا تملك صلاحية حذف السجلات'},403);
   const key=b.id||id;if(!key)return out({error:'السجل غير محدد'},400);
   sql.prepare('DELETE FROM community_records WHERE id=?').run(key);return out({deleted:true});
  }
  if(!['POST','PUT'].includes(req.method))return out({error:'طلب غير مدعوم'},405);
  const key=b.id||'',period=String(b.period||''),regionValue=String(b.region||''),categoryValue=String(b.category||''),service=String(b.service||''),notes=String(b.notes||'').trim(),counts=b.counts||{};
  if(!validPeriod(period)||!regions.includes(regionValue)||!Object.hasOwn(services,categoryValue)||!services[categoryValue].includes(service)||notes.length>1500)return out({error:'تحقق من الشهر والمحافظة والخدمة والملاحظات'},400);
  const clean={};for(const k of countKeys){const n=Number(counts[k]??0);if(!Number.isSafeInteger(n)||n<0||n>100000000)return out({error:'أعداد المستفيدين يجب أن تكون أعدادًا صحيحة موجبة'},400);clean[k]=n}
  const action=key?'edit':'create';if(!hasPermission(u,action))return out({error:'لا تملك صلاحية '+(key?'تعديل':'إضافة')+' السجلات'},403);
  if(key&&!sql.prepare('SELECT id FROM community_records WHERE id=?').get(key))return out({error:'السجل غير موجود'},404);
  const duplicate=sql.prepare('SELECT id FROM community_records WHERE period=? AND region=? AND category=? AND service=?').get(period,regionValue,categoryValue,service);
  if(duplicate&&duplicate.id!==key)return out({error:'يوجد سجل لهذه الخدمة في الشهر والمحافظة. افتح السجل الحالي للتعديل.'},409);
  const recordId=key||randomUUID(),stamp=new Date().toISOString();
  sql.prepare('INSERT INTO community_records(id,period,region,category,service,counts_json,notes,updated_by,updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET period=excluded.period,region=excluded.region,category=excluded.category,service=excluded.service,counts_json=excluded.counts_json,notes=excluded.notes,updated_by=excluded.updated_by,updated_at=excluded.updated_at').run(recordId,period,regionValue,categoryValue,service,JSON.stringify(clean),notes,u?.id||'system',stamp);
  return out({saved:true,id:recordId});
 };
}
