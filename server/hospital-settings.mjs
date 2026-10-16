import {randomUUID} from 'node:crypto';

const norm=value=>String(value??'').normalize('NFKC').replace(/[\u064B-\u065F\u0670\u0640]/g,'').replace(/[أإآ]/g,'ا').replace(/ى/g,'ي').replace(/\s+/g,' ').trim().toLowerCase();
const validName=value=>typeof value==='string'&&value.trim().length>0&&value.trim().length<=160;
const regions=['شمال غزة','غزة','الوسطى','خانيونس','رفح'];
const inputModeForBranch=name=>{const value=norm(name);return (value.includes('اطفال')&&(value.includes('عياد')||value.includes('جراح')))?'gender':'age_gender'};

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
  if(!sql.prepare('PRAGMA table_info(hospital_department_links)').all().some(c=>c.name==='age_gender_breakdown')){sql.exec('ALTER TABLE hospital_department_links ADD COLUMN age_gender_breakdown INTEGER NOT NULL DEFAULT 0');sql.exec("UPDATE hospital_department_links SET age_gender_breakdown=1 WHERE department_id IN (SELECT id FROM hospital_department_catalog WHERE name LIKE '%العيادات الخارجية%')");}
  if(!sql.prepare('PRAGMA table_info(hospital_department_links)').all().some(c=>c.name==='input_mode'))sql.exec("ALTER TABLE hospital_department_links ADD COLUMN input_mode TEXT NOT NULL DEFAULT 'age_gender'");
  if(!sql.prepare('PRAGMA table_info(hospital_branch_catalog)').all().some(c=>c.name==='input_mode'))sql.exec("ALTER TABLE hospital_branch_catalog ADD COLUMN input_mode TEXT NOT NULL DEFAULT 'age_gender'");
  for(const branch of sql.prepare('SELECT id,name FROM hospital_branch_catalog').all())sql.prepare('UPDATE hospital_branch_catalog SET input_mode=? WHERE id=?').run(inputModeForBranch(branch.name),branch.id);
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
    if((req.method!=='GET'&&user?.role!=='admin')||(req.method==='GET'&&user?.role!=='admin'&&!(user?.role==='entry'&&user.scope==='hospital')))return out({error:'إعدادات المستشفيات متاحة لمدير النظام ومدخلي بيانات المستشفيات فقط'},403);
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
      if(b.action==='structure.import'){
        const hospitalId=b.hospitalId,groups=b.serviceTypes;
        if(!getHospital(hospitalId))throw bad('اختر مستشفى صالحًا للاستيراد');
        if(!Array.isArray(groups)||groups.length>20)throw bad('ملف الاستيراد غير صالح');
        let addedDepartments=0,linkedDepartments=0,skippedDepartments=0,addedBranches=0,skippedBranches=0,addedServiceTypes=0;
        let branchCount=0,departmentCount=0;
        for(const group of groups){
          if(!validName(group?.name)||!Array.isArray(group.departments))throw bad('تحقق من أسماء أنواع الخدمة والأقسام في الملف');
          let type=sql.prepare('SELECT * FROM hospital_service_types WHERE norm=?').get(norm(group.name));
          if(!type){const saved=catalogSave('hospital_service_types',null,group.name);type=getService(saved.id);addedServiceTypes++}
          sql.prepare('INSERT OR IGNORE INTO hospital_service_type_links(hospital_id,service_type_id) VALUES(?,?)').run(hospitalId,type.id);
          departmentCount+=group.departments.length;if(departmentCount>500)throw bad('يتجاوز الملف الحد الأقصى للأقسام');
          for(const item of group.departments){
            if(!validName(item?.name)||!Array.isArray(item.branches))throw bad('تحقق من أسماء الأقسام والفروع في الملف');
            let dep=sql.prepare('SELECT * FROM hospital_department_catalog WHERE norm=?').get(norm(item.name));
            if(!dep){const saved=catalogSave('hospital_department_catalog',null,item.name,{description:item.description||''});dep=getDepartment(saved.id);addedDepartments++}else skippedDepartments++;
            if(!assigned(hospitalId,type.id,dep.id)){sql.prepare('INSERT INTO hospital_department_links(hospital_id,service_type_id,department_id,sort_order) VALUES(?,?,?,?)').run(hospitalId,type.id,dep.id,Number(item.sortOrder)||0);linkedDepartments++}
            for(const branchName of item.branches){
              branchCount++;if(branchCount>5000)throw bad('يتجاوز الملف الحد الأقصى للفروع');
              if(!validName(branchName))throw bad('اسم فرع غير صالح في الملف');
              const branchNorm=norm(branchName),exists=sql.prepare('SELECT 1 FROM hospital_branch_catalog WHERE department_id=? AND norm=?').get(dep.id,branchNorm);
              if(exists){skippedBranches++;continue}
              sql.prepare('INSERT INTO hospital_branch_catalog(id,department_id,name,norm,input_mode) VALUES(?,?,?,?,?)').run('branch-'+randomUUID(),dep.id,branchName.trim(),branchNorm,inputModeForBranch(branchName));addedBranches++;
            }
          }
        }
        return {saved:true,addedServiceTypes,addedDepartments,linkedDepartments,skippedDepartments,addedBranches,skippedBranches};
      }
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
      if(b.action==='department.breakdown'){if(!assigned(b.hospitalId,b.serviceTypeId,b.departmentId))throw bad('القسم غير مرتبط بهذا المستشفى ونوع الخدمة');sql.prepare('UPDATE hospital_department_links SET age_gender_breakdown=? WHERE hospital_id=? AND service_type_id=? AND department_id=?').run(b.enabled?1:0,b.hospitalId,b.serviceTypeId,b.departmentId);return {saved:true}}
      if(b.action==='department.unlink'){
        if(sql.prepare('SELECT 1 FROM hospital_branch_catalog WHERE department_id=? LIMIT 1').get(b.departmentId))throw conflict('احذف فروع القسم أولًا');sql.prepare('DELETE FROM hospital_department_links WHERE hospital_id=? AND service_type_id=? AND department_id=?').run(b.hospitalId,b.serviceTypeId,b.departmentId);return {saved:true};
      }
      if(b.action==='department.delete'){
        if(!getDepartment(b.id))throw bad('القسم الرئيسي غير موجود');if(sql.prepare('SELECT 1 FROM hospital_department_links WHERE department_id=? LIMIT 1').get(b.id))throw conflict('أزل ارتباط القسم من المستشفيات أولًا');if(sql.prepare('SELECT 1 FROM hospital_branch_catalog WHERE department_id=? LIMIT 1').get(b.id))throw conflict('احذف فروع القسم أولًا');sql.prepare('DELETE FROM hospital_department_catalog WHERE id=?').run(b.id);return {saved:true};
      }
      if(b.action==='branch.save'){
        if(!getDepartment(b.departmentId))throw bad('القسم الرئيسي غير موجود');if(!validName(b.name))throw bad('أدخل اسم فرع صالحًا');const id=b.id||'branch-'+randomUUID();const dupe=sql.prepare('SELECT id FROM hospital_branch_catalog WHERE department_id=? AND norm=? AND id<>?').get(b.departmentId,norm(b.name),id);if(dupe)throw conflict('الفرع موجود تحت هذا القسم');if(b.id&&!getBranch(b.id))throw bad('الفرع غير موجود');if(b.id)sql.prepare('UPDATE hospital_branch_catalog SET name=?,norm=?,input_mode=? WHERE id=?').run(b.name.trim(),norm(b.name),inputModeForBranch(b.name),id);else sql.prepare('INSERT INTO hospital_branch_catalog(id,department_id,name,norm,input_mode) VALUES(?,?,?,?,?)').run(id,b.departmentId,b.name.trim(),norm(b.name),inputModeForBranch(b.name));return {saved:true,id};
      }
      if(b.action==='branch.delete'){if(!getBranch(b.id))throw bad('الفرع غير موجود');sql.prepare('DELETE FROM hospital_branch_catalog WHERE id=?').run(b.id);return {saved:true}}
      throw bad('الإجراء غير معروف');
    }))}catch(e){return out({error:e.message||'تعذر حفظ البيانات'},e.status||400)}
  }
  return handle;
}



export function hospitalActivityService(sql,out){
  sql.exec('CREATE TABLE IF NOT EXISTS hospital_activity_records(id TEXT PRIMARY KEY,hospital_id TEXT NOT NULL REFERENCES hospitals(id),service_type_id TEXT NOT NULL REFERENCES hospital_service_types(id),date TEXT NOT NULL,entries_json TEXT NOT NULL,notes TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL); CREATE UNIQUE INDEX IF NOT EXISTS hospital_activity_unique_date ON hospital_activity_records(hospital_id,service_type_id,date)');
  const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
  const fieldsFor=(hospitalId,typeId)=>{
    const departments=sql.prepare('SELECT d.id,d.name,d.description,l.age_gender_breakdown FROM hospital_department_links l JOIN hospital_department_catalog d ON d.id=l.department_id WHERE l.hospital_id=? AND l.service_type_id=? ORDER BY l.sort_order,d.name').all(hospitalId,typeId);
    return departments.map(department=>{
      const allBranches=sql.prepare('SELECT id,name,input_mode FROM hospital_branch_catalog WHERE department_id=? ORDER BY name').all(department.id);
      return {...department,fields:(allBranches.length?allBranches.map(branch=>({key:'b:'+branch.id,branchId:branch.id,label:branch.name,inputMode:branch.input_mode||inputModeForBranch(branch.name)})): [{key:'d:'+department.id,branchId:null,label:'عدد الحالات',inputMode:'age_gender'}])};
    });
  };
  const canWrite=(user,hospitalId)=>user?.role==='admin'||user?.role==='entry'&&user.scope==='hospital'&&user.facility===hospitalId;
  async function handle(req,user){
    if(req.method==='GET'){
      const url=new URL(req.url),hospital=url.searchParams.get('hospital'),from=url.searchParams.get('from'),to=url.searchParams.get('to');
      const where=[],params=[];
      if(hospital){where.push('r.hospital_id=?');params.push(hospital)}
      if(from){where.push('r.date>=?');params.push(from)}
      if(to){where.push('r.date<=?');params.push(to)}
      const rows=sql.prepare('SELECT r.*,h.name AS hospital_name,t.name AS service_type_name FROM hospital_activity_records r JOIN hospitals h ON h.id=r.hospital_id JOIN hospital_service_types t ON t.id=r.service_type_id'+(where.length?' WHERE '+where.join(' AND '):'')+' ORDER BY r.date DESC,h.name,t.name').all(...params);
      return out(rows.map(row=>({...row,entries:JSON.parse(row.entries_json),entries_json:undefined,notes:user?.role==='admin'||user?.role==='entry'&&user.scope==='hospital'&&user.facility===row.hospital_id?row.notes:undefined})));
    }
    if(req.method!=='POST')return out({error:'طلب غير مدعوم'},405);
    if(!user)return out({error:'سجل الدخول لإدخال البيانات'},401);
    let body;try{body=await req.json()}catch{return out({error:'بيانات غير صالحة'},400)}
    try{
      if(body.action==='delete'){
        const record=sql.prepare('SELECT * FROM hospital_activity_records WHERE id=?').get(body.id);
        if(!record)return out({error:'السجل غير موجود'},404);
        if(!canWrite(user,record.hospital_id)||body.hospital&&body.hospital!==record.hospital_id)return out({error:'السجل خارج المنشأة المخصصة لك'},403);
        sql.prepare('DELETE FROM hospital_activity_records WHERE id=?').run(record.id);
        return out({saved:true});
      }
      const hospital=sql.prepare('SELECT id FROM hospitals WHERE id=?').get(body.hospital);
      if(!hospital)return out({error:'اختر مستشفى صالحًا'},400);
      if(!canWrite(user,body.hospital))return out({error:'السجل خارج المنشأة المخصصة لك'},403);
      const service=sql.prepare('SELECT t.id FROM hospital_service_types t JOIN hospital_service_type_links l ON l.service_type_id=t.id WHERE t.id=? AND l.hospital_id=?').get(body.serviceTypeId,body.hospital);
      if(!service)return out({error:'اختر نوع خدمة مرتبطًا بالمستشفى'},400);
      if(!validDate(body.date)||body.date>new Date().toISOString().slice(0,10))return out({error:'أدخل تاريخًا صحيحًا غير مستقبلي'},400);
      if(!body.values||typeof body.values!=='object'||Array.isArray(body.values))return out({error:'أدخل بيانات الفروع'},400);
      const definitions=fieldsFor(body.hospital,body.serviceTypeId),fields=definitions.flatMap(department=>department.fields);
      if(!fields.length)return out({error:'أضف الأقسام والفروع من إعدادات المستشفيات أولًا'},400);
      if(fields.length>1500)return out({error:'عدد حقول الإعدادات يتجاوز الحد المسموح'},400);
      const allowed=new Set(fields.map(field=>field.key)),submitted=Object.keys(body.values);
      if(submitted.some(key=>!allowed.has(key)))return out({error:'توجد حقول لا تتبع إعدادات هذا المستشفى ونوع الخدمة'},400);
      const values={};
      for(const field of fields){
        const value=body.values[field.key];
        if(field.inputMode==='age_gender'||field.inputMode==='gender'){
          if(value==null||value===''){values[field.key]={breakdown:null,total:null};continue}
          if(Number.isSafeInteger(value)&&value>=0){values[field.key]={breakdown:null,total:value};continue}
          if(!value||typeof value!=='object'||Array.isArray(value))return out({error:'أدخل تفاصيل الجنس والعمر المطلوبة لكل فرع'},400);
          const keys=field.inputMode==='gender'?['male','female']:['male_under18','female_under18','male_18_65','female_18_65','male_over65','female_over65'];if(Object.keys(value).some(key=>!keys.includes(key)))return out({error:'تفاصيل الجنس والعمر غير صالحة'},400);
          const detail={};for(const key of keys){const part=value[key];if(part==null||part===''){detail[key]=null;continue}if(!Number.isSafeInteger(part)||part<0)return out({error:'القيم يجب أن تكون أعدادًا صحيحة غير سالبة'},400);detail[key]=part}
          const supplied=Object.values(detail).some(part=>part!==null);values[field.key]={breakdown:supplied?detail:null,total:supplied?Object.values(detail).reduce((sum,part)=>sum+(part??0),0):null};continue
        }
        if(value==null||value===''){values[field.key]={breakdown:null,total:null};continue}
        if(!Number.isSafeInteger(value)||value<0)return out({error:'القيم يجب أن تكون أعدادًا صحيحة غير سالبة'},400);
        values[field.key]={breakdown:null,total:value};
      }
      if(!Object.values(values).some(value=>value.total!==null))return out({error:'أدخل قيمة واحدة على الأقل'},400);
      const entries=definitions.flatMap(department=>department.fields.map(field=>({key:field.key,departmentId:department.id,departmentName:department.name,branchId:field.branchId,label:field.label,inputMode:field.inputMode,value:values[field.key].total,breakdown:values[field.key].breakdown})));
      if(typeof body.notes!=='string'||body.notes.length>3000)return out({error:'الملاحظات أطول من المسموح'},400);
      const existing=sql.prepare('SELECT * FROM hospital_activity_records WHERE hospital_id=? AND service_type_id=? AND date=?').get(body.hospital,body.serviceTypeId,body.date);
      if(body.id){
        const record=sql.prepare('SELECT * FROM hospital_activity_records WHERE id=?').get(body.id);
        if(!record||record.hospital_id!==body.hospital||record.service_type_id!==body.serviceTypeId||record.date!==body.date)return out({error:'تعذر العثور على السجل المطلوب تعديله'},404);
        sql.prepare('UPDATE hospital_activity_records SET entries_json=?,notes=?,updated_at=? WHERE id=?').run(JSON.stringify(entries),body.notes.trim(),new Date().toISOString(),record.id);
        return out({id:record.id,saved:true});
      }
      if(existing)return out({error:'توجد إحصائية مسجلة لهذا المستشفى ونوع الخدمة والتاريخ'},409);
      const id='activity-'+randomUUID(),now=new Date().toISOString();
      sql.prepare('INSERT INTO hospital_activity_records(id,hospital_id,service_type_id,date,entries_json,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(id,body.hospital,body.serviceTypeId,body.date,JSON.stringify(entries),body.notes.trim(),now,now);
      return out({id,saved:true});
    }catch(error){return out({error:error.message||'تعذر حفظ الإحصائية'},error.status||400)}
  }
  return handle;
}
