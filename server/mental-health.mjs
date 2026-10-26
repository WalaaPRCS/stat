import {randomUUID} from 'node:crypto';

export const mentalHealthPrograms=['إسعاف نفسي أولي','دعم كبار سن','دعم مربيين','دعم يافعين','دعم أطفال CABAC','تثقيف نفسي','أيام مفتوحة','باص الأحلام','زوايا','استشارات','إحالة وتحويل','النقاط الطبية','مستشفى الصليب','إرشاد فردي','مخيمات صيفية','زيارات منزلية','الرعاية الذاتية','دورات تدريبية','الهدايا والألعاب','توزيع مواد علمية','المعالجة المتطورة لحل المشكلات','PFA-الصحة الإنجابية','غرفة العلاج باللعب','دعم اسرى'];
const regions=['شمال غزة','غزة','الوسطى','خانيونس','رفح'];
const countKeys=['female_0_17','male_0_17','female_18_59','male_18_59','female_60_plus','male_60_plus'];
const archiveKey='archive:2023-10_2025-05',archiveLabel='Oct.2023-May 2025';
const validDate=v=>{if(typeof v!=='string'||!/^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(v))return false;const d=new Date(v+'T00:00:00Z');return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===v};
function cleanRecord(row){
 const date=String(row.date||''),periodLabel=String(row.period_label||''),program=String(row.program||'');
 let periodKey=String(row.period_key||'');
 if(date&&validDate(date))periodKey='date:'+date;
 else if(periodLabel===archiveLabel)periodKey=archiveKey;
 if(!mentalHealthPrograms.includes(program))return null;
 if(!periodKey||!(date?validDate(date):periodLabel===archiveLabel))return null;
 const raw=row.counts||{},counts={};let invalid=false;
 for(const region of regions){counts[region]={};for(const key of countKeys){const n=Number(raw[region]?.[key]??0);if(!Number.isSafeInteger(n)||n<0||n>100000000){invalid=true;break}counts[region][key]=n}if(invalid)break}
 if(invalid)return null;
 const notes=String(row.notes||'').trim();if(notes.length>1500)return null;
 return {date,periodKey,periodLabel:date?'':archiveLabel,program,counts,notes};
}
export function mentalHealthService(sql,out,hasPermission){
 sql.exec("CREATE TABLE IF NOT EXISTS mental_health_records(id TEXT PRIMARY KEY,period_key TEXT NOT NULL,date TEXT NOT NULL DEFAULT '',period_label TEXT NOT NULL DEFAULT '',program TEXT NOT NULL,counts_json TEXT NOT NULL,notes TEXT NOT NULL DEFAULT '',updated_by TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(period_key,program));CREATE INDEX IF NOT EXISTS mental_health_records_date ON mental_health_records(date,program)");
 const decode=r=>({...r,counts:JSON.parse(r.counts_json),counts_json:undefined});
 return async(req,u)=>{
  const url=new URL(req.url),id=url.searchParams.get('id'),from=url.searchParams.get('from'),to=url.searchParams.get('to'),program=url.searchParams.get('program');
  if(req.method==='GET'){
   const rows=sql.prepare("SELECT * FROM mental_health_records ORDER BY CASE WHEN date='' THEN 1 ELSE 0 END,date DESC,program").all();
   return out(rows.filter(r=>(!from||!r.date||r.date>=from)&&(!to||!r.date||r.date<=to)&&(!program||r.program===program)).map(decode));
  }
  const allowed=u?.role==='admin'||['entry','custom'].includes(u?.role)&&u.scope==='community';
  if(!allowed)return out({error:'ليس لديك صلاحية إدخال إحصائيات الصحة النفسية'},403);
  let b;try{b=await req.json()}catch{return out({error:'بيانات النموذج غير صالحة'},400)}
  if(url.pathname==='/api/mental-health-import'){
   if(req.method!=='POST')return out({error:'طلب غير مدعوم'},405);
   if(!hasPermission(u,'create'))return out({error:'لا تملك صلاحية استيراد السجلات'},403);
   const records=Array.isArray(b.records)?b.records:[];
   if(!records.length||records.length>5000)return out({error:'الملف فارغ أو يحتوي على عدد سجلات غير مسموح به'},400);
   let added=0,skipped=0,failed=0;const errors=[];
   sql.exec('BEGIN IMMEDIATE');
   try{
    for(let i=0;i<records.length;i++){
     const row=cleanRecord(records[i]||{});
     if(!row){failed++;if(errors.length<5)errors.push({row:i+1,error:'تحقق من الفترة والبرنامج والمحافظات والأعداد'});continue}
     const duplicate=sql.prepare('SELECT id FROM mental_health_records WHERE period_key=? AND program=?').get(row.periodKey,row.program);
     if(duplicate){skipped++;continue}
     try{sql.prepare('INSERT INTO mental_health_records(id,period_key,date,period_label,program,counts_json,notes,updated_by,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(randomUUID(),row.periodKey,row.date,row.periodLabel,row.program,JSON.stringify(row.counts),row.notes,u?.id||'system',new Date().toISOString());added++}
     catch(e){failed++;if(errors.length<5)errors.push({row:i+1,error:e.message||'تعذر حفظ السجل'})}
    }
    sql.exec('COMMIT');return out({added,skipped,failed,total:records.length,errors});
   }catch(e){sql.exec('ROLLBACK');return out({error:'فشل الاستيراد الجماعي ولم تحفظ التغييرات'},500)}
  }
  if(req.method==='DELETE'||b?.delete===true){
   if(!hasPermission(u,'delete'))return out({error:'لا تملك صلاحية حذف السجلات'},403);
   const key=b.id||id;if(!key)return out({error:'السجل غير محدد'},400);
   sql.prepare('DELETE FROM mental_health_records WHERE id=?').run(key);return out({deleted:true});
  }
  if(!['POST','PUT'].includes(req.method))return out({error:'طلب غير مدعوم'},405);
  const row=cleanRecord(b);
  if(!row)return out({error:'تحقق من التاريخ والبرنامج والأعداد والملاحظات'},400);
  const key=String(b.id||''),action=key?'edit':'create';
  if(!hasPermission(u,action))return out({error:'لا تملك صلاحية '+(key?'تعديل':'إضافة')+' السجلات'},403);
  if(key&&!sql.prepare('SELECT id FROM mental_health_records WHERE id=?').get(key))return out({error:'السجل غير موجود'},404);
  const duplicate=sql.prepare('SELECT id FROM mental_health_records WHERE period_key=? AND program=?').get(row.periodKey,row.program);
  if(duplicate&&duplicate.id!==key)return out({error:'يوجد سجل محفوظ لهذا البرنامج في التاريخ نفسه'},409);
  const recordId=key||randomUUID(),stamp=new Date().toISOString();
  sql.prepare('INSERT INTO mental_health_records(id,period_key,date,period_label,program,counts_json,notes,updated_by,updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET period_key=excluded.period_key,date=excluded.date,period_label=excluded.period_label,program=excluded.program,counts_json=excluded.counts_json,notes=excluded.notes,updated_by=excluded.updated_by,updated_at=excluded.updated_at').run(recordId,row.periodKey,row.date,row.periodLabel,row.program,JSON.stringify(row.counts),row.notes,u?.id||'system',stamp);
  return out({saved:true,id:recordId});
 };
}
