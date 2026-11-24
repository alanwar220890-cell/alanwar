/**
 * الأنوار — نسخة احتياطية يومية مشفّرة على جوجل درايف + نسخة تانية على إيميل تاني
 * مرة واحدة بس:
 *   1) الصق «مفتاح النسخ الاحتياطي» من البرنامج (الإدارة ← نسخة احتياطية يومية) بين علامتين التنصيص في سطر TOKEN.
 *   2) (اختياري ومهم) اكتب إيميل تاني غير الإيميل ده في سطر COPY_EMAIL علشان توصله نسخة كل أسبوع.
 *   3) من فوق اختار الدالة setup ودوس تنفيذ (Run)، ووافق على الصلاحيات.
 * النسخ بتتحفظ مشفّرة: محدش يقدر يفتحها من غير «ملف مفتاح فك النسخ» + كلمة سره اللي مع المدير العام.
 */
const TOKEN = 'الصق_المفتاح_هنا';
const COPY_EMAIL = '';          // مثال: 'backup.alanwar@gmail.com' — يفضل حساب تاني مختلف
const COPY_EVERY_DAYS = 7;      // كل كام يوم تتبعت نسخة على الإيميل التاني
const SUPABASE_URL = 'https://vdyovrnxnwqhqdfaozls.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZkeW92cm54bndxaHFkZmFvemxzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTUzNTQ4NTUsImV4cCI6MjExMDkzMDg1NX0.M4pHkpXF63aKiw3uMolVcbgIrimRhrc7hCHCwrzBgTo';
const FOLDER_ID = '1aAQYPu1ad-Pp7tZJju1BEMW4QJid2lAD';
const KEEP_DAYS = 30;

function setup() {
  if (!TOKEN || TOKEN.indexOf('الصق') === 0) throw new Error('الصق مفتاح النسخ الاحتياطي في سطر TOKEN');
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('dailyBackup').timeBased().everyDays(1).atHour(23).nearMinute(50).inTimezone('Africa/Cairo').create();
  dailyBackup();
  Logger.log('تمام ✓ النسخة الأولى اتعملت، والنسخ اليومي اتفعّل الساعة 11:50 بالليل.');
}

function call_(path, payload) {
  return UrlFetchApp.fetch(SUPABASE_URL + path, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { apikey: ANON_KEY, Authorization: 'Bearer ' + ANON_KEY }, payload: JSON.stringify(payload)
  });
}

function dailyBackup() {
  var stamp = Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd_HHmm');
  var res = call_('/functions/v1/backup-enc', { token: TOKEN }), body = res.getContentText(), name, enc = true;
  if (res.getResponseCode() === 200) {
    var d = JSON.parse(body);
    if (!d || !d.data || !d.key) throw new Error('النسخة المشفرة فاضية');
    name = 'نسخة-الأنوار-مشفرة-' + stamp + '.json';
  } else if (res.getResponseCode() === 400 && body.indexOf('مفتاح تشفير') >= 0) {
    // لسه مفيش مفتاح تشفير متعمل من البرنامج: نكمل بالنسخة العادية مؤقتًا علشان مايبقاش في يوم من غير نسخة
    enc = false;
    res = call_('/rest/v1/rpc/backup_fetch', { p_token: TOKEN }); body = res.getContentText();
    if (res.getResponseCode() !== 200) throw new Error('فشل تنزيل النسخة: ' + res.getResponseCode() + ' ' + body.slice(0, 300));
    if (!JSON.parse(body).tables) throw new Error('النسخة فاضية');
    name = 'نسخة-الأنوار-' + stamp + '.json';
  } else {
    throw new Error('فشل تنزيل النسخة المشفرة: ' + res.getResponseCode() + ' ' + body.slice(0, 300));
  }
  var folder = DriveApp.getFolderById(FOLDER_ID);
  var file = folder.createFile(name, body, 'application/json');
  var limit = new Date(Date.now() - KEEP_DAYS * 864e5), it = folder.getFiles();
  while (it.hasNext()) { var f = it.next(); if (f.getName().indexOf('نسخة-الأنوار-') === 0 && f.getDateCreated() < limit) f.setTrashed(true); }
  // نسخة تانية على إيميل تاني (المشفرة بس)
  var props = PropertiesService.getScriptProperties(), last = +(props.getProperty('lastCopy') || 0);
  if (enc && COPY_EMAIL && Date.now() - last > (COPY_EVERY_DAYS - 0.5) * 864e5) {
    MailApp.sendEmail({ to: COPY_EMAIL, subject: 'نسخة الأنوار الاحتياطية المشفرة ' + stamp,
      body: 'نسخة احتياطية مشفرة من برنامج الأنوار. احتفظ بيها ومتفتحهاش غير من البرنامج: الإدارة ← تجربة استرجاع نسخة.', attachments: [file.getBlob()] });
    props.setProperty('lastCopy', String(Date.now()));
  }
}

/** شغّلها مرة واحدة بعد ما التشفير يشتغل: بتنقل النسخ القديمة اللي مش مشفرة لسلة المهملات */
function trashOldPlainBackups() {
  var it = DriveApp.getFolderById(FOLDER_ID).getFiles(), n = 0;
  while (it.hasNext()) { var f = it.next(), nm = f.getName(); if (nm.indexOf('نسخة-الأنوار-') === 0 && nm.indexOf('مشفرة') < 0) { f.setTrashed(true); n++; } }
  Logger.log('اتنقل ' + n + ' ملف لسلة المهملات. افتح سلة مهملات الدرايف وفضّيها علشان يتمسحوا نهائي.');
}
