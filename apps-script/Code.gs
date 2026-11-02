/**
 * Renewed Purpose Ministry: RPM Hub back end.
 * Bound to the "RPM Hub" Google Sheet. Deployed as a web app.
 */

var TZ = 'Europe/London';

var TABS = {
  Settings: ['Key', 'Value', 'Notes'],
  Devotionals: ['Date', 'Title', 'Scripture', 'Body', 'Prayer', 'Confession', 'Status', 'PostedAt', 'Error'],
  Attendance: ['Timestamp', 'Service', 'Type', 'Name', 'Count'],
  FirstTimers: ['Timestamp', 'Name', 'Email', 'Phone', 'HowHeard', 'PrayerRequest', 'ConsentFollowUp', 'AssignedTo', 'Status', 'ContactedOn'],
  Events: ['Date', 'Time', 'Title', 'Location', 'Description', 'Link'],
  Prayer: ['Timestamp', 'Name', 'Request', 'ShareWithTeamOnly'],
  WhatsAppLog: ['Timestamp', 'Target', 'Result', 'Detail'],
  Dashboard: null
};

var DEFAULT_SETTINGS = [
  ['CHURCH_NAME', 'Renewed Purpose Ministry', 'Used in emails'],
  ['MEDIA_LEAD_EMAIL', '', 'Gets the ready-to-forward devotional if WhatsApp posting fails, and connection alerts'],
  ['ADMIN_ALERT_EMAIL', '', 'Also gets WhatsApp connection alerts (Akunna)'],
  ['FOLLOW_UP_EMAILS', '', 'Follow-up team, separated by commas. New first timers are shared out in turn'],
  ['WEBSITE_URL', '', 'The live website address, used in WhatsApp posts'],
  ['WHATSAPP_MODE', 'assist', 'auto = posts by itself, assist = emails the media lead to forward it, off = website only'],
  ['WAHA_URL', '', 'WhatsApp server address, e.g. https://rpm-wa.duckdns.org'],
  ['WAHA_SESSION', 'default', 'Leave as default'],
  ['WHATSAPP_CHANNEL_ID', '', 'Ends in @newsletter'],
  ['WHATSAPP_GROUP_ID', '', 'Ends in @g.us (optional)'],
  ['TEST_WHATSAPP_NUMBER', '', 'Number for test posts, country code and digits only, e.g. 447700900000'],
  ['POST_TIME', '6', 'Hour of the day for the daily post (0 to 23). Run "Install daily timers" after changing'],
  ['YOUTUBE_CHANNEL_ID', '', 'Starts with UC. Used to show the latest sermons'],
  ['WELCOME_EMAIL_SUBJECT', 'Thank you for visiting Renewed Purpose Ministry', 'Sent to first timers who tick the consent box'],
  ['WELCOME_EMAIL_BODY', 'Hi {name},\n\nThank you for joining us at {service}. It was a joy to have you with us.\n\nSomeone from our team will be in touch soon.\n\nRenewed Purpose Ministry', 'Use {name} and {service}. Edit freely']
];

var FIRST_TIMER_STATUSES = ['New', 'Contacted', 'Member'];
var DEVOTIONAL_STATUSES = ['Scheduled', 'Posted', 'Failed', 'Skip'];

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }
function sheet_(name) { return ss_().getSheetByName(name); }

var settingsCache_ = null;
function setting(key) {
  if (!settingsCache_) {
    settingsCache_ = {};
    var sh = sheet_('Settings');
    if (sh && sh.getLastRow() > 1) {
      sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(function (r) {
        settingsCache_[String(r[0]).trim()] = String(r[1]).trim();
      });
    }
  }
  return settingsCache_[key] || '';
}

function todayStr() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }

function dateStr_(v) {
  if (v instanceof Date && !isNaN(v)) return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  var s = String(v || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); // UK style 03/11/2026
  if (m) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  return '';
}

function timeStr_(v) {
  if (v instanceof Date && !isNaN(v)) return Utilities.formatDate(v, TZ, 'h:mm a').toLowerCase();
  return String(v || '').trim();
}

/** Trim, limit length, and stop text being treated as a spreadsheet formula. */
function clean_(v, max) {
  var s = String(v == null ? '' : v).replace(/\u0000/g, '').trim().slice(0, max || 500);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return s;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function rows_(name) {
  var sh = sheet_(name);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
}

function emailList_(s) {
  return String(s || '').split(/[,;\s]+/).map(function (e) { return e.trim(); })
    .filter(function (e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); });
}

function sendMail_(to, subject, body, html) {
  if (!to) return;
  var opts = { name: setting('CHURCH_NAME') || 'Renewed Purpose Ministry' };
  if (html) opts.htmlBody = html;
  MailApp.sendEmail(to, subject, body, opts);
}

function escHtml_(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ------------------------------------------------------------------ */
/* Web app: GET                                                        */
/* ------------------------------------------------------------------ */

function doGet(e) {
  var p = (e && e.parameter) || {};
  try {
    var data;
    switch (p.action) {
      case 'devotional': data = apiDevotional_(p.date); break;
      case 'devotionals': data = apiDevotionals_(); break;
      case 'sermons': data = apiSermons_(); break;
      case 'events': data = apiEvents_(); break;
      case 'ping': data = { ok: true, today: todayStr() }; break;
      default: return json_({ ok: false, error: 'Unknown action' });
    }
    return json_({ ok: true, data: data });
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: 'Server error' });
  }
}

function devotionalRows_() {
  return rows_('Devotionals').map(function (r, i) {
    return {
      row: i + 2,
      date: dateStr_(r[0]),
      title: String(r[1]).trim(),
      scripture: String(r[2]).trim(),
      body: String(r[3]).trim(),
      prayer: String(r[4]).trim(),
      confession: String(r[5]).trim(),
      status: String(r[6]).trim()
    };
  }).filter(function (d) { return d.date && d.title; });
}

function publicDevotional_(d) {
  return { date: d.date, title: d.title, scripture: d.scripture, body: d.body, prayer: d.prayer, confession: d.confession };
}

function apiDevotional_(date) {
  var today = todayStr();
  date = /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date : today;
  if (date > today) return null; // never show future devotionals early
  var hit = devotionalRows_().filter(function (d) { return d.date === date && d.status !== 'Skip'; })[0];
  return hit ? publicDevotional_(hit) : null;
}

function apiDevotionals_() {
  var today = todayStr();
  return devotionalRows_()
    .filter(function (d) { return d.date <= today && d.status !== 'Skip'; })
    .sort(function (a, b) { return a.date < b.date ? 1 : -1; })
    .slice(0, 30)
    .map(publicDevotional_);
}

function apiEvents_() {
  var today = todayStr();
  return rows_('Events').map(function (r) {
    return {
      date: dateStr_(r[0]), time: timeStr_(r[1]), title: String(r[2]).trim(),
      location: String(r[3]).trim(), description: String(r[4]).trim(), link: String(r[5]).trim()
    };
  }).filter(function (ev) { return ev.date && ev.title && ev.date >= today; })
    .sort(function (a, b) { return a.date > b.date ? 1 : -1; })
    .slice(0, 50);
}

function apiSermons_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('sermons');
  if (hit) return JSON.parse(hit);
  var id = setting('YOUTUBE_CHANNEL_ID');
  if (!id) return [];
  var res = UrlFetchApp.fetch('https://www.youtube.com/feeds/videos.xml?channel_id=' + encodeURIComponent(id), { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return [];
  var root = XmlService.parse(res.getContentText()).getRootElement();
  var atom = XmlService.getNamespace('http://www.w3.org/2005/Atom');
  var yt = XmlService.getNamespace('yt', 'http://www.youtube.com/xml/schemas/2015');
  var list = root.getChildren('entry', atom).map(function (en) {
    return { id: en.getChildText('videoId', yt), title: en.getChildText('title', atom), published: en.getChildText('published', atom) };
  }).filter(function (v) { return v.id; });
  cache.put('sermons', JSON.stringify(list), 3600);
  return list;
}

/* ------------------------------------------------------------------ */
/* Web app: POST (text/plain JSON body)                                */
/* ------------------------------------------------------------------ */

function doPost(e) {
  var body;
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
  catch (err) { return json_({ ok: false, error: 'Bad request' }); }

  if (body.website) return json_({ ok: true }); // honeypot: quietly ignore bots

  try {
    switch (body.action) {
      case 'checkin': return json_(postCheckin_(body));
      case 'headcount': return json_(postHeadcount_(body));
      case 'prayer': return json_(postPrayer_(body));
      default: return json_({ ok: false, error: 'Unknown action' });
    }
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: 'Server error' });
  }
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function postCheckin_(b) {
  var name = clean_(b.name, 100);
  var service = clean_(b.service, 80) || 'Other';
  if (!name) return { ok: false, error: 'Name is required' };
  var now = new Date();

  if (b.type !== 'first') {
    withLock_(function () { sheet_('Attendance').appendRow([now, service, 'Regular', name, 1]); });
    return { ok: true };
  }

  var email = clean_(b.email, 150);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) email = '';
  var phone = clean_(b.phone, 30);
  var howHeard = clean_(b.howHeard, 60);
  var prayer = clean_(b.prayer, 2000);
  var consent = b.consent === true;
  var assignee = '';

  withLock_(function () {
    assignee = consent ? nextAssignee_() : '';
    sheet_('Attendance').appendRow([now, service, 'First timer', name, 1]);
    sheet_('FirstTimers').appendRow([now, name, email, phone, howHeard, prayer, consent ? 'Yes' : 'No', assignee, 'New', '']);
    if (prayer) sheet_('Prayer').appendRow([now, name, prayer + ' (from first-time visitor check-in)', 'Yes']);
  });

  // Emails happen after the sheet is saved, so a mail problem never loses a check-in.
  var u = function (v) { return String(v).replace(/^'/, ''); };
  name = u(name); phone = u(phone); prayer = u(prayer); service = u(service); howHeard = u(howHeard);
  try {
    if (consent && email) {
      var subject = setting('WELCOME_EMAIL_SUBJECT') || 'Thank you for visiting';
      var text = (setting('WELCOME_EMAIL_BODY') || 'Hi {name},\n\nThank you for visiting us.')
        .replace(/\\n/g, '\n').replace(/\{name\}/g, name.split(' ')[0]).replace(/\{service\}/g, service);
      sendMail_(email, subject, text);
    }
    if (assignee) {
      sendMail_(assignee, 'New first timer to follow up: ' + name,
        'Hi,\n\nA first-time visitor checked in and has been assigned to you for follow-up.\n\n' +
        'Name: ' + name + '\nService: ' + service + '\nEmail: ' + (email || 'not given') + '\nPhone: ' + (phone || 'not given') +
        '\nHow they heard: ' + (howHeard || 'not given') + (prayer ? '\nPrayer request: ' + prayer : '') +
        '\n\nThey agreed to be contacted. Please reach out within the next few days, then set their Status to "Contacted" in the FirstTimers tab of the RPM Hub sheet.\n\n' +
        ss_().getUrl());
    }
  } catch (err) { console.error('Check-in email failed', err); }

  return { ok: true };
}

function nextAssignee_() {
  var team = emailList_(setting('FOLLOW_UP_EMAILS'));
  if (!team.length) return '';
  var props = PropertiesService.getScriptProperties();
  var i = parseInt(props.getProperty('RR_INDEX') || '0', 10) || 0;
  props.setProperty('RR_INDEX', String((i + 1) % team.length));
  return team[i % team.length];
}

function postHeadcount_(b) {
  var count = parseInt(b.count, 10);
  if (!(count > 0 && count <= 5000)) return { ok: false, error: 'Invalid count' };
  var service = clean_(b.service, 80) || 'Other';
  withLock_(function () { sheet_('Attendance').appendRow([new Date(), service, 'Usher count', '', count]); });
  return { ok: true };
}

function postPrayer_(b) {
  var request = clean_(b.request, 3000);
  if (!request) return { ok: false, error: 'Request is required' };
  withLock_(function () {
    sheet_('Prayer').appendRow([new Date(), clean_(b.name, 100), request, b.teamOnly === false ? 'No' : 'Yes']);
  });
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Follow-up and data retention                                        */
/* ------------------------------------------------------------------ */

/** Daily 9am: remind follow-up people about first timers still "New" after 3 days. */
function followUpReminders() {
  var cutoff = new Date(Date.now() - 3 * 24 * 3600 * 1000);
  var byPerson = {};
  rows_('FirstTimers').forEach(function (r) {
    var when = r[0], status = String(r[8]).trim(), who = String(r[7]).trim();
    if (who && status === 'New' && when instanceof Date && when < cutoff) {
      (byPerson[who] = byPerson[who] || []).push(r[1] + ' (visited ' + Utilities.formatDate(when, TZ, 'd MMM') + ', ' + (r[3] || r[2] || 'no contact details') + ')');
    }
  });
  Object.keys(byPerson).forEach(function (who) {
    sendMail_(who, 'Reminder: first timers waiting for follow-up',
      'Hi,\n\nThese first-time visitors are still marked "New":\n\n- ' + byPerson[who].join('\n- ') +
      '\n\nOnce you have been in touch, set their Status to "Contacted" (or "Member") in the FirstTimers tab:\n' + ss_().getUrl());
  });
}

/** Monthly: apply the 12-month retention rules in the privacy notice. */
function cleanupOldRecords() {
  var cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 1);

  withLock_(function () {
    var ft = sheet_('FirstTimers'), data = rows_('FirstTimers');
    for (var i = data.length - 1; i >= 0; i--) {
      if (data[i][0] instanceof Date && data[i][0] < cutoff && String(data[i][8]).trim() !== 'Member') ft.deleteRow(i + 2);
    }
    var pr = sheet_('Prayer'), pdata = rows_('Prayer');
    for (var j = pdata.length - 1; j >= 0; j--) {
      if (pdata[j][0] instanceof Date && pdata[j][0] < cutoff) pr.deleteRow(j + 2);
    }
    var at = sheet_('Attendance'), adata = rows_('Attendance');
    adata.forEach(function (r, k) {
      if (r[0] instanceof Date && r[0] < cutoff && r[3]) at.getRange(k + 2, 4).setValue('');
    });
  });

  // Tidy old daily markers used to prevent double posting
  var props = PropertiesService.getScriptProperties(), today = todayStr();
  props.getKeys().forEach(function (k) {
    if (/^(POSTED_|ASSIST_SENT_)/.test(k) && k.indexOf(today) === -1) props.deleteProperty(k);
  });
}

/* ------------------------------------------------------------------ */
/* Setup, triggers and menu                                            */
/* ------------------------------------------------------------------ */

function setup() {
  var ss = ss_();
  ss.setSpreadsheetTimeZone(TZ);

  Object.keys(TABS).forEach(function (name) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    var headers = TABS[name];
    if (headers) {
      sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#141414').setFontColor('#ffffff');
      sh.setFrozenRows(1);
    }
  });

  // Remove the default empty "Sheet1" if it is still there
  var s1 = ss.getSheetByName('Sheet1');
  if (s1 && s1.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(s1);

  // Settings: add any missing keys, never overwrite values already set
  var st = sheet_('Settings');
  var have = {};
  rows_('Settings').forEach(function (r) { have[String(r[0]).trim()] = true; });
  DEFAULT_SETTINGS.forEach(function (row) { if (!have[row[0]]) st.appendRow(row); });
  st.setColumnWidth(1, 220); st.setColumnWidth(2, 320); st.setColumnWidth(3, 520);
  st.getRange('B:B').setNumberFormat('@'); // keep numbers and IDs as plain text
  st.getRange('B:C').setWrap(true);

  // Devotionals
  var dv = sheet_('Devotionals');
  dv.getRange('A2:A').setNumberFormat('yyyy-mm-dd');
  dv.getRange('H2:H').setNumberFormat('yyyy-mm-dd hh:mm');
  dv.getRange('G2:G').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(DEVOTIONAL_STATUSES, true).setAllowInvalid(false).build());
  dv.setColumnWidth(2, 220); dv.setColumnWidth(3, 260); dv.setColumnWidth(4, 420); dv.setColumnWidth(5, 260); dv.setColumnWidth(6, 220);
  dv.getRange('B:F').setWrap(true).setVerticalAlignment('top');
  if (dv.getLastRow() < 2) {
    var tomorrow = new Date(Date.now() + 24 * 3600 * 1000);
    dv.appendRow([tomorrow, 'EXAMPLE: replace this row with a real devotional', 'Book 1:1', 'Type the devotional here. Leave a blank line between paragraphs.', 'Type the prayer here.', 'Type the confession here.', 'Skip', '', '']);
  }

  // FirstTimers
  var ft = sheet_('FirstTimers');
  ft.getRange('I2:I').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(FIRST_TIMER_STATUSES, true).setAllowInvalid(false).build());
  ft.getRange('J2:J').setDataValidation(SpreadsheetApp.newDataValidation().requireDate().setAllowInvalid(true).build()).setNumberFormat('yyyy-mm-dd');
  ['A2:A'].forEach(function (a) { ft.getRange(a).setNumberFormat('yyyy-mm-dd hh:mm'); });
  sheet_('Attendance').getRange('A2:A').setNumberFormat('yyyy-mm-dd hh:mm');
  sheet_('Prayer').getRange('A2:A').setNumberFormat('yyyy-mm-dd hh:mm');
  sheet_('WhatsAppLog').getRange('A2:A').setNumberFormat('yyyy-mm-dd hh:mm:ss');
  sheet_('Events').getRange('A2:A').setNumberFormat('yyyy-mm-dd');

  buildDashboard_();

  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', ss.getId());
  try { SpreadsheetApp.getUi().alert('RPM Hub is set up. Next: RPM menu > Install daily timers.'); } catch (e) {}
}

function buildDashboard_() {
  var db = sheet_('Dashboard');
  db.clear();
  var title = function (cell, text) { db.getRange(cell).setValue(text).setFontWeight('bold').setFontSize(12); };

  title('A1', 'Attendance by service date');
  db.getRange('A2').setValue('Totals by type (Regular, First timer, Usher count)').setFontColor('#6b655d');
  db.getRange('A3').setFormula('=IFERROR(QUERY(Attendance!A2:E,"select toDate(A), B, sum(E) where A is not null group by toDate(A), B pivot C order by toDate(A) desc label toDate(A) \'Date\', B \'Service\'",0),"No attendance yet")');
  db.getRange('A4:A').setNumberFormat('ddd d mmm yyyy');

  title('H1', 'First timers per month');
  db.getRange('H3').setFormula('=IFERROR(QUERY(FirstTimers!A2:J,"select year(A), month(A)+1, count(B) where A is not null group by year(A), month(A)+1 order by year(A) desc, month(A)+1 desc label year(A) \'Year\', month(A)+1 \'Month\', count(B) \'First timers\'",0),"None yet")');

  title('L1', 'Follow-up status');
  db.getRange('L3').setFormula('=IFERROR(QUERY(FirstTimers!A2:J,"select I, count(B) where B is not null group by I label I \'Status\', count(B) \'People\'",0),"None yet")');

  title('O1', 'Devotional WhatsApp posts');
  db.getRange('O3:O5').setValues([['Posted'], ['Failed'], ['Success rate']]);
  db.getRange('P3').setFormula('=COUNTIF(Devotionals!G2:G,"Posted")');
  db.getRange('P4').setFormula('=COUNTIF(Devotionals!G2:G,"Failed")');
  db.getRange('P5').setFormula('=IF(P3+P4=0,"No posts yet",P3/(P3+P4))').setNumberFormat('0%');
  db.setFrozenRows(1);
}

function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  var hour = parseInt(setting('POST_TIME'), 10);
  if (!(hour >= 0 && hour <= 23)) hour = 6;
  ScriptApp.newTrigger('publishDevotional').timeBased().everyDays(1).atHour(hour).nearMinute(0).inTimezone(TZ).create();
  ScriptApp.newTrigger('checkWhatsAppHealth').timeBased().everyDays(1).atHour(20).nearMinute(0).inTimezone(TZ).create();
  ScriptApp.newTrigger('followUpReminders').timeBased().everyDays(1).atHour(9).nearMinute(0).inTimezone(TZ).create();
  ScriptApp.newTrigger('cleanupOldRecords').timeBased().onMonthDay(1).atHour(3).inTimezone(TZ).create();
  try { SpreadsheetApp.getUi().alert('Daily timers installed. The devotional will post each day at about ' + hour + ':00.'); } catch (e) {}
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('RPM')
    .addItem("Post today's devotional now", 'menuPostNow')
    .addItem('Send test post to Akunna only', 'sendTestPost')
    .addItem('Check WhatsApp connection', 'menuCheckWhatsApp')
    .addSeparator()
    .addItem('Set WhatsApp server key', 'menuSetWahaKey')
    .addItem('Install daily timers', 'installTriggers')
    .addItem('Re-run setup', 'setup')
    .addToUi();
}
