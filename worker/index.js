import {db} from './db.js';
import {seed,assets} from './generated.js';
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
let units=[];const now='2026-10-04T00:00:00Z';
for(const h of seed.hospitals)units.push(['INSERT OR IGNORE INTO hospitals (id,name,region,location,status,start) VALUES (?,?,?,?,?,?)',[h.id,h.name,h.region,h.location,h.status,h.start]]);
for(const m of seed.metrics)units.push(['INSERT OR IGNORE INTO metrics (key,label,group_name,derived) VALUES (?,?,?,?)',[m.key,m.label,m.group,+m.derived]]);
for(const s of seed.sources)units.push(['INSERT OR IGNORE INTO import_sources (id,name,sheets_json) VALUES (?,?,?)',[s.id,s.name,JSON.stringify(s.sheets)]]);
for(const r of seed.records)units.push(['INSERT OR IGNORE INTO hospital_records (id,hospital_id,date,period_end,kind,values_json,source_id,source_sheet,source_row,needs_review,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',[r.id,r.hospital,r.date,r.end,r.kind,JSON.stringify(r.values),r.source,r.sheet,r.row,+r.review,now,now]]);
for(const s of seed.snapshots)units.push(['INSERT OR IGNORE INTO source_snapshots (id,hospital_id,source_id,title,kind,values_json) VALUES (?,?,?,?,?,?)',[s.id,s.hospital,s.source,s.title,s.kind,JSON.stringify(s.values)]]);
for(const r of seed.rawRows)units.push(['INSERT OR IGNORE INTO source_rows (id,hospital_id,source_id,sheet,row,date,values_json) VALUES (?,?,?,?,?,?,?)',[r.id,r.hospital,r.source,r.sheet,r.row,r.date,JSON.stringify(r.values)]]);
for(const i of seed.issues)units.push(['INSERT OR IGNORE INTO import_issues (id,hospital_id,source_id,date,message,details) VALUES (?,?,?,?,?,?)',[i.id,i.hospital,i.source,i.date,i.message,i.details]]);
if(seed.importScope)units=units.filter(([sql,p])=>sql.includes('INTO metrics')||(sql.includes('INTO hospitals')&&p[0]===seed.importScope)||(sql.includes('INTO import_sources')&&seed.importSourceIds.includes(p[0]))||(!sql.includes('INTO hospitals')&&!sql.includes('INTO import_sources')&&p[1]===seed.importScope));
if(seed.ems){const e=seed.ems;units.push(['INSERT OR IGNORE INTO import_sources (id,name,sheets_json) VALUES (?,?,?)',[e.source.id,e.source.name,JSON.stringify(e.source.sheets)]]);for(const r of e.records)units.push(['INSERT OR IGNORE INTO ems_records (id,region,date,period_end,kind,values_json,source_id,source_sheet,source_row) VALUES (?,?,?,?,?,?,?,?,?)',[r.id,r.region,r.date,r.end,r.kind,JSON.stringify(r.values),r.source,r.sheet,r.row]]);for(const i of e.issues)units.push(['INSERT OR IGNORE INTO import_issues (id,hospital_id,source_id,date,message,details) VALUES (?,?,?,?,?,?)',[i.id,'ems',e.source.id,i.date,i.message,i.details]]);for(const [n,s] of e.snapshots.entries())units.push(['INSERT OR IGNORE INTO source_snapshots (id,hospital_id,source_id,title,kind,values_json) VALUES (?,?,?,?,?,?)',['ems:snapshot:'+n,'ems',e.source.id,s.title,'ems_cumulative',JSON.stringify(s.values)]]);}
const phcUnits=[];if(seed.phc){const p=seed.phc;phcUnits.push(['INSERT OR IGNORE INTO import_sources (id,name,sheets_json) VALUES (?,?,?)',[p.source.id,p.source.name,JSON.stringify(p.source.sheets)]]);for(const c of p.clinics)phcUnits.push(['INSERT OR IGNORE INTO phc_clinics (id,name,region,code,start) VALUES (?,?,?,?,?)',[c.id,c.name,c.region,c.code,c.start]]);for(const r of p.records)phcUnits.push(['INSERT OR IGNORE INTO phc_records (id,clinic_id,date,period_end,kind,total,source_id,source_sheet,source_row,source_column) VALUES (?,?,?,?,?,?,?,?,?,?)',[r.id,r.clinic,r.date,r.end,r.kind,r.total,r.source,r.sheet,r.row,r.column]]);}
async function importPHCStep(env){const d=db(env);await d.query('INSERT OR IGNORE INTO import_progress (id,cursor,total,done) VALUES (?,0,?,0)','phc-import-2026-10-05-v1',phcUnits.length).run();let p=await d.query('SELECT * FROM import_progress WHERE id=?','phc-import-2026-10-05-v1').first();if(p.done)return p;const next=Math.min(p.cursor+500,phcUnits.length);await d.batch([...phcUnits.slice(p.cursor,next).map(([s,p])=>d.query(s,...p)),d.query('UPDATE import_progress SET cursor=MAX(cursor,?),done=? WHERE id=?',next,+(next===phcUnits.length),'phc-import-2026-10-05-v1')]);return d.query('SELECT * FROM import_progress WHERE id=?','phc-import-2026-10-05-v1').first()}
async function importStep(env){const d=db(env);await d.query('INSERT OR IGNORE INTO import_progress (id,cursor,total,done) VALUES (?,0,?,0)',seed.version,units.length).run();let p=await d.query('SELECT * FROM import_progress WHERE id=?',seed.version).first();if(p.done)return p;const next=Math.min(p.cursor+500,units.length);await d.batch([...units.slice(p.cursor,next).map(([s,p])=>d.query(s,...p)),d.query('UPDATE import_progress SET cursor=MAX(cursor,?),done=? WHERE id=?',next,+(next===units.length),seed.version)]);return d.query('SELECT * FROM import_progress WHERE id=?',seed.version).first()}
function validateDate(s){return typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&!isNaN(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s}
function totals(v){const sum=ks=>ks.reduce((a,k)=>a+(v[k]??0),0);const any=ks=>ks.some(k=>v[k]!=null);for(const [key,keys] of Object.entries({J:['G','H','I'],AI:seed.metrics.filter(m=>m.group==='العيادات الخارجية'&&!m.derived).map(m=>m.key),AQ:['AK','AL','AM','AN','AO','AP'],AU:['AR','AS','AT'],BD:['AV','AW','AX','AY','AZ','BA','BB','BC'],BI:['BE','BF','BG','BH']}))v[key]=any(keys)?sum(keys):null;const keys=['J','AI','AJ','AQ','AU','BD','BI','BJ','BK'];v.B=v.BL=any(keys)?sum(keys):null;return v}
function emsValues(input){if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('أدخل بيانات صحيحة');const v={};for(const m of seed.ems.metrics){if(['medical_total','injuries_total','incidents_total','total'].includes(m.key))continue;const x=input[m.key];if(x==null||x===''){v[m.key]=null;continue}if(!Number.isSafeInteger(x)||x<0)throw new Error('أدخل أعدادًا صحيحة غير سالبة');v[m.key]=x}if(!Object.values(v).some(x=>x!=null))throw new Error('أدخل قيمة واحدة على الأقل');const sum=keys=>keys.reduce((a,k)=>a+(v[k]||0),0);v.medical_total=sum(['accident','childbirth','illness','hospital_transfer','home_transfer','emergency']);v.injuries_total=sum(['bullets','fragments','rubber','gas','other','field_treatment','evacuation']);v.incidents_total=(v.deceased||0)+v.injuries_total;v.total=v.medical_total+v.incidents_total;if(!Object.values(v).every(x=>x===null||Number.isSafeInteger(x)))throw new Error('القيم أكبر من الحد المسموح');return v}
function emsMonth(date){const start=date.slice(0,7)+'-01',end=new Date(Date.UTC(+date.slice(0,4),+date.slice(5,7),0)).toISOString().slice(0,10);return {start,end}}
async function emsMutation(request,d){const b=await request.json(),old=b.id?await d.query('SELECT * FROM ems_records WHERE id=? AND deleted=0',b.id).first():null;if(b.id&&!old)return json({error:'السجل غير موجود أو تم حذفه'},404);const stamp=new Date().toISOString();
if(b.action==='delete'){if(!old)return json({error:'اختر سجلًا للحذف'},400);const ops=[d.query('UPDATE ems_records SET deleted=1,updated_at=? WHERE id=?',stamp,old.id)];if(old.kind==='monthly')ops.push(d.query("UPDATE ems_records SET deleted=1,updated_at=? WHERE region=? AND kind='daily' AND date>=? AND date<=?",stamp,old.region,old.date,old.period_end));else{const month=emsMonth(old.date),values=JSON.parse(old.values_json);ops.push(emsDelta(d,old.region,month.start,{},values,stamp))}await d.batch(ops);return json({deleted:true})}
if(!(await d.query('SELECT name FROM ems_centers WHERE name=?',b.region).first())||!['daily','monthly'].includes(b.kind)||!validateDate(b.date)||b.date>new Date().toISOString().slice(0,10))return json({error:'اختر المحافظة ونوع السجل وتاريخًا صحيحًا غير مستقبلي'},400);const month=emsMonth(b.date);if(b.kind==='monthly'&&b.date!==month.start)return json({error:'اختر الشهر المراد تسجيل إحصائيته'},400);if(old&&(old.region!==b.region||old.date!==b.date||old.kind!==b.kind))return json({error:'لا يمكن تغيير محافظة أو فترة السجل أثناء التعديل'},400);let v;try{v=emsValues(b.values)}catch(e){return json({error:e.message},400)}const duplicate=await d.query('SELECT id FROM ems_records WHERE region=? AND date=? AND kind=? AND deleted=0',b.region,b.date,b.kind).first();if(duplicate&&!old)return json({error:'يوجد سجل لهذه المحافظة والفترة؛ افتح السجل لتعديله'},409);
const monthly=await d.query("SELECT * FROM ems_records WHERE region=? AND date=? AND kind='monthly' AND deleted=0",b.region,month.start).first();const daily=await d.query("SELECT id FROM ems_records WHERE region=? AND kind='daily' AND date>=? AND date<=? AND deleted=0",b.region,month.start,month.end).first();if(!old&&b.kind==='monthly'&&daily)return json({error:'يوجد تفصيل يومي للشهر؛ الملخص يُحدّث تلقائيًا من السجلات اليومية'},409);if(!old&&b.kind==='daily'&&monthly&&!daily&&monthly.source_sheet!=='ملخص تلقائي')return json({error:'الشهر مسجل كملخص فقط. عدّل الملخص أو احذفه قبل إدخال التفاصيل اليومية'},409);
const id=old?.id||'ems:manual:'+b.region+':'+b.kind+':'+b.date,end=b.kind==='monthly'?month.end:b.date,notes=String(b.notes||'').slice(0,3000),ops=[];if(old)ops.push(d.query('UPDATE ems_records SET values_json=?,notes=?,updated_at=? WHERE id=?',JSON.stringify(v),notes,stamp,old.id));else ops.push(d.query("INSERT INTO ems_records (id,region,date,period_end,kind,values_json,source_id,source_sheet,source_row,deleted,notes,updated_at) VALUES (?,?,?,?,?,?,'manual','إدخال يدوي',0,0,?,?) ON CONFLICT(region,date,kind) DO UPDATE SET values_json=excluded.values_json,deleted=0,source_id='manual',source_sheet='إدخال يدوي',source_row=0,notes=excluded.notes,updated_at=excluded.updated_at",id,b.region,b.date,end,b.kind,JSON.stringify(v),notes,stamp));
if(b.kind==='daily'){if(monthly)ops.push(emsDelta(d,b.region,month.start,v,old?JSON.parse(old.values_json):{},stamp));else ops.push(d.query("INSERT INTO ems_records (id,region,date,period_end,kind,values_json,source_id,source_sheet,source_row,updated_at) VALUES (?,?,?,?, 'monthly',?,'manual','ملخص تلقائي',0,?) ON CONFLICT(region,date,kind) DO UPDATE SET values_json=excluded.values_json,deleted=0,source_id='manual',source_sheet='ملخص تلقائي',source_row=0,updated_at=excluded.updated_at",'ems:monthly:'+b.region+':'+month.start,b.region,month.start,month.end,JSON.stringify(v),stamp))}await d.batch(ops);return json({saved:true,id})}
function emsDelta(d,region,date,values,previous,stamp){const params=[];const pairs=seed.ems.metrics.map(m=>{params.push((values[m.key]||0)-(previous[m.key]||0));return "'$."+m.key+"',MAX(0,COALESCE(json_extract(values_json,'$."+m.key+"'),0)+?)"});return d.query("UPDATE ems_records SET values_json=json_set(values_json,"+pairs.join(',')+"),updated_at=? WHERE region=? AND date=? AND kind='monthly' AND deleted=0",...params,stamp,region,date)}

const PHC_GROUPS=[
 {key:'medical',label:'الطب العام'},
 {key:'conditions',label:'تصنيفات الحالات والخدمات'},
 {key:'nursing',label:'التمريض'},
 {key:'vaccine',label:'التطعيم'},
 {key:'child_nutrition',label:'تغذية الأطفال من 6 أشهر إلى 5 سنوات'},
 {key:'plw_nutrition',label:'تغذية الحوامل والمرضعات'},
 {key:'clinic_summary',label:'إجمالي العيادة'},
 {key:'reproductive_health',label:'الصحة الإنجابية'},
 {key:'pharmacy',label:'خدمات الصيدلية'},
 {key:'laboratory',label:'خدمات المختبر'},
 {key:'diagnostics',label:'الخدمات التشخيصية'},
 {key:'mental_health',label:'الصحة النفسية'},
 {key:'health_promotion',label:'تعزيز الصحة والتوعية'},
 {key:'injury_management',label:'إدارة الإصابات'}
];
const PHC_DEFAULT_METRICS=[
 ['medical','medical_male_0_18','ذكور 0–18',0],['medical','medical_female_0_18','إناث 0–18',0],
 ['medical','medical_male_18_60','ذكور 18–60',0],['medical','medical_female_18_60','إناث 18–60',0],
 ['medical','medical_male_band3','ذكور، الفئة الثالثة (Male <60 في الملف)',0],['medical','medical_female_band3','إناث، الفئة الثالثة (Female <60 في الملف)',0],
 ['medical','medical_total','إجمالي الطب العام',1],
 ['conditions','disabilities','أشخاص ذوو إعاقة',1],['conditions','skin','أمراض جلدية',1],
 ['conditions','respiratory','أمراض تنفسية',1],['conditions','gastroenteritis','التهاب المعدة والأمعاء',1],
 ['conditions','hav','التهاب الكبد A (HAV)',1],['conditions','chronic','أمراض مزمنة',1],
 ['conditions','ent','أنف وأذن وحنجرة',1],['conditions','orthopedic','عظام',1],
 ['conditions','ophthalmology','عيون',1],['conditions','neurology','أعصاب',1],
 ['conditions','gynecology_obstetrics','نساء وولادة',1],['conditions','urology','مسالك بولية',1],
 ['conditions','ultrasound','أشعة (ألتراساوند)',1],['conditions','conditions_other','أخرى',1],
 ['nursing','nursing_male_0_18','ذكور 0–18',0],['nursing','nursing_female_0_18','إناث 0–18',0],
 ['nursing','nursing_male_18_60','ذكور 18–60',0],['nursing','nursing_female_18_60','إناث 18–60',0],
 ['nursing','nursing_male_band3','ذكور، الفئة الثالثة (Male <60 في الملف)',0],['nursing','nursing_female_band3','إناث، الفئة الثالثة (Female <60 في الملف)',0],
 ['nursing','nursing_total','إجمالي التمريض',1],
 ['vaccine','vaccine_total','إجمالي المطاعيم',1],
 ['child_nutrition','child_normal_muac','MUAC طبيعي للأطفال',1],['child_nutrition','child_sam','حالات SAM للأطفال',1],
 ['child_nutrition','child_mam','حالات MAM للأطفال',1],
 ['plw_nutrition','plw_normal_muac','MUAC طبيعي للحوامل والمرضعات',1],['plw_nutrition','plw_sam','حالات SAM للحوامل والمرضعات',1],
 ['plw_nutrition','plw_mam','حالات MAM للحوامل والمرضعات',1],
 ['child_nutrition','nutrition_total','إجمالي التغذية (مجموع فئات الأطفال والحوامل والمرضعات)',1],
 ['clinic_summary','clinic_total','إجمالي الحالات بالعيادة',1]
];
const PHC_DERIVED_FIELDS={};
const PHC_AGE_BANDS=[['0_18','0–18 سنة'],['18_60','18–60 سنة'],['band3','الفئة الثالثة (<60 في المصدر)']];
for(const [group,key,label] of [...PHC_DEFAULT_METRICS]){
 if(group==='conditions'&&['disabilities','skin','respiratory','gastroenteritis','hav','chronic','ent','orthopedic','ophthalmology','neurology','gynecology_obstetrics','urology','ultrasound','conditions_other'].includes(key)){
  const children=[];for(const [band]of PHC_AGE_BANDS)for(const sex of ['male','female']){const child=key+'_'+sex+'_'+band;children.push(child);PHC_DEFAULT_METRICS.push(['conditions',child,label+' · '+(sex==='male'?'ذكور':'إناث')+' · '+PHC_AGE_BANDS.find(x=>x[0]===band)[1],0])}PHC_DERIVED_FIELDS[key]=children;
 }
 if(group==='child_nutrition'&&['child_normal_muac','child_sam','child_mam'].includes(key)){const children=['male','female'].map(sex=>key+'_'+sex);PHC_DERIVED_FIELDS[key]=children;for(const sex of ['male','female'])PHC_DEFAULT_METRICS.push([group,key+'_'+sex,label+' · '+(sex==='male'?'ذكور':'إناث'),0])}
 if(group==='plw_nutrition'&&['plw_normal_muac','plw_sam','plw_mam'].includes(key)){const children=[key+'_under18',key+'_over18'];PHC_DERIVED_FIELDS[key]=children;PHC_DEFAULT_METRICS.push([group,children[0],label+' · أقل من 18 سنة',0],[group,children[1],label+' · 18 سنة فأكثر',0])}
}
PHC_DERIVED_FIELDS.vaccine_total=['vaccine_male','vaccine_female'];PHC_DEFAULT_METRICS.push(['vaccine','vaccine_male','مطاعيم · ذكور',0],['vaccine','vaccine_female','مطاعيم · إناث',0]);
const PHC_SERVICE_METRICS=[
 ['reproductive_health','antenatal_care','زيارات رعاية ما قبل الولادة'],['reproductive_health','postnatal_care','زيارات رعاية ما بعد الولادة'],['reproductive_health','family_planning_counseling','استشارات تنظيم الأسرة'],['reproductive_health','family_planning_commodities','توفير وسائل تنظيم الأسرة'],
 ['pharmacy','patients_receiving_medicines','مرضى صُرفت لهم أدوية'],
 ['laboratory','lab_tests','فحوصات الدم والبول والبراز'],['laboratory','colocated_lab_tests','فحوصات المختبر في المركز الأعلى'],
 ['diagnostics','ultrasound_tests','فحوصات الألتراساوند'],['diagnostics','glucose_tests','فحوصات سكر الدم'],['diagnostics','hemoglobin_tests','فحوصات الهيموغلوبين'],['diagnostics','cholesterol_tests','فحوصات الكوليسترول'],['diagnostics','ct_scans','فحوصات CT'],['diagnostics','xray_tests','فحوصات الأشعة السينية'],['diagnostics','other_diagnostic_tests','فحوصات تشخيصية أخرى'],
 ['mental_health','individual_psychological_counseling','جلسات الإرشاد النفسي الفردي'],['mental_health','mhgap_consultations','استشارات mhGAP'],['mental_health','pfa_sessions','خدمات الإسعاف النفسي الأولي PFA'],
 ['health_promotion','health_education_sessions','أنشطة التثقيف والتوعية الصحية'],
 ['injury_management','wound_care_cases','حالات العناية بالجروح والخياطة والحروق']
];
PHC_DEFAULT_METRICS.push(...PHC_SERVICE_METRICS.map(([group,key,label])=>[group,key,label,0]));
async function phcSettingsHandler(request,d){
 const values=PHC_DEFAULT_METRICS.flatMap((m,i)=>[m[1],m[0],m[2],i,m[3]]),slots=PHC_DEFAULT_METRICS.map(()=>'(?,?,?,?,1,?)').join(',');
 if(values.length)await d.query('INSERT OR IGNORE INTO phc_metrics (key,group_key,label,order_no,enabled,derived) VALUES '+slots,...values).run();
 if(request.method==='GET'){
  const metrics=(await d.query('SELECT * FROM phc_metrics ORDER BY order_no,key').all()).results;
  return json({groups:PHC_GROUPS,metrics});
 }
 if(request.method!=='POST')return json({error:'الطريقة غير مدعومة'},405);
 const b=await request.json();
 if(b.action==='save'){
  const old=await d.query('SELECT * FROM phc_metrics WHERE key=?',b.key).first();
  if(!old)return json({error:'حقل الإحصائية غير موجود'},404);
  const label=typeof b.label==='string'?b.label.trim():'';
  if(!label||label.length>120)return json({error:'أدخل اسمًا صحيحًا للحقل (حتى 120 حرفًا)'},400);
  const enabled=old.derived?1:(b.enabled===false?0:1);
  await d.query('UPDATE phc_metrics SET label=?,enabled=? WHERE key=?',label,enabled,b.key).run();
 }else if(b.action==='add'){
  const group=PHC_GROUPS.find(g=>g.key===b.group_key),label=typeof b.label==='string'?b.label.trim():'';
  if(!group||!label||label.length>120)return json({error:'اختر مجموعة وأدخل اسمًا صحيحًا للحقل'},400);
  const key='custom_'+crypto.randomUUID().replaceAll('-','');
  const order=await d.query('SELECT COALESCE(MAX(order_no),0)+1 value FROM phc_metrics WHERE group_key=?',group.key).first();
  await d.query('INSERT INTO phc_metrics (key,group_key,label,order_no,enabled,derived) VALUES (?,?,?,?,1,0)',key,group.key,label,order.value).run();
 }else return json({error:'إجراء الإعدادات غير معروف'},400);
 return json({saved:true});
}
async function phcCleanDetails(raw,old,d){
 if(raw==null)return old?.details_json||null;
 if(typeof raw!=='object'||Array.isArray(raw))throw new Error('تفاصيل الإحصائية غير صحيحة');
 const metrics=(await d.query('SELECT key,enabled,derived FROM phc_metrics').all()).results,known=new Set(metrics.map(m=>m.key));
 for(const key of Object.keys(raw))if(!known.has(key))throw new Error('يوجد حقل إحصائي غير معروف');
 const details=old?.details_json?JSON.parse(old.details_json):{};
 for(const metric of metrics){
  if(!metric.enabled||metric.derived)continue;
  if(!Object.prototype.hasOwnProperty.call(raw,metric.key)){if(!old)details[metric.key]=null;continue}
  const value=raw[metric.key];
  if(value==null||value===''){details[metric.key]=null;continue}
  if(!Number.isSafeInteger(value)||value<0)throw new Error('أدخل أعدادًا صحيحة غير سالبة في تفاصيل الإحصائية');
  details[metric.key]=value;
 }
 for(const [total,keys] of Object.entries(PHC_DERIVED_FIELDS)){
  const entered=keys.some(k=>details[k]!=null);
  if(entered)details[total]=keys.reduce((n,k)=>n+(details[k]||0),0);
  else if(!old)details[total]=null;
 }
 for(const total of ['medical_total','nursing_total']){
  const prefix=total==='medical_total'?'medical':'nursing',keys=PHC_AGE_BANDS.flatMap(([band])=>['male','female'].map(sex=>prefix+'_'+sex+'_'+band)),entered=keys.some(k=>details[k]!=null);
  if(entered)details[total]=keys.reduce((n,k)=>n+(details[k]||0),0);else if(!old)details[total]=null;
 }
 const nutritionKeys=['child_normal_muac','child_sam','child_mam','plw_normal_muac','plw_sam','plw_mam'],nutritionEntered=nutritionKeys.some(k=>details[k]!=null);
 if(nutritionEntered)details.nutrition_total=nutritionKeys.reduce((n,k)=>n+(details[k]||0),0);else if(!old)details.nutrition_total=null;
 // The clinic grand total is a server-derived value. Sum the group totals so
 // that age/sex breakdowns and their row totals are never counted twice.
 const serviceGroups=['reproductive_health','pharmacy','laboratory','diagnostics','mental_health','health_promotion','injury_management'];const clinicParts=['medical_total','nursing_total',...Object.keys(PHC_DERIVED_FIELDS).filter(k=>['disabilities','skin','respiratory','gastroenteritis','hav','chronic','ent','orthopedic','ophthalmology','neurology','gynecology_obstetrics','urology','ultrasound','conditions_other'].includes(k)),'vaccine_total','nutrition_total',...metrics.filter(m=>m.enabled&&!m.derived&&(m.key.startsWith('custom_')||serviceGroups.includes(m.group_key))).map(m=>m.key)];
 const clinicEntered=clinicParts.some(k=>details[k]!=null);
 if(clinicEntered)details.clinic_total=clinicParts.reduce((n,k)=>n+(details[k]||0),0);
 else if(!old)details.clinic_total=null;
 return Object.keys(details).some(k=>details[k]!=null)?JSON.stringify(details):null;
}
async function phcRecomputeMonth(d,clinic,date,stamp){
 const m=emsMonth(date),rows=(await d.query("SELECT total,details_json FROM phc_records WHERE clinic_id=? AND kind='daily' AND date>=? AND date<=? AND deleted=0",clinic,m.start,m.end).all()).results;
 const total=rows.reduce((n,r)=>n+(r.total||0),0),details={};let hasDetails=false;
 for(const row of rows)if(row.details_json){hasDetails=true;const values=JSON.parse(row.details_json);for(const [key,value] of Object.entries(values))if(value!=null)details[key]=(details[key]||0)+value}
 const monthly=await d.query("SELECT id,source_sheet FROM phc_records WHERE clinic_id=? AND date=? AND kind='monthly' AND deleted=0",clinic,m.start).first();
 if(monthly&&monthly.source_sheet!=='ملخص تلقائي')return;
 if(monthly)await d.query('UPDATE phc_records SET total=?,details_json=?,updated_at=? WHERE id=?',total,hasDetails?JSON.stringify(details):null,stamp,monthly.id).run();
 else await d.query("INSERT INTO phc_records (id,clinic_id,date,period_end,kind,total,details_json,source_id,source_sheet,deleted,updated_at) VALUES (?,?,?,?,'monthly',?,?,'manual','ملخص تلقائي',0,?) ON CONFLICT(clinic_id,date,kind) DO UPDATE SET total=excluded.total,details_json=excluded.details_json,deleted=0,source_sheet='ملخص تلقائي',updated_at=excluded.updated_at",'phc:monthly:'+clinic+':'+m.start,clinic,m.start,m.end,total,hasDetails?JSON.stringify(details):null,stamp).run();
}

async function phcMutation(request,d){
 const b=await request.json(),old=b.id?await d.query('SELECT * FROM phc_records WHERE id=? AND deleted=0',b.id).first():null;
 if(b.id&&!old)return json({error:'السجل غير موجود أو تم حذفه'},404);
 const stamp=new Date().toISOString();
 if(b.action==='delete'){
  if(!old)return json({error:'اختر سجلًا للحذف'},400);
  const ops=[d.query('UPDATE phc_records SET deleted=1,updated_at=? WHERE id=?',stamp,old.id)];
  if(old.kind==='monthly')ops.push(d.query("UPDATE phc_records SET deleted=1,updated_at=? WHERE clinic_id=? AND kind='daily' AND date>=? AND date<=?",stamp,old.clinic_id,old.date,old.period_end));
  await d.batch(ops);
  if(old.kind==='daily')await phcRecomputeMonth(d,old.clinic_id,old.date,stamp);
  return json({deleted:true});
 }
 const clinic=await d.query("SELECT id,status FROM phc_clinics WHERE id=?",b.clinic).first();if(!clinic||!validateDate(b.date)||b.date>new Date().toISOString().slice(0,10)||!['daily','monthly','historical'].includes(b.kind)||(!old&&b.kind==='historical'))return json({error:'اختر العيادة ونوع الإحصائية وتاريخًا صحيحًا غير مستقبلي'},400);if(!old&&clinic.status==='closed')return json({error:'لا يمكن إدخال إحصائية جديدة لعيادة مغلقة'},409);
 const hasDetails=b.details&&typeof b.details==='object'&&!Array.isArray(b.details);
 if(!hasDetails&&(!Number.isSafeInteger(b.total)||b.total<0))return json({error:'أدخل عددًا صحيحًا غير سالب'},400);
 const m=emsMonth(b.date);
 if(b.kind==='monthly'&&b.date!==m.start)return json({error:'اختر الشهر الصحيح'},400);
 if(old&&(old.clinic_id!==b.clinic||old.date!==b.date||old.kind!==b.kind))return json({error:'لا يمكن تغيير العيادة أو الفترة أثناء التعديل'},400);
 const duplicate=await d.query('SELECT id FROM phc_records WHERE clinic_id=? AND date=? AND kind=? AND deleted=0',b.clinic,b.date,b.kind).first();
 if(duplicate&&!old)return json({error:'يوجد سجل لهذه العيادة والفترة؛ افتح السجل لتعديله'},409);
 const historical=await d.query("SELECT id FROM phc_records WHERE clinic_id=? AND kind='historical' AND date<=? AND period_end>=? AND deleted=0",b.clinic,b.kind==='monthly'?m.end:b.date,b.date).first();
 if(historical&&!old)return json({error:'الفترة مغطاة بملخص تاريخي. عدّل الملخص أو احذفه قبل إدخال تفاصيلها'},409);
 const monthly=await d.query("SELECT * FROM phc_records WHERE clinic_id=? AND date=? AND kind='monthly' AND deleted=0",b.clinic,m.start).first();
 const daily=await d.query("SELECT id FROM phc_records WHERE clinic_id=? AND kind='daily' AND date>=? AND date<=? AND deleted=0",b.clinic,m.start,m.end).first();
 if(!old&&b.kind==='daily'&&monthly&&!daily&&monthly.source_sheet!=='ملخص تلقائي')return json({error:'الشهر مسجل كملخص فقط؛ عدّل الملخص أو احذفه قبل إدخال التفاصيل'},409);
 if(!old&&b.kind==='monthly'&&daily)return json({error:'الملخص الشهري يُحدّث تلقائيًا من التفاصيل اليومية'},409);
 let detailsJson=old?.details_json||null,total=b.total;
 if(hasDetails){
  try{detailsJson=await phcCleanDetails(b.details,old,d)}catch(e){return json({error:e.message},400)}
  const details=detailsJson?JSON.parse(detailsJson):{};
  total=details.clinic_total??null;
 }
 if(total!=null&&(!Number.isSafeInteger(total)||total<0))return json({error:'أدخل إجماليًا صحيحًا غير سالب'},400);
 const id=old?.id||'phc:manual:'+b.clinic+':'+b.kind+':'+b.date,notes=String(b.notes||'').slice(0,3000);
 if(old)await d.query('UPDATE phc_records SET total=?,details_json=?,notes=?,updated_at=? WHERE id=?',total,detailsJson,notes,stamp,id).run();
 else await d.query("INSERT INTO phc_records (id,clinic_id,date,period_end,kind,total,details_json,source_id,source_sheet,deleted,notes,updated_at) VALUES (?,?,?,?,?,?,?,'manual','إدخال يدوي',0,?,?) ON CONFLICT(clinic_id,date,kind) DO UPDATE SET total=excluded.total,details_json=excluded.details_json,deleted=0,source_id='manual',source_sheet='إدخال يدوي',notes=excluded.notes,updated_at=excluded.updated_at",id,b.clinic,b.date,b.kind==='monthly'?m.end:b.date,b.kind,total,detailsJson,notes,stamp).run();
 if(b.kind==='daily')await phcRecomputeMonth(d,b.clinic,b.date,stamp);
 return json({saved:true,id});
}

function clinicView(c){return {...c,services:JSON.parse(c.services_json||'[]'),services_json:undefined}}
async function clinicMutation(request,d){const b=await request.json();const name=typeof b.name==='string'?b.name.trim():'',region=typeof b.region==='string'?b.region.trim():'';if(!name||name.length>160||!['شمال غزة','غزة','الوسطى','خانيونس','رفح'].includes(region))return json({error:'أدخل اسم العيادة واختر المحافظة'},400);const fields={};for(const [k,max] of [['address',600],['code',40]]){if(b[k]!=null&&typeof b[k]!=='string')return json({error:'بيانات غير صحيحة'},400);fields[k]=String(b[k]||'').trim();if(fields[k].length>max)return json({error:'النص المدخل أطول من الحد المسموح'},400)}if(b.start&&!validateDate(b.start))return json({error:'تاريخ تفعيل العيادة غير صحيح'},400);if(!Array.isArray(b.services)||b.services.length>30)return json({error:'يمكن إدخال 30 خدمة كحد أقصى'},400);const services=[];for(const s of b.services){if(!s||typeof s!=='object'||Array.isArray(s))return json({error:'بيانات الخدمة غير صحيحة'},400);const clean={};for(const [k,max]of [['name',160],['scope',600],['scheduleNote',600]]){if(s[k]!=null&&typeof s[k]!=='string')return json({error:'بيانات الخدمة غير صحيحة'},400);clean[k]=String(s[k]||'').trim();if(clean[k].length>max)return json({error:'تفاصيل الخدمة أطول من الحد المسموح'},400)}if(!clean.name)return json({error:'أدخل اسم كل خدمة أو احذف صف الخدمة الفارغ'},400);if(!Array.isArray(s.days)||s.days.some(day=>!Number.isInteger(day)||day<0||day>6))return json({error:'أيام الخدمة غير صحيحة'},400);clean.days=[...new Set(s.days)].sort();for(const k of ['from','to']){clean[k]=s[k]||'';if(typeof clean[k]!=='string'||(clean[k]&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(clean[k])))return json({error:'وقت الخدمة غير صحيح'},400)}if(!!clean.from!==!!clean.to||(clean.from&&clean.to<=clean.from))return json({error:'أدخل وقت بداية ونهاية صحيحين؛ نهاية الخدمة بعد بدايتها'},400);const allowedGroups=new Set(PHC_GROUPS.map(g=>g.key));if(s.statisticsConfigured===true&&(!Array.isArray(s.statisticsGroups)||s.statisticsGroups.some(k=>!allowedGroups.has(k))))return json({error:'مجموعات إحصاءات الخدمة غير صحيحة'},400);clean.statisticsConfigured=s.statisticsConfigured===true;clean.statisticsGroups=clean.statisticsConfigured?[...new Set(s.statisticsGroups)]:[];services.push(clean)}const old=b.id?await d.query('SELECT id,status FROM phc_clinics WHERE id=?',b.id).first():null;if(b.id&&!old)return json({error:'العيادة غير موجودة'},404);const status=b.status==null?(old?.status||'active'):b.status;if(!['active','closed'].includes(status))return json({error:'اختر حالة العيادة'},400);const duplicate=await d.query('SELECT id FROM phc_clinics WHERE name=? AND region=? AND id!=?',name,region,b.id||'').first();if(duplicate)return json({error:'توجد عيادة بهذا الاسم في المحافظة المختارة'},409);const id=old?.id||'phc-'+crypto.randomUUID(),stamp=new Date().toISOString();if(old)await d.query('UPDATE phc_clinics SET name=?,region=?,code=?,start=?,address=?,services_json=?,status=?,updated_at=? WHERE id=?',name,region,fields.code,b.start||null,fields.address,JSON.stringify(services),status,stamp,id).run();else await d.query('INSERT INTO phc_clinics (id,name,region,code,start,address,services_json,status,updated_at) VALUES (?,?,?,?,?,?,?,?,?)',id,name,region,fields.code,b.start||null,fields.address,JSON.stringify(services),status,stamp).run();return json({saved:true,id})}

async function fetchHandler(request,env){const url=new URL(request.url);if(!url.pathname.startsWith('/api/')){const a=assets[url.pathname]||(!url.pathname.includes('.')?assets['/index.html']:null);const body=a?.base64?Uint8Array.from(atob(a.body),c=>c.charCodeAt(0)):a?.body;return a?new Response(body,{headers:{'Content-Type':a.type,'Cache-Control':'no-cache'}}):new Response('Not found',{status:404})}const d=db(env);if(request.method==='POST'||request.method==='PUT'){const origin=request.headers.get('Origin');if((origin&&origin!==url.origin)||request.headers.get('X-PRCS-Action')!=='1')return json({error:'طلب غير مصرح'},403)}
if(url.pathname==='/api/import-source'&&request.method==='POST')return json(await importStep(env));
if(url.pathname==='/api/phc-import'&&request.method==='POST')return json(await importPHCStep(env));
if(url.pathname==='/api/phc-status')return json({progress:await d.query('SELECT * FROM import_progress WHERE id=?','phc-import-2026-10-05-v1').first()});
if(url.pathname==='/api/status')return json({progress:await d.query('SELECT * FROM import_progress WHERE id=?',seed.version).first()});
const ready=await d.query('SELECT done FROM import_progress WHERE id=?',seed.version).first();if(!ready?.done)return json({error:'استيراد البيانات لم يكتمل بعد'},503);
if(url.pathname==='/api/health-summary'&&request.method==='GET'){const [hospital,phc,ems,phcReady]=await Promise.all([d.query("SELECT COALESCE(SUM(json_extract(values_json,'$.B')),0) total,COUNT(DISTINCT hospital_id) facilities FROM hospital_records").first(),d.query("SELECT COALESCE(SUM(total),0) total FROM phc_records WHERE deleted=0 AND kind IN ('monthly','historical')").first(),d.query("SELECT COALESCE(SUM(json_extract(values_json,'$.total')),0) total,COUNT(DISTINCT region) regions FROM ems_records WHERE deleted=0 AND kind='monthly'").first(),d.query('SELECT done FROM import_progress WHERE id=?','phc-import-2026-10-05-v1').first()]);const clinics=await d.query('SELECT COUNT(*) count FROM phc_clinics').first();return json({hospital,phc:phcReady?.done?{...phc,facilities:clinics.count}:null,ems})}
if(url.pathname==='/api/phc-settings'&&(request.method==='GET'||request.method==='POST'))return phcSettingsHandler(request,d);
if(url.pathname==='/api/phc-report'||url.pathname==='/api/phc-records'||url.pathname==='/api/phc-clinics'){const p=await d.query('SELECT done FROM import_progress WHERE id=?','phc-import-2026-10-05-v1').first();if(!p?.done)return json({error:'استيراد الرعاية الأولية لم يكتمل بعد'},503);if(url.pathname==='/api/phc-clinics'&&request.method==='POST')return clinicMutation(request,d);if(url.pathname==='/api/phc-records'&&request.method==='POST')return phcMutation(request,d);if(request.method==='GET')return json({clinics:(await d.query('SELECT * FROM phc_clinics ORDER BY region,name').all()).results.map(clinicView),records:(await d.query('SELECT * FROM phc_records WHERE deleted=0 ORDER BY date DESC,clinic_id').all()).results.map(r=>({...r,details:r.details_json?JSON.parse(r.details_json):null,details_json:undefined})),source:seed.phc.source.name,cumulative:seed.phc.cumulative,issues:seed.phc.issues,lastDaily:seed.phc.lastDaily})}
if(url.pathname==='/api/ems-records'&&request.method==='POST')return emsMutation(request,d);
if(url.pathname==='/api/ems-report'&&request.method==='GET'){const rows=(await d.query('SELECT * FROM ems_records WHERE deleted=0 ORDER BY date DESC,region').all()).results.map(r=>({...r,values:JSON.parse(r.values_json),values_json:undefined}));return json({records:rows,metrics:seed.ems.metrics,regions:seed.ems.regions,snapshots:seed.ems.snapshots,issues:seed.ems.issues,source:seed.ems.source.name})}
if(url.pathname==='/api/config')return json({hospitals:(await d.query('SELECT * FROM hospitals ORDER BY name').all()).results,metrics:(await d.query('SELECT * FROM metrics').all()).results,sources:(await d.query('SELECT id,name FROM import_sources').all()).results});
if(url.pathname==='/api/records'&&request.method==='GET'){let where=[],params=[];for(const [field,col] of [['hospital','hospital_id'],['from','date'],['to','date']])if(url.searchParams.get(field)){where.push(col+(field==='from'?'>=':field==='to'?'<=':'=')+'?');params.push(url.searchParams.get(field))}const result=await d.query('SELECT * FROM hospital_records'+(where.length?' WHERE '+where.join(' AND '):'')+' ORDER BY date DESC,hospital_id',...params).all();return json(result.results.map(r=>({...r,values:JSON.parse(r.values_json),values_json:undefined})))}
if(url.pathname==='/api/issues')return json((await d.query("SELECT * FROM import_issues WHERE hospital_id != 'ems' ORDER BY date DESC").all()).results);
if(url.pathname==='/api/snapshots')return json((await d.query("SELECT * FROM source_snapshots WHERE hospital_id != 'ems'").all()).results.map(r=>({...r,values:JSON.parse(r.values_json),values_json:undefined})));
if(url.pathname==='/api/records'&&request.method==='POST'){const b=await request.json();if(!(await d.query('SELECT id FROM hospitals WHERE id=?',b.hospital).first())||!validateDate(b.date)||b.date>new Date().toISOString().slice(0,10))return json({error:'اختر مستشفى وتاريخًا صحيحًا غير مستقبلي'},400);if(!b.values||typeof b.values!=='object'||Array.isArray(b.values))return json({error:'بيانات غير صحيحة'},400);const v={};for(const m of seed.metrics){if(m.derived)continue;const val=b.values[m.key];if(val==null||val===''){v[m.key]=null;continue}if(typeof val!=='number'||!Number.isSafeInteger(val)||val<0)return json({error:'القيم يجب أن تكون أعدادًا صحيحة غير سالبة'},400);v[m.key]=val}if(!Object.values(v).some(x=>x!=null))return json({error:'أدخل قيمة واحدة على الأقل'},400);totals(v);const overlaps=await d.query('SELECT id FROM hospital_records WHERE hospital_id=? AND kind=? AND date<=? AND period_end>=?',b.hospital,'monthly',b.date,b.date).first();if(overlaps)return json({error:'يوجد ملخص شهري يغطي هذا التاريخ؛ يلزم تفصيل الشهر قبل إضافة سجل يومي'},409);const id=b.hospital+':'+b.date;const old=await d.query('SELECT id FROM hospital_records WHERE hospital_id=? AND date=? AND kind=?',b.hospital,b.date,'daily').first();if(old&&!b.update)return json({error:'يوجد سجل لهذا المستشفى والتاريخ. افتح السجل لتعديله.'},409);const t=new Date().toISOString();if(old)await d.query('UPDATE hospital_records SET values_json=?,notes=?,needs_review=0,updated_at=? WHERE id=?',JSON.stringify(v),String(b.notes||'').slice(0,3000),t,old.id).run();else await d.query('INSERT INTO hospital_records (id,hospital_id,date,period_end,kind,values_json,needs_review,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,0,?,?,?)',id,b.hospital,b.date,b.date,'daily',JSON.stringify(v),String(b.notes||'').slice(0,3000),t,t).run();return json({id:old?.id||id,saved:true})}
return json({error:'المسار غير موجود'},404)}
export default {async fetch(request,env,ctx){try{return await fetchHandler(request,env)}catch(e){console.error('PRCS database error',e.message);return json({error:'تعذر الاتصال بقاعدة البيانات. أعد المحاولة؛ بيانات النموذج لم تُحذف.'},500)}}};

