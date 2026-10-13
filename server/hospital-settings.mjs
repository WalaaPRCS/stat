// One-time reset explicitly requested before rebuilding hospital settings.
export function hospitalSettingsService(sql,out){
 sql.exec('CREATE TABLE IF NOT EXISTS hospital_settings_resets(id TEXT PRIMARY KEY,completed_at TEXT NOT NULL)');
 const resetId='remove-hospital-settings-20261013';
 if(!sql.prepare('SELECT 1 FROM hospital_settings_resets WHERE id=?').get(resetId)){
  sql.exec('BEGIN IMMEDIATE');
  try{
   const exists=table=>!!sql.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
   if(exists('hospital_outpatient_clinics'))sql.exec('DELETE FROM hospital_outpatient_clinics');
   if(exists('hospital_departments')){
    if(sql.prepare('PRAGMA table_info(hospital_departments)').all().some(c=>c.name==='parent_id'))sql.exec('UPDATE hospital_departments SET parent_id=NULL');
    sql.exec('DELETE FROM hospital_departments');
   }
   if(exists('hospital_definition_names'))sql.exec('DELETE FROM hospital_definition_names');
   sql.prepare('INSERT INTO hospital_settings_resets VALUES(?,?)').run(resetId,new Date().toISOString());
   sql.exec('COMMIT');
  }catch(e){sql.exec('ROLLBACK');throw e}
 }
 return async()=>out({error:'صفحة إعدادات المستشفيات محذوفة'},404);
}
