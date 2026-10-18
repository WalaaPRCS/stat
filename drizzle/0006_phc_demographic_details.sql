UPDATE `phc_metrics` SET `derived` = 1 WHERE `key` IN (
  'disabilities','skin','respiratory','gastroenteritis','hav','chronic','ent','orthopedic',
  'ophthalmology','neurology','gynecology_obstetrics','urology','ultrasound','conditions_other',
  'vaccine_total','child_normal_muac','child_sam','child_mam','plw_normal_muac','plw_sam','plw_mam'
);
