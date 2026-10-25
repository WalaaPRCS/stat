import {randomUUID} from 'node:crypto';

const services={"الخدمات المساندة":["العلاج الطبيعي (PT)","علاج النطق واللغة (SLP)","دعم نفسي"],"ورشة  صيانة الأدوات المساعدة":["ورشة صيانة الأدوات المساعدة"],"الأجهزة المساعدة (Assistive Devices)":["الأجهزة المساعدة (Assistive Devices)"],"الأطراف الصناعية والتقويمية (P&O)":["الأطراف الصناعية والتقويمية (P&O)"],"الفرق الميدانية المجتمعية (Out-reach Program)":["حملات التوعية الأسرية ومقدمو الرعاية","الزيارات المنزلية / الفرق الميدانية (CBR)","حملات الكشف المبكر والتدخل المبكر"],"قسم  المدرسة":["مدرسة الهلال للتربية الخاصة"],"قسم الإعاقة الذهنية":["قسم الإعاقة الذهنية"],"قسم الروضة":["روضة الهلال للتربية الخاصة"],"قسم تدريب و تنمية الكبار":["التأهيل المهني والمهارات الحياتية"],"التعليم المستمر":["تدريب الموظفين والمتطوعين"],"الأنشطة اللامنهجية":["تدريب الموظفين والمتطوعين"],"مدرسة الهلال للتربية الخاصة":["مدرسة الهلال للتربية الخاصة"],"قسم تدريب أولياء الأمور":["تدريب أولياء الأمور"]};
const regions=['الوسطى','خانيونس','غزة'];
const countKeys=['male_0_18','female_0_18','male_19_60','female_19_60','male_60_plus','female_60_plus'];
const validDate=v=>typeof v==='string'&&/^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(v)&&!Number.isNaN(Date.parse(v+'T00:00:00Z'));
export function rehabService(sql,out,hasPermission){
 sql.exec('CREATE TABLE IF NOT EXISTS rehab_records(id TEXT PRIMARY KEY,date TEXT NOT NULL,region TEXT NOT NULL,category TEXT NOT NULL,service TEXT NOT NULL,counts_json TEXT NOT NULL,notes TEXT NOT NULL DEFAULT \'\',updated_by TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(date,region,category,service));CREATE INDEX IF NOT EXISTS rehab_records_date ON rehab_records(date,category,region)');
 const decode=r=>({...r,counts:JSON.parse(r.counts_json),counts_json:undefined});
 return async(req,u)=>{
  const url=new URL(req.url),id=url.searchParams.get('id'),from=url.searchParams.get('from'),to=url.searchParams.get('to'),region=url.searchParams.get('region'),category=url.searchParams.get('category');
  if(req.method==='GET'){
   const rows=sql.prepare('SELECT * FROM rehab_records ORDER BY date DESC,region,category,service').all();
   return out(rows.filter(r=>(!from||r.date>=from)&&(!to||r.date<=to)&&(!region||r.region===region)&&(!category||r.category===category)).map(decode));
  }
  const allowed=u?.role==='admin'||['entry','custom'].includes(u?.role)&&u.scope==='community';
  if(!allowed)return out({error:'ليس لديك صلاحية إدخال إحصائيات دائرة التأهيل المجتمعي'},403);
  let b;try{b=await req.json()}catch{return out({error:'بيانات النموذج غير صالحة'},400)}
  if(url.pathname==='/api/rehab-import'){
   if(req.method!=='POST')return out({error:'طلب غير مدعوم'},405);
   if(!hasPermission(u,'create'))return out({error:'لا تملك صلاحية استيراد السجلات'},403);
   const records=Array.isArray(b.records)?b.records:[];
   if(!records.length||records.length>5000)return out({error:'الملف فارغ أو يحتوي على عدد سجلات غير مسموح به'},400);
   let added=0,skipped=0,failed=0;const errors=[];
   sql.exec('BEGIN IMMEDIATE');
   try{
    for(let i=0;i<records.length;i++){
     const row=records[i]||{},date=String(row.date||''),regionValue=String(row.region||''),categoryValue=String(row.category||''),service=String(row.service||''),notes=String(row.notes||'').trim(),counts=row.counts||{};
     if(!validDate(date)||!regions.includes(regionValue)||!Object.hasOwn(services,categoryValue)||!services[categoryValue].includes(service)||notes.length>1500){failed++;if(errors.length<5)errors.push({row:i+1,error:'تحقق من التاريخ والمحافظة ومجموعة الخدمة واسم الخدمة'});continue}
     const clean={};let invalid=false;
     for(const k of countKeys){const n=Number(counts[k]??0);if(!Number.isSafeInteger(n)||n<0||n>100000000){invalid=true;break}clean[k]=n}
     if(invalid){failed++;if(errors.length<5)errors.push({row:i+1,error:'أعداد المستفيدين يجب أن تكون أعدادًا صحيحة غير سالبة'});continue}
     const duplicate=sql.prepare('SELECT id FROM rehab_records WHERE date=? AND region=? AND category=? AND service=?').get(date,regionValue,categoryValue,service);
     if(duplicate){skipped++;continue}
     try{sql.prepare('INSERT INTO rehab_records(id,date,region,category,service,counts_json,notes,updated_by,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(randomUUID(),date,regionValue,categoryValue,service,JSON.stringify(clean),notes,u?.id||'system',new Date().toISOString());added++}
     catch(e){failed++;if(errors.length<5)errors.push({row:i+1,error:e.message||'تعذر حفظ السجل'})}
    }
    sql.exec('COMMIT');return out({added,skipped,failed,total:records.length,errors});
   }catch(e){sql.exec('ROLLBACK');return out({error:'فشل الاستيراد الجماعي ولم تحفظ التغييرات'},500)}
  }
  if(req.method==='DELETE'||b?.delete===true){
   if(!hasPermission(u,'delete'))return out({error:'لا تملك صلاحية حذف السجلات'},403);
   const key=b.id||id;if(!key)return out({error:'السجل غير محدد'},400);
   sql.prepare('DELETE FROM rehab_records WHERE id=?').run(key);return out({deleted:true});
  }
  if(!['POST','PUT'].includes(req.method))return out({error:'طلب غير مدعوم'},405);
  const key=b.id||'',date=String(b.date||''),regionValue=String(b.region||''),categoryValue=String(b.category||''),service=String(b.service||''),notes=String(b.notes||'').trim(),counts=b.counts||{};
  if(!validDate(date)||!regions.includes(regionValue)||!Object.hasOwn(services,categoryValue)||!services[categoryValue].includes(service)||notes.length>1500)return out({error:'تحقق من التاريخ والمحافظة والخدمة والملاحظات'},400);
  const clean={};for(const k of countKeys){const n=Number(counts[k]??0);if(!Number.isSafeInteger(n)||n<0||n>100000000)return out({error:'أعداد المستفيدين يجب أن تكون أعدادًا صحيحة غير سالبة'},400);clean[k]=n}
  const action=key?'edit':'create';if(!hasPermission(u,action))return out({error:'لا تملك صلاحية '+(key?'تعديل':'إضافة')+' السجلات'},403);
  if(key&&!sql.prepare('SELECT id FROM rehab_records WHERE id=?').get(key))return out({error:'السجل غير موجود'},404);
  const duplicate=sql.prepare('SELECT id FROM rehab_records WHERE date=? AND region=? AND category=? AND service=?').get(date,regionValue,categoryValue,service);
  if(duplicate&&duplicate.id!==key)return out({error:'يوجد سجل لهذه الخدمة في التاريخ والمحافظة. افتح السجل الحالي للتعديل.'},409);
  const recordId=key||randomUUID(),stamp=new Date().toISOString();
  sql.prepare('INSERT INTO rehab_records(id,date,region,category,service,counts_json,notes,updated_by,updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET date=excluded.date,region=excluded.region,category=excluded.category,service=excluded.service,counts_json=excluded.counts_json,notes=excluded.notes,updated_by=excluded.updated_by,updated_at=excluded.updated_at').run(recordId,date,regionValue,categoryValue,service,JSON.stringify(clean),notes,u?.id||'system',stamp);
  return out({saved:true,id:recordId});
 };
}
