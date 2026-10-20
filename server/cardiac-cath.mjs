import { createInflateRaw } from 'node:zlib';
import { Readable } from 'node:stream';
import { createInterface } from 'node:readline';
import { createHash, randomBytes } from 'node:crypto';

const clean = v => v == null ? '' : String(v).trim();
const norm = v => clean(v).replace(/\s+/g, ' ').slice(0, 180) || 'غير محدد';
const safeDate = v => /^\d{4}-\d{2}-\d{2}/.test(clean(v)) ? clean(v).slice(0, 10) : '';
function ageAt(dob, date) {
  dob = safeDate(dob); date = safeDate(date);
  if (!dob || !date || dob.startsWith('0000')) return null;
  const [y,m,d] = dob.split('-').map(Number), [Y,M,D] = date.split('-').map(Number);
  let n = Y-y; if (M<m || (M===m && D<d)) n--;
  return n >= 0 && n <= 120 ? n : null;
}
function ageBand(age) {
  if (age == null) return 'غير محدد';
  if (age < 18) return 'أقل من 18';
  if (age < 35) return '18–34';
  if (age < 50) return '35–49';
  if (age < 65) return '50–64';
  return '65 فأكثر';
}
function tupleValues(raw) {
  const vals=[]; let v='', q=false, esc=false;
  for(let i=0;i<raw.length;i++){
    const c=raw[i];
    if(q){
      if(esc){v+=({'0':'\0','b':'\b','n':'\n','r':'\r','t':'\t','Z':'\x1a'}[c] ?? c);esc=false;continue;}
      if(c==='\\'){esc=true;continue;}
      if(c==="'"){if(raw[i+1]==="'"){v+="'";i++;continue;}q=false;continue;}
      v+=c;continue;
    }
    if(c==="'"){q=true;continue;}
    if(c===','){vals.push(v.trim()==='NULL'?null:v.trim());v='';continue;}
    v+=c;
  }
  vals.push(v.trim()==='NULL'?null:v.trim()); return vals;
}
function parseInsert(line) {
  const m=line.match(/^INSERT INTO `([^`]+)`\s*\((.*?)\) VALUES\s*(.*);\s*$/);
  if(!m)return null;
  const table=m[1], columns=[...m[2].matchAll(/`([^`]+)`/g)].map(x=>x[1]);
  const tail=m[3], rows=[];let start=-1,q=false,esc=false;
  for(let i=0;i<tail.length;i++){
    const c=tail[i];
    if(q){if(esc){esc=false;continue;}if(c==='\\'){esc=true;continue;}if(c==="'"){if(tail[i+1]==="'"){i++;continue;}q=false;}continue;}
    if(c==="'"){q=true;continue;}
    if(c==='('){if(start<0)start=i+1;continue;}
    if(c===')'&&start>=0){rows.push(tupleValues(tail.slice(start,i)));start=-1;}
  }
  return {table,columns,rows};
}
function readZipSql(zip) {
  const min=Math.max(0,zip.length-65557);let eocd=-1;
  for(let i=zip.length-22;i>=min;i--)if(zip.readUInt32LE(i)===0x06054b50){eocd=i;break;}
  if(eocd<0)throw Error('الملف ليس ZIP صالحًا');
  const count=zip.readUInt16LE(eocd+10),cd=zip.readUInt32LE(eocd+16);let p=cd,entry=null;
  for(let i=0;i<count;i++){
    if(zip.readUInt32LE(p)!==0x02014b50)throw Error('فهرس ZIP غير صالح');
    const method=zip.readUInt16LE(p+10),compressed=zip.readUInt32LE(p+20),uncompressed=zip.readUInt32LE(p+24),nl=zip.readUInt16LE(p+28),el=zip.readUInt16LE(p+30),cl=zip.readUInt16LE(p+32),local=zip.readUInt32LE(p+42),name=zip.toString('utf8',p+46,p+46+nl);
    if(name.toLowerCase().endsWith('.sql')){if(entry)throw Error('يجب أن يحتوي ZIP على ملف SQL واحد فقط');entry={method,compressed,uncompressed,local,name};}
    p+=46+nl+el+cl;
  }
  if(!entry)throw Error('لم يتم العثور على ملف SQL داخل ZIP');
  if(entry.uncompressed>600*1024*1024)throw Error('حجم ملف SQL بعد فك الضغط يتجاوز الحد المسموح');
  const l=entry.local;if(zip.readUInt32LE(l)!==0x04034b50)throw Error('بيانات ZIP غير صالحة');
  const data=l+30+zip.readUInt16LE(l+26)+zip.readUInt16LE(l+28),end=data+entry.compressed;
  if(end>zip.length)throw Error('بيانات الملف داخل ZIP غير مكتملة');
  const source=zip.subarray(data,end);
  if(entry.method===0)return {stream:Readable.from(source),name:entry.name};
  if(entry.method===8)return {stream:Readable.from(source).pipe(createInflateRaw()),name:entry.name};
  throw Error('طريقة ضغط ZIP غير مدعومة');
}
function indexCols(cols){return Object.fromEntries(cols.map((c,i)=>[c,i]));}
const get=(r,c,...names)=>{for(const n of names)if(c[n]!=null)return r[c[n]];return null;};
const inc=(map,key,n=1)=>map.set(key,(map.get(key)||0)+n);
const packed=(...v)=>JSON.stringify(v);
async function extract(zip) {
  const {stream,name}=readZipSql(zip), lines=createInterface({input:stream,crlfDelay:Infinity});
  const entries=new Map(), patients=new Map(), caths=[], operationRows=[], deliveryRows=[];let bytes=0,tableSeen=new Set();
  for await (const line of lines){
    bytes+=Buffer.byteLength(line); if(bytes>600*1024*1024)throw Error('حجم SQL بعد فك الضغط تجاوز الحد المسموح');
    const create=line.match(/CREATE TABLE\s+`(cardiac_registry|entry_and_exit|pationt_file|opration|obstetrics_antry_exit)`/i);if(create)tableSeen.add(create[1]);
    if(!line.startsWith('INSERT INTO'))continue;
    const insert=parseInsert(line);if(!insert)continue;
    const c=indexCols(insert.columns);
    if(insert.table==='entry_and_exit')for(const r of insert.rows){const visit=clean(get(r,c,'visit_number'));if(visit)entries.set(visit,{file:clean(get(r,c,'file_id')),date:safeDate(get(r,c,'enter_date')),type:norm(get(r,c,'cardiac_cath_type')),section:norm(get(r,c,'enter_section','sub_section'))});}
    else if(insert.table==='pationt_file')for(const r of insert.rows){const file=clean(get(r,c,'file_id'));if(file)patients.set(file,{sex:norm(get(r,c,'sex','gender')),dob:safeDate(get(r,c,'date_birth','birth_date'))});}
    else if(insert.table==='opration')for(const r of insert.rows){operationRows.push({columns:c,row:r})}
    else if(insert.table==='obstetrics_antry_exit')for(const r of insert.rows){deliveryRows.push({columns:c,row:r})}
    else if(insert.table==='cardiac_registry')for(const r of insert.rows){
      const visit=clean(get(r,c,'visit_id')); caths.push({date:safeDate(get(r,c,'report_date')),visit,typeStatus:norm(get(r,c,'cath_status','status')),indication:norm(get(r,c,'indication')),flags:{primary:get(r,c,'is_primary'),rescue:get(r,c,'is_rescue'),pharmaco_invasive:get(r,c,'is_pharmaco_invasive'),elective:get(r,c,'is_elective'),balloon:get(r,c,'is_balloon'),direct_stent:get(r,c,'is_direct_stent'),balloon_stent:get(r,c,'is_balloon_stent')}});
    }
  }
  if(!tableSeen.has('cardiac_registry')||!tableSeen.has('entry_and_exit')||!tableSeen.has('pationt_file'))throw Error('ملف SQL لا يحتوي جداول القسطرة والزيارات والمرضى المتوقعة');
  if(!caths.length)throw Error('لم يتم العثور على سجلات قسطرة في الملف');
  const daily=new Map(), indications=new Map(), techniques=new Map(), types=new Map(), statuses=new Map(), ages=new Map(), sexes=new Map(), dates=new Map();let joined=0,unjoined=0;
  for(const c of caths){const e=entries.get(c.visit);if(e)joined++;else unjoined++;const p=e?patients.get(e.file):null;const date=c.date||e?.date||'غير محدد';const type=e?.type||'غير محدد',status=c.typeStatus,band=ageBand(ageAt(p?.dob,date)),sex=p?.sex||'غير محدد';
    inc(daily,packed(date,type,status,band,sex));inc(indications,packed(date,c.indication));inc(types,type);inc(statuses,status);inc(ages,band);inc(sexes,sex);inc(dates,date);
    for(const [key,v] of Object.entries(c.flags))if(['1','true','TRUE'].includes(String(v)))inc(techniques,packed(date,key));
  }
  const ops=new Map();for(const item of operationRows){const {row:r,columns:c}=item,date=safeDate(get(r,c,'op_date'))||'غير محدد',file=clean(get(r,c,'op_file_id')),patient=patients.get(file),sex=String(patient?.sex||'').trim(),sexLabel=['1','ذكر','male','m'].includes(sex.toLowerCase())?'ذكر':['2','أنثى','انثى','female','f'].includes(sex.toLowerCase())?'أنثى':'غير محدد',department=norm(get(r,c,'op_dep')),operation=norm(get(r,c,'op_type'));let specialty=norm(get(r,c,'op_clinic'));if(department==='النساء والتوليد'&&/انف والاذن|الأنف والأذن/i.test(specialty)&&/ovarian cystectomy/i.test(operation))specialty='جراحة نساء';const dims={date,department,specialty,category:norm(get(r,c,'op_cat')),operation,anesthesia:norm(get(r,c,'anesthesia_type')),insurance:norm(get(r,c,'op_type_name')),sex:sexLabel,age:ageBand(ageAt(patient?.dob,date))};inc(ops,packed(...Object.values(dims)));}
  // Natural and caesarean deliveries are recorded in the obstetrics table, not in `opration`.
  // Include one count per delivery visit so these dates are represented in the daily pivot.
  for(const item of deliveryRows){const {row:r,columns:c}=item,rawType=clean(get(r,c,'childbirth_type'));if(!rawType||rawType==='0')continue;const typeKey=rawType.replace(/\s+/g,' ').trim(),specialty=/قيصر/i.test(typeKey)?'ولادة قيصرية':/طبيع/i.test(typeKey)?'ولادة طبيعية':`ولادة ${typeKey}`,date=safeDate(get(r,c,'baby_birth_date'))||safeDate(get(r,c,'enter_date'))||'غير محدد',file=clean(get(r,c,'file_id')),patient=patients.get(file),sexRaw=String(patient?.sex||'').trim().toLowerCase(),sex=['1','ذكر','male','m'].includes(sexRaw)?'ذكر':['2','أنثى','انثى','female','f'].includes(sexRaw)?'أنثى':'غير محدد';const dims={date,department:'النساء والتوليد',specialty,category:'الولادات',operation:specialty,anesthesia:'غير محدد',insurance:'غير محدد',sex,age:ageBand(ageAt(patient?.dob,date))};inc(ops,packed(...Object.values(dims)));}
  const mapRows=(map,keys)=>[...map].map(([k,count])=>({...Object.fromEntries(keys.map((x,i)=>[x,JSON.parse(k)[i]])),count}));
  return {name,sourceDate:(name.match(/(20\d{6})/)||[])[1]||'',total:caths.length,joined,unjoined,daily:mapRows(daily,['date','procedure_type','status','age_band','sex_code']),indications:mapRows(indications,['date','indication']),techniques:mapRows(techniques,['date','technique']),types:[...types].map(([label,count])=>({label,count})),statuses:[...statuses].map(([label,count])=>({label,count})),ages:[...ages].map(([label,count])=>({label,count})),sexes:[...sexes].map(([label,count])=>({label,count})),dates:[...dates].map(([label,count])=>({label,count})).sort((a,b)=>a.label.localeCompare(b.label)),operations:{total:[...ops.values()].reduce((n,count)=>n+count,0),rows:mapRows(ops,['date','department','specialty','category','operation','anesthesia','insurance','sex','age'])}};
}
export function cardiacCathService(sql,out){
  sql.exec(`CREATE TABLE IF NOT EXISTS cardiac_cath_daily(date TEXT NOT NULL,procedure_type TEXT NOT NULL,status TEXT NOT NULL,age_band TEXT NOT NULL,sex_code TEXT NOT NULL,count INTEGER NOT NULL,PRIMARY KEY(date,procedure_type,status,age_band,sex_code));CREATE TABLE IF NOT EXISTS cardiac_cath_daily_indications(date TEXT NOT NULL,indication TEXT NOT NULL,count INTEGER NOT NULL,PRIMARY KEY(date,indication));CREATE TABLE IF NOT EXISTS cardiac_cath_daily_techniques(date TEXT NOT NULL,technique TEXT NOT NULL,count INTEGER NOT NULL,PRIMARY KEY(date,technique));CREATE TABLE IF NOT EXISTS cardiac_cath_imports(id TEXT PRIMARY KEY,filename TEXT NOT NULL,source_date TEXT NOT NULL,file_hash TEXT NOT NULL UNIQUE,imported_at TEXT NOT NULL,total INTEGER NOT NULL,joined INTEGER NOT NULL,unjoined INTEGER NOT NULL);CREATE TABLE IF NOT EXISTS cardiac_operations(date TEXT NOT NULL,department TEXT NOT NULL,specialty TEXT NOT NULL,category TEXT NOT NULL,operation TEXT NOT NULL,anesthesia TEXT NOT NULL,insurance TEXT NOT NULL,sex TEXT NOT NULL,age TEXT NOT NULL,count INTEGER NOT NULL,PRIMARY KEY(date,department,specialty,category,operation,anesthesia,insurance,sex,age));CREATE TABLE IF NOT EXISTS cardiac_cath_manual_entries(id TEXT PRIMARY KEY,date TEXT NOT NULL,procedure_type TEXT NOT NULL,status TEXT NOT NULL,age_band TEXT NOT NULL,sex_code TEXT NOT NULL,count INTEGER NOT NULL,indication TEXT NOT NULL DEFAULT '',techniques TEXT NOT NULL DEFAULT '[]',created_at TEXT NOT NULL,created_by TEXT NOT NULL);`);
  const pending=new Map();
  return async function handleCardiacCath(req,u){
    const p=new URL(req.url).pathname;
    if(p==='/api/cardiac-cath-operations-summary'&&req.method==='GET'){const rows=sql.prepare('SELECT date,department,specialty,category,operation,anesthesia,insurance,sex,age,count FROM cardiac_operations ORDER BY date DESC,count DESC').all();return out({total:rows.reduce((n,r)=>n+Number(r.count),0),rows});}
    if(p==='/api/cardiac-cath-summary'&&req.method==='GET'){
      const daily=sql.prepare('SELECT date,procedure_type,status,age_band,sex_code,count FROM cardiac_cath_daily ORDER BY date DESC,procedure_type').all();
      const manual=sql.prepare('SELECT date,procedure_type,status,age_band,sex_code,count,indication,techniques FROM cardiac_cath_manual_entries').all();
      for(const r of manual){const row=daily.find(x=>x.date===r.date&&x.procedure_type===r.procedure_type&&x.status===r.status&&x.age_band===r.age_band&&x.sex_code===r.sex_code);if(row)row.count+=r.count;else daily.push({...r});}
      const indications=sql.prepare('SELECT date,indication,count FROM cardiac_cath_daily_indications ORDER BY date DESC,count DESC').all();
      for(const r of manual.filter(x=>x.indication)){const row=indications.find(x=>x.date===r.date&&x.indication===r.indication);if(row)row.count+=r.count;else indications.push({date:r.date,indication:r.indication,count:r.count})}
      const techniques=sql.prepare('SELECT date,technique,count FROM cardiac_cath_daily_techniques ORDER BY date DESC,technique').all();
      for(const r of manual)for(const technique of JSON.parse(r.techniques||'[]')){const row=techniques.find(x=>x.date===r.date&&x.technique===technique);if(row)row.count+=r.count;else techniques.push({date:r.date,technique,count:r.count})}
      const imports=sql.prepare('SELECT id,filename,source_date,imported_at,total,joined,unjoined FROM cardiac_cath_imports ORDER BY imported_at DESC LIMIT 20').all();
      const total=daily.reduce((n,r)=>n+Number(r.count),0), by=(key)=>{const m=new Map();for(const r of daily)m.set(r[key],(m.get(r[key])||0)+Number(r.count));return [...m].map(([label,count])=>({label,count})).sort((a,b)=>b.count-a.count)};
      return out({total,daily,indications,techniques,byType:by('procedure_type'),byStatus:by('status'),byAge:by('age_band'),bySex:by('sex_code'),imports});
    }
    if(p==='/api/cardiac-cath-entry'&&req.method==='POST'){
      if(!u||!['admin','entry','custom'].includes(u.role)||(u.role!=='admin'&&u.scope!=='hospital'))return out({error:'لا تملك صلاحية إدخال إحصائيات القسطرة'},403);
      try{
        const body=await req.json(),date=safeDate(body.date),raw=Array.isArray(body.entries)?body.entries:[body];
        if(!date||raw.length<1||raw.length>50)return out({error:'أدخل تاريخًا صحيحًا وسجلًا واحدًا على الأقل (حد أقصى 50 سجلًا)'},400);
        const allowed=['primary','rescue','pharmaco_invasive','elective','balloon','direct_stent','balloon_stent'],ages=['غير محدد','أقل من 18','18–34','35–49','50–64','65 فأكثر'];
        const rows=raw.map(b=>({procedure_type:norm(b.procedure_type),status:norm(b.status),age_band:clean(b.age_band),sex_code:clean(b.sex_code),count:Number(b.count),indication:clean(b.indication).slice(0,180),techniques:Array.isArray(b.techniques)?[...new Set(b.techniques.filter(x=>allowed.includes(x)))]:[]}));
        if(rows.some(r=>!['ذكر','أنثى','غير محدد'].includes(r.sex_code)||!ages.includes(r.age_band)||!Number.isInteger(r.count)||r.count<1||r.count>1000000))return out({error:'تحقق من الجنس والفئة العمرية والعدد في جميع السجلات'},400);
        const insert=sql.prepare('INSERT INTO cardiac_cath_manual_entries(id,date,procedure_type,status,age_band,sex_code,count,indication,techniques,created_at,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?)'),stamp=new Date().toISOString();
        sql.exec('BEGIN IMMEDIATE');try{for(const r of rows)insert.run(randomBytes(12).toString('hex'),date,r.procedure_type,r.status,r.age_band,r.sex_code==='ذكر'?'1':r.sex_code==='أنثى'?'2':'غير محدد',r.count,r.indication,JSON.stringify(r.techniques),stamp,u.id);sql.exec('COMMIT')}catch(e){sql.exec('ROLLBACK');throw e}
        return out({saved:true,count:rows.length});
      }catch(e){return out({error:e.message||'تعذر حفظ الإحصائيات'},400)}
    }
    if(p==='/api/cardiac-cath-preview'&&req.method==='POST'){
      if(u?.role!=='admin')return out({error:'استيراد ملف القسطرة متاح لمدير النظام فقط'},403);
      try{const form=await req.formData(),file=form.get('file');if(!file||typeof file.arrayBuffer!=='function')return out({error:'اختر ملف ZIP أولًا'},400);if(file.size<1||file.size>80*1024*1024)return out({error:'حجم الملف يجب ألا يتجاوز 80 ميجابايت'},413);if(!file.name.toLowerCase().endsWith('.zip'))return out({error:'ارفع نسخة ZIP من قاعدة البيانات'},400);
        const zip=Buffer.from(await file.arrayBuffer()),digest=createHash('sha256').update(zip).digest('hex'),existingImport=sql.prepare('SELECT imported_at,total FROM cardiac_cath_imports WHERE file_hash=?').get(digest),hasDaily=Number(sql.prepare('SELECT COUNT(*) AS n FROM cardiac_cath_daily').get().n)>0,data=await extract(zip),storedOperations=Number(sql.prepare('SELECT COALESCE(SUM(count),0) AS n FROM cardiac_operations').get().n),expectedOperations=Number(data.operations?.total||0),refreshingOperations=!!existingImport&&hasDaily&&expectedOperations>storedOperations,duplicate=!!existingImport&&hasDaily&&!refreshingOperations;const token=randomBytes(24).toString('base64url');pending.set(token,{digest,data,duplicate,created:Date.now()});for(const [k,v] of pending)if(Date.now()-v.created>15*60*1000)pending.delete(k);
        return out({token,duplicate,refreshingOperations,previousImport:existingImport?.imported_at||null,...data,operations:{total:data.operations?.total||0,byCategory:[...new Set((data.operations?.rows||[]).map(x=>x.category))].map(label=>({label,count:(data.operations.rows||[]).filter(x=>x.category===label).reduce((n,x)=>n+x.count,0)}))}});
      }catch(e){return out({error:e.message||'تعذر قراءة الملف'},400)}
    }
    if(p==='/api/cardiac-cath-commit'&&req.method==='POST'){
      if(u?.role!=='admin')return out({error:'اعتماد الاستيراد متاح لمدير النظام فقط'},403);
      try{const b=await req.json(),item=pending.get(b.token);if(!item)return out({error:'انتهت صلاحية المعاينة. ارفع الملف مجددًا'},400);pending.delete(b.token);if(item.duplicate)return out({imported:false,duplicate:true,total:item.data.total});const d=item.data,stamp=new Date().toISOString();sql.exec('BEGIN IMMEDIATE');try{
          sql.exec('DELETE FROM cardiac_cath_daily;DELETE FROM cardiac_cath_daily_indications;DELETE FROM cardiac_cath_daily_techniques;DELETE FROM cardiac_operations;');
          const dateStmt=sql.prepare('INSERT INTO cardiac_cath_daily(date,procedure_type,status,age_band,sex_code,count) VALUES(?,?,?,?,?,?)');for(const r of d.daily)dateStmt.run(r.date,r.procedure_type,r.status,r.age_band,r.sex_code,r.count);
          const operationsStmt=sql.prepare('INSERT INTO cardiac_operations(date,department,specialty,category,operation,anesthesia,insurance,sex,age,count) VALUES(?,?,?,?,?,?,?,?,?,?)');for(const r of d.operations?.rows||[])operationsStmt.run(r.date,r.department,r.specialty,r.category,r.operation,r.anesthesia,r.insurance,r.sex,r.age,r.count);
          const indicationStmt=sql.prepare('INSERT INTO cardiac_cath_daily_indications(date,indication,count) VALUES(?,?,?)');for(const r of d.indications)indicationStmt.run(r.date,r.indication,r.count);
          const techniqueStmt=sql.prepare('INSERT INTO cardiac_cath_daily_techniques(date,technique,count) VALUES(?,?,?)');for(const r of d.techniques)techniqueStmt.run(r.date,r.technique,r.count);
          sql.prepare('INSERT INTO cardiac_cath_imports(id,filename,source_date,file_hash,imported_at,total,joined,unjoined) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(file_hash) DO UPDATE SET filename=excluded.filename,source_date=excluded.source_date,imported_at=excluded.imported_at,total=excluded.total,joined=excluded.joined,unjoined=excluded.unjoined').run(randomBytes(12).toString('hex'),d.name,d.sourceDate,item.digest,stamp,d.total,d.joined,d.unjoined);sql.exec('COMMIT');
        }catch(e){sql.exec('ROLLBACK');throw e}return out({imported:true,total:d.total,joined:d.joined,unjoined:d.unjoined,importedAt:stamp});
      }catch(e){return out({error:e.message||'تعذر اعتماد الإحصائيات'},400)}
    }
    return null;
  };
}
