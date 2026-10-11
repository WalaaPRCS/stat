import {randomUUID} from 'node:crypto';
export const reliefRegions=['شمال غزة','غزة','الوسطى','خانيونس','رفح'];
export const reliefCatalog=[['فرشة','قطعة','إغاثية'],['بطانية','قطعة','إغاثية'],['أدوات مطبخ','طقم','إغاثية'],['جرة غاز','جرة','إغاثية'],['سجادة / حصيرة','قطعة','إغاثية'],['مخدة','قطعة','إغاثية'],['طرد ملابس','طرد','إغاثية'],['أحذية','زوج','إغاثية'],['كيس نوم','قطعة','إغاثية'],['خيمة','خيمة','إغاثية'],['شوادر','قطعة','إغاثية'],['رغيف خبز','رغيف','غذائية'],['طرد غذائي','طرد','غذائية'],['وجبات طعام','وجبة','غذائية'],['بسكويت أطفال','عبوة','غذائية'],['حليب أطفال','علبة','غذائية'],['معكرونة','كرتونة','غذائية'],['سكر','باكو','غذائية'],['أرز','باكو','غذائية'],['سيريلاك','عبوة','غذائية'],['تونة','كرتونة','غذائية'],['طحين 25 كجم','كيس','غذائية'],['بقوليات','كجم','غذائية'],['تمر','كرتونة','غذائية'],['عصير كبير','عبوة','غذائية'],['عصير صغير','عبوة','غذائية'],['شوكو صغير','عبوة','غذائية'],['رضاعة أطفال','قطعة','غذائية'],['لحوم أضاحي','كجم','غذائية'],['كعك العيد','عبوة','غذائية'],['مياه','كرتونة','مياه وإصحاح'],['مستلزمات نظافة شخصية','طقم','مياه وإصحاح'],['أدوات كرامة نسائي / حديثي الولادة','طقم','مياه وإصحاح'],['Hy Gel','عبوة','مياه وإصحاح'],['حفاضات صغار','عبوة','مياه وإصحاح'],['جالون مياه','قطعة','مياه وإصحاح'],['دلو مياه','قطعة','مياه وإصحاح'],['فلتر مياه','قطعة','مياه وإصحاح']].map(([name,unit,category],i)=>({id:'aid-'+i,name,unit,category}));
export function reliefService(sql,out){
sql.exec('CREATE TABLE IF NOT EXISTS relief_operations(id TEXT PRIMARY KEY,date TEXT NOT NULL,payload TEXT NOT NULL,updated_by TEXT NOT NULL,updated_at TEXT NOT NULL); CREATE INDEX IF NOT EXISTS relief_date ON relief_operations(date)');
sql.exec('CREATE TABLE IF NOT EXISTS disaster_constants(id TEXT PRIMARY KEY,type TEXT NOT NULL,name TEXT NOT NULL,norm TEXT NOT NULL,payload TEXT NOT NULL DEFAULT "{}",UNIQUE(type,norm))');
const normalize=v=>v.normalize('NFKC').replace(/[\u064B-\u065F\u0670\u0640]/g,'').replace(/[أإآ]/g,'ا').replace(/ى/g,'ي').replace(/\s+/g,' ').trim().toLowerCase();
const rows=type=>sql.prepare('SELECT * FROM disaster_constants WHERE type=? ORDER BY name').all(type).map(r=>({id:r.id,name:r.name,...JSON.parse(r.payload)}));
const add=(type,name,payload={},id=randomUUID())=>{sql.prepare('INSERT OR IGNORE INTO disaster_constants VALUES(?,?,?,?,?)').run(id,type,name,normalize(name),JSON.stringify(payload));return sql.prepare('SELECT id FROM disaster_constants WHERE type=? AND norm=?').get(type,normalize(name)).id};
sql.exec('CREATE TABLE IF NOT EXISTS disaster_constants_meta(key TEXT PRIMARY KEY)');
if(!sql.prepare("SELECT key FROM disaster_constants_meta WHERE key='seeded'").get()){
for(const n of ['إغاثية','غذائية','مياه وإصحاح'])add('category',n);
for(const n of [...new Set(reliefCatalog.map(c=>c.unit))])add('unit',n,{fractional:n==='كجم'});
for(const n of ['مجتمع محلي','مقر الجمعية','مركز إيواء الجمعية','مركز إيواء عام','تجمع نزوح'])add('siteType',n);
if(!sql.prepare("SELECT id FROM disaster_constants WHERE type='item' LIMIT 1").get())for(const c of reliefCatalog)add('item',c.name,{unitId:add('unit',c.unit,{fractional:c.unit==='كجم'}),categoryId:add('category',c.category)},c.id);
sql.prepare("INSERT INTO disaster_constants_meta VALUES('seeded')").run();}
// Convert existing text values once while preserving operation identities and numbers.
for(const r of sql.prepare('SELECT id,payload FROM relief_operations').all()){const b=JSON.parse(r.payload);if(b.siteId)continue;b.siteTypeId=add('siteType',b.siteType);b.siteId=add('site',b.site,{region:b.region,siteTypeId:b.siteTypeId});b.projectId=b.project?add('project',b.project):'';b.partnerId=b.partner?add('partner',b.partner):'';sql.prepare('UPDATE relief_operations SET payload=? WHERE id=?').run(JSON.stringify(b),r.id)}
const settings=()=>Object.fromEntries(['project','partner','unit','category','siteType','site','item'].map(t=>[t,rows(t)]));
const catalog=()=>rows('item').map(c=>({...c,unit:rows('unit').find(u=>u.id===c.unitId)?.name,category:rows('category').find(u=>u.id===c.categoryId)?.name,fractional:!!rows('unit').find(u=>u.id===c.unitId)?.fractional}));
const hydrate=b=>{const all=settings();return {...b,site:all.site.find(x=>x.id===b.siteId)?.name||b.site,project:all.project.find(x=>x.id===b.projectId)?.name||b.project,partner:all.partner.find(x=>x.id===b.partnerId)?.name||b.partner,siteType:all.siteType.find(x=>x.id===b.siteTypeId)?.name||b.siteType}};
return async(req,u)=>{
if(new URL(req.url).pathname==='/api/disaster-settings'){
if(u?.role!=='admin')return out({error:'إعدادات القسم لمدير النظام فقط'},403);
if(req.method==='GET')return out(settings());
if(req.method!=='POST')return out({error:'طلب غير مدعوم'},405);
let b;try{b=await req.json()}catch{return out({error:'بيانات غير صالحة'},400)}
const types=['project','partner','unit','category','siteType','site','item'];if(!types.includes(b.type))return out({error:'نوع ثابت غير صالح'},400);
const old=b.id?sql.prepare('SELECT * FROM disaster_constants WHERE id=? AND type=?').get(b.id,b.type):null;if(b.id&&!old)return out({error:'الثابت غير موجود'},404);
const used=id=>sql.prepare('SELECT payload FROM relief_operations').all().some(r=>{const p=JSON.parse(r.payload);return [p.siteId,p.siteTypeId,p.projectId,p.partnerId].includes(id)||p.items.some(x=>x.itemId===id)})||sql.prepare('SELECT id,payload FROM disaster_constants WHERE id<>?').all(id).some(r=>Object.values(JSON.parse(r.payload)).includes(id));
if(b.action==='delete'){if(!old)return out({error:'اختر الثابت'},400);if(used(b.id))return out({error:'لا يمكن حذف ثابت مرتبط بعملية أو تعريف آخر'},409);sql.prepare('DELETE FROM disaster_constants WHERE id=?').run(b.id);return out({saved:true})}
if(typeof b.name!=='string'||!normalize(b.name)||b.name.length>200)return out({error:'أدخل اسمًا صالحًا'},400);const data={};
if(b.type==='item'){if(!rows('unit').some(x=>x.id===b.unitId)||!rows('category').some(x=>x.id===b.categoryId))return out({error:'اختر الوحدة والفئة'},400);Object.assign(data,{unitId:b.unitId,categoryId:b.categoryId});if(old&&used(old.id)&&JSON.parse(old.payload).unitId!==b.unitId)return out({error:'لا يمكن تغيير وحدة صنف مستخدم؛ أضف صنفًا جديدًا بوحدته'},409)}
if(b.type==='unit'){data.fractional=b.fractional===true;if(old&&used(old.id)&&JSON.parse(old.payload).fractional!==data.fractional)return out({error:'لا يمكن تغيير دقة وحدة مستخدمة'},409)}
if(b.type==='site'){if(!reliefRegions.includes(b.region)||!rows('siteType').some(x=>x.id===b.siteTypeId))return out({error:'اختر محافظة ونوع موقع'},400);Object.assign(data,{region:b.region,siteTypeId:b.siteTypeId})}
try{if(old)sql.prepare('UPDATE disaster_constants SET name=?,norm=?,payload=? WHERE id=?').run(b.name.trim(),normalize(b.name),JSON.stringify(data),old.id);else sql.prepare('INSERT INTO disaster_constants VALUES(?,?,?,?,?)').run(randomUUID(),b.type,b.name.trim(),normalize(b.name),JSON.stringify(data));return out({saved:true})}catch{return out({error:'الاسم موجود مسبقًا في القائمة'},409)}
}
const currentCatalog=catalog();
if(req.method==='GET')return out({catalog:currentCatalog,constants:settings(),regions:reliefRegions,records:sql.prepare('SELECT id,date,payload FROM relief_operations ORDER BY date DESC,updated_at DESC').all().map(r=>({id:r.id,...hydrate(JSON.parse(r.payload))}))});
if(req.method!=='POST')return out({error:'طلب غير مدعوم'},405);
if(!(u?.role==='admin'||u?.role==='entry'&&u.scope==='disaster'))return out({error:'ليست لديك صلاحية إدخال المساعدات الإغاثية'},403);
let b;try{b=await req.json()}catch{return out({error:'بيانات غير صالحة'},400)}
if(b.id&&!sql.prepare('SELECT id FROM relief_operations WHERE id=?').get(b.id))return out({error:'العملية غير موجودة'},404);
if(b.action==='delete'){if(!b.id)return out({error:'اختر العملية'},400);sql.prepare('DELETE FROM relief_operations WHERE id=?').run(b.id);return out({saved:true})}
const constants=settings(),site=constants.site.find(x=>x.id===b.siteId),project=constants.project.find(x=>x.id===b.projectId),partner=constants.partner.find(x=>x.id===b.partnerId);if(!site||(b.projectId&&!project)||(b.partnerId&&!partner))return out({error:'اختر الموقع والمشروع والشريك من القوائم المعتمدة'},400);b.region=site.region;b.site=site.name;b.siteType=constants.siteType.find(x=>x.id===site.siteTypeId)?.name;b.project=project?.name||'';b.partner=partner?.name||'';
const text=(v,max,required=false)=>typeof v==='string'&&v.length<=max&&(!required||v.trim().length>0),count=v=>v===null||Number.isSafeInteger(v)&&v>=0;
if(typeof b.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(b.date)||Number.isNaN(Date.parse(b.date))||new Date(b.date).toISOString().slice(0,10)!==b.date||b.date>new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Hebron'})||!reliefRegions.includes(b.region)||!text(b.site,200,true)||!constants.siteType.some(x=>x.name===b.siteType)||!text(b.project,200)||!text(b.partner,200)||!text(b.reference,100)||!text(b.notes,3000)||!count(b.families)||!count(b.people))return out({error:'تحقق من التاريخ والموقع وأعداد المستفيدين'},400);
if(!Array.isArray(b.items)||!b.items.length||b.items.length>100||new Set(b.items.map(x=>x?.itemId)).size!==b.items.length||b.items.some(x=>!currentCatalog.some(c=>c.id===x?.itemId)||!Number.isFinite(x.quantity)||x.quantity<=0||x.quantity>1e9||(!currentCatalog.find(c=>c.id===x.itemId).fractional&&!Number.isSafeInteger(x.quantity))))return out({error:'أضف أصنافًا بكميات موجبة دون تكرار؛ الكسور متاحة للوحدات المعرّفة كعشرية فقط'},400);
const id=b.id||randomUUID(),payload={siteId:b.siteId,siteTypeId:site.siteTypeId,projectId:b.projectId||'',partnerId:b.partnerId||'',date:b.date,region:b.region,site:b.site.trim(),siteType:b.siteType,project:b.project.trim(),partner:b.partner.trim(),reference:b.reference.trim(),families:b.families,people:b.people,items:b.items.map(x=>({itemId:x.itemId,quantity:x.quantity})),notes:b.notes.trim()};
if(!b.id&&sql.prepare('SELECT id FROM relief_operations WHERE date=? AND payload=?').get(b.date,JSON.stringify(payload)))return out({error:'عملية مطابقة مسجلة مسبقًا'},409);
sql.prepare('INSERT INTO relief_operations VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET date=excluded.date,payload=excluded.payload,updated_by=excluded.updated_by,updated_at=excluded.updated_at').run(id,b.date,JSON.stringify(payload),u.id,new Date().toISOString());return out({saved:true,id});
};}
