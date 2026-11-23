/**
 * الأنوار — نسخة احتياطية يومية على جوجل درايف
 * مرة واحدة بس:
 *   1) الصق «مفتاح النسخ الاحتياطي» من البرنامج (الإدارة ← نسخة احتياطية يومية) بين علامتين التنصيص في السطر TOKEN تحت.
 *   2) من فوق اختار الدالة setup ودوس Run، ووافق على الصلاحيات (حسابك أنت).
 * بعدها هتتعمل نسخة كل يوم الساعة 11:50 بالليل في فولدر «نسخ الأنوار الاحتياطية»،
 * والنسخ الأقدم من 30 يوم بتتنقل لسلة المهملات. ولو حصل خطأ جوجل هيبعتلك إيميل.
 */
const TOKEN = 'الصق_المفتاح_هنا';
const SUPABASE_URL = 'https://vdyovrnxnwqhqdfaozls.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZkeW92cm54bndxaHFkZmFvemxzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTUzNTQ4NTUsImV4cCI6MjExMDkzMDg1NX0.M4pHkpXF63aKiw3uMolVcbgIrimRhrc7hCHCwrzBgTo';
const FOLDER_ID = '1aAQYPu1ad-Pp7tZJju1BEMW4QJid2lAD';
const KEEP_DAYS = 30;

function setup() {
  if (!TOKEN || TOKEN.indexOf('الصق') === 0) throw new Error('الصق مفتاح النسخ الاحتياطي في سطر TOKEN الأول');
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('dailyBackup').timeBased().everyDays(1).atHour(23).nearMinute(50).inTimezone('Africa/Cairo').create();
  dailyBackup();
  Logger.log('تمام ✓ النسخة الأولى اتعملت، والنسخ اليومي اتفعّل الساعة 11:50 بالليل.');
}

function dailyBackup() {
  var res = UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/rpc/backup_fetch', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { apikey: ANON_KEY, Authorization: 'Bearer ' + ANON_KEY },
    payload: JSON.stringify({ p_token: TOKEN })
  });
  if (res.getResponseCode() !== 200) throw new Error('فشل تنزيل النسخة: ' + res.getResponseCode() + ' ' + res.getContentText().slice(0, 300));
  var body = res.getContentText();
  var data = JSON.parse(body);
  if (!data || !data.tables) throw new Error('النسخة فاضية');
  var folder = DriveApp.getFolderById(FOLDER_ID);
  var name = 'نسخة-الأنوار-' + Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd_HHmm') + '.json';
  folder.createFile(name, body, 'application/json');
  var limit = new Date(Date.now() - KEEP_DAYS * 864e5), it = folder.getFiles();
  while (it.hasNext()) { var f = it.next(); if (f.getName().indexOf('نسخة-الأنوار-') === 0 && f.getDateCreated() < limit) f.setTrashed(true); }
}
