import {randomUUID} from 'node:crypto';

const norm=value=>String(value??'').normalize('NFKC').replace(/[\u064B-\u065F\u0670\u0640]/g,'').replace(/[أإآ]/g,'ا').replace(/ى/g,'ي').replace(/\s+/g,' ').trim().toLowerCase();
const validName=value=>typeof value==='string'&&value.trim().length>0&&value.trim().length<=160;
const regions=['شمال غزة','غزة','الوسطى','خانيونس','رفح'];

export function hospitalSettingsService(sql,out){
  sql.exec(`
    CREATE TABLE IF NOT EXISTS hospital_service_types(
      id TEXT PRIMARY KEY,name TEXT NOT NULL,norm TEXT NOT NULL UNIQUE
    );
    CREATE TABLE IF NOT EXISTS hospital_service_type_links(
      hospital_id TEXT NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
      service_type_id TEXT NOT NULL REFERENCES hospital_service_types(id) ON DELETE CASCADE,
      PRIMARY KEY(hospital_id,service_type_id)
    );
    CREATE TABLE IF NOT EXISTS hospital_department_catalog(
      id TEXT PRIMARY KEY,name TEXT NOT NULL,norm TEXT NOT NULL UNIQUE,description TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS hospital_department_links(
      hospital_id TEXT NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
      service_type_id TEXT NOT NULL REFERENCES hospital_service_types(id),
      department_id TEXT NOT NULL REFERENCES hospital_department_catalog(id),
      sort_order INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(hospital_id,service_type_id,department_id),
      FOREIGN KEY(hospital_id,service_type_id) REFERENCES hospital_service_type_links(hospital_id,service_type_id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS hospital_branch_catalog(
      id TEXT PRIMARY KEY,department_id TEXT NOT NULL REFERENCES hospital_department_catalog(id) ON DELETE CASCADE,
      name TEXT NOT NULL,norm TEXT NOT NULL,UNIQUE(department_id,norm)
    );
  `);
  sql.exec('PRAGMA foreign_keys=ON');
  // Keep normalized hospital names available for duplicate checks across application restarts.
  if(!sql.prepare('PRAGMA table_info(hospitals)').all().some(c=>c.name==='norm_name'))sql.exec('ALTER TABLE hospitals ADD COLUMN norm_name TEXT');
  for(const h of sql.prepare('SELECT id,name FROM hospitals WHERE norm_name IS NULL').all())sql.prepare('UPDATE hospitals SET norm_name=? WHERE id=?').run(norm(h.name),h.id);
  // The two service types are a shared starter vocabulary and are linked once to all current hospitals.
  for(const name of ['الخدمات المباشرة','الخدمات المساندة']){
    let row=sql.prepare('SELECT id FROM hospital_service_types WHERE norm=?').get(norm(name));
    if(!row){row={id:'service-type-'+randomUUID()};sql.prepare('INSERT INTO hospital_service_types(id,name,norm) VALUES(?,?,?)').run(row.id,name,norm(name))}
    sql.prepare('INSERT OR IGNORE INTO hospital_service_type_links(hospital_id,service_type_id) SELECT id,? FROM hospitals').run(row.id);
  }

  const getHospital=id=>sql.prepare('SELECT * FROM hospitals WHERE id=?').get(id);
  const getService=id=>sql.prepare('SELECT * FROM hospital_service_types WHERE id=?').get(id);
  const getDepartment=id=>sql.prepare('SELECT * FROM hospital_department_catalog WHERE id=?').get(id);
  const getBranch=id=>sql.prepare('SELECT * FROM hospital_branch_catalog WHERE id=?').get(id);
  const linked=(hospitalId,typeId)=>!!sql.prepare('SELECT 1 FROM hospital_service_type_links WHERE hospital_id=? AND service_type_id=?').get(hospitalId,typeId);
  const assigned=(hospitalId,typeId,departmentId)=>!!sql.prepare('SELECT 1 FROM hospital_department_links WHERE hospital_id=? AND service_type_id=? AND department_id=?').get(hospitalId,typeId,departmentId);
  const transact=fn=>{sql.exec('SAVEPOINT hospital_settings_write');try{const result=fn();sql.exec('RELEASE hospital_settings_write');return result}catch(error){sql.exec('ROLLBACK TO hospital_settings_write; RELEASE hospital_settings_write');throw error}};
  const conflict=message=>Object.assign(new Error(message),{status:409});
  const bad=message=>Object.assign(new Error(message),{status:400});
  const catalogSave=(table,id,name,extra={})=>{
    if(!validName(name))throw bad('أدخل اسمًا صالحًا (حتى 160 حرفًا)');
    const existing=sql.prepare(`SELECT id FROM ${table} WHERE norm=? AND id<>?`).get(norm(name),id||'');
    if(existing)throw conflict('هذا الاسم موجود مسبقًا؛ اختره من القائمة بدل إضافته مرة أخرى');
    const stableId=id||'definition-'+randomUUID();
      const description=String(extra.description||'');if(description.length>1000)throw bad('الوصف أطول من المسموح');
    if(id){if(table==='hospital_department_catalog')sql.prepare('UPDATE hospital_department_catalog SET name=?,norm=?,description=? WHERE id=?').run(name.trim(),norm(name),description,id);else sql.prepare('UPDATE hospital_service_types SET name=?,norm=? WHERE id=?').run(name.trim(),norm(name),id)}
    else if(table==='hospital_department_catalog')sql.prepare('INSERT INTO hospital_department_catalog(id,name,norm,description) VALUES(?,?,?,?)').run(stableId,name.trim(),norm(name),description);
    else sql.prepare('INSERT INTO hospital_service_types(id,name,norm) VALUES(?,?,?)').run(stableId,name.trim(),norm(name));
    return {id:stableId,name:name.trim(),description};
  };
  const ensureHospital=(name,region,address,status,start,id)=>{
    if(!validName(name)||!regions.includes(region)||typeof address!=='string'||address.length>600||typeof status!=='string'||!status.trim()||status.length>100||!(start===''||/^\d{4}-\d{2}-\d{2}$/.test(start)))throw bad('تحقق من الاسم والمحافظة والعنوان والحالة والتاريخ');
    const hospitalId=id||'hospital-'+randomUUID();
    const dupe=sql.prepare('SELECT id FROM hospitals WHERE id<>? AND norm_name=?').get(hospitalId,norm(name));
    if(dupe)throw conflict('اسم المستشفى موجود مسبقًا');
    if(id){if(!getHospital(id))throw bad('المستشفى غير موجود');sql.prepare('UPDATE hospitals SET name=?,norm_name=?,region=?,location=?,status=?,start=? WHERE id=?').run(name.trim(),norm(name),region,address.trim(),status.trim(),start||null,id)}
    else {sql.prepare('INSERT INTO hospitals(id,name,norm_name,region,location,status,start) VALUES(?,?,?,?,?,?,?)').run(hospitalId,name.trim(),norm(name),region,address.trim(),status.trim(),start||null);sql.prepare('INSERT OR IGNORE INTO hospital_service_type_links(hospital_id,service_type_id) SELECT ?,id FROM hospital_service_types').run(hospitalId)}
    return {id:hospitalId};
  };
  async function handle(req,user){
    if(user?.role!=='admin')return out({error:'إعدادات المستشفيات لمدير النظام فقط'},403);
    if(req.method==='GET'){
      return out({
        hospitals:sql.prepare('SELECT id,name,region,location,status,start FROM hospitals ORDER BY name').all(),
        serviceTypes:sql.prepare(`SELECT t.*,group_concat(l.hospital_id) AS hospital_ids FROM hospital_service_types t LEFT JOIN hospital_service_type_links l ON l.service_type_id=t.id GROUP BY t.id ORDER BY t.name`).all().map(x=>({...x,hospitalIds:x.hospital_ids?x.hospital_ids.split(','):[]})),
        departments:sql.prepare(`SELECT d.*,group_concat(l.hospital_id) AS hospital_ids FROM hospital_department_catalog d LEFT JOIN hospital_department_links l ON l.department_id=d.id GROUP BY d.id ORDER BY d.name`).all().map(x=>({...x,hospitalIds:x.hospital_ids?x.hospital_ids.split(','):[]})),
        departmentLinks:sql.prepare(`SELECT * FROM hospital_department_links ORDER BY sort_order,department_id`).all(),
        branches:sql.prepare(`SELECT b.* FROM hospital_branch_catalog b ORDER BY b.department_id,b.name`).all()
      });
    }
    if(req.method!=='POST')return out({error:'طلب غير مدعوم'},405);
    let b;try{b=await req.json()}catch{return out({error:'بيانات غير صالحة'},400)}
    try{return out(transact(()=>{
      if(b.action==='hospital.save')return ensureHospital(b.name,b.region,b.address||'',b.status||'فعال',b.start||'',b.id||null);
      if(b.action==='hospital.delete'){
        const h=getHospital(b.id);if(!h)throw bad('المستشفى غير موجود');
        const protectedTables=['hospital_records','source_rows','source_snapshots','import_issues'];
        if(protectedTables.some(t=>sql.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t)&&sql.prepare('SELECT 1 FROM '+t+' WHERE hospital_id=? LIMIT 1').get(h.id)))throw conflict('لا يمكن حذف مستشفى لديه إحصائيات مسجلة');
        sql.prepare('DELETE FROM hospitals WHERE id=?').run(h.id);return {saved:true};
      }
      if(b.action==='service.save'){
        const row=catalogSave('hospital_service_types',b.id||null,b.name);const desired=[...new Set(Array.isArray(b.hospitalIds)?b.hospitalIds:[])];
        if(desired.some(id=>!getHospital(id)))throw bad('يوجد مستشفى غير صالح في الاختيارات');
        const current=sql.prepare('SELECT hospital_id FROM hospital_service_type_links WHERE service_type_id=?').all(row.id).map(x=>x.hospital_id);
        for(const hid of current)if(!desired.includes(hid)&&sql.prepare('SELECT 1 FROM hospital_department_links WHERE hospital_id=? AND service_type_id=? LIMIT 1').get(hid,row.id))throw conflict('أزل الأقسام التابعة لهذا النوع من المستشفى أولًا');
        sql.prepare('DELETE FROM hospital_service_type_links WHERE service_type_id=?').run(row.id);for(const hid of desired)sql.prepare('INSERT INTO hospital_service_type_links VALUES(?,?)').run(hid,row.id);return {saved:true,id:row.id};
      }
      if(b.action==='service.delete'){
        if(!getService(b.id))throw bad('نوع الخدمة غير موجود');if(sql.prepare('SELECT 1 FROM hospital_department_links WHERE service_type_id=? LIMIT 1').get(b.id))throw conflict('احذف ارتباط الأقسام التابعة أولًا');sql.prepare('DELETE FROM hospital_service_type_links WHERE service_type_id=?').run(b.id);sql.prepare('DELETE FROM hospital_service_types WHERE id=?').run(b.id);return {saved:true};
      }
      if(b.action==='department.save'){
        const row=catalogSave('hospital_department_catalog',b.id||null,b.name,{description:b.description||''});const hospitalId=b.hospitalId,typeId=b.serviceTypeId;if(!getHospital(hospitalId)||!getService(typeId)||!linked(hospitalId,typeId))throw bad('اختر نوع خدمة مرتبطًا بالمستشفى');
        const sort=Number(b.sortOrder||0);if(!Number.isInteger(sort)||sort<0)throw bad('ترتيب العرض غير صالح');
        if(b.attach!==false){if(!assigned(hospitalId,typeId,row.id))sql.prepare('INSERT INTO hospital_department_links(hospital_id,service_type_id,department_id,sort_order) VALUES(?,?,?,?)').run(hospitalId,typeId,row.id,sort);else sql.prepare('UPDATE hospital_department_links SET sort_order=? WHERE hospital_id=? AND service_type_id=? AND department_id=?').run(sort,hospitalId,typeId,row.id)}
        return {saved:true,id:row.id};
      }
      if(b.action==='department.unlink'){
        if(sql.prepare('SELECT 1 FROM hospital_branch_catalog WHERE department_id=? LIMIT 1').get(b.departmentId))throw conflict('احذف فروع القسم أولًا');sql.prepare('DELETE FROM hospital_department_links WHERE hospital_id=? AND service_type_id=? AND department_id=?').run(b.hospitalId,b.serviceTypeId,b.departmentId);return {saved:true};
      }
      if(b.action==='department.delete'){
        if(!getDepartment(b.id))throw bad('القسم الرئيسي غير موجود');if(sql.prepare('SELECT 1 FROM hospital_department_links WHERE department_id=? LIMIT 1').get(b.id))throw conflict('أزل ارتباط القسم من المستشفيات أولًا');if(sql.prepare('SELECT 1 FROM hospital_branch_catalog WHERE department_id=? LIMIT 1').get(b.id))throw conflict('احذف فروع القسم أولًا');sql.prepare('DELETE FROM hospital_department_catalog WHERE id=?').run(b.id);return {saved:true};
      }
      if(b.action==='branch.save'){
        if(!getDepartment(b.departmentId))throw bad('القسم الرئيسي غير موجود');if(!validName(b.name))throw bad('أدخل اسم فرع صالحًا');const id=b.id||'branch-'+randomUUID();const dupe=sql.prepare('SELECT id FROM hospital_branch_catalog WHERE department_id=? AND norm=? AND id<>?').get(b.departmentId,norm(b.name),id);if(dupe)throw conflict('الفرع موجود تحت هذا القسم');if(b.id&&!getBranch(b.id))throw bad('الفرع غير موجود');if(b.id)sql.prepare('UPDATE hospital_branch_catalog SET name=?,norm=? WHERE id=?').run(b.name.trim(),norm(b.name),id);else sql.prepare('INSERT INTO hospital_branch_catalog VALUES(?,?,?,?)').run(id,b.departmentId,b.name.trim(),norm(b.name));return {saved:true,id};
      }
      if(b.action==='branch.delete'){if(!getBranch(b.id))throw bad('الفرع غير موجود');sql.prepare('DELETE FROM hospital_branch_catalog WHERE id=?').run(b.id);return {saved:true}}
      throw bad('الإجراء غير معروف');
    }))}catch(e){return out({error:e.message||'تعذر حفظ البيانات'},e.status||400)}
  }
  return handle;
}
