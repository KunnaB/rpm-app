/**
 * WhatsApp publishing for the daily devotional.
 * Modes (Settings > WHATSAPP_MODE): auto, assist, off.
 * The WAHA API key lives in Script Properties as WAHA_API_KEY, never in the sheet.
 */

var MAX_WA_CHARS = 4000;

function logWa_(target, result, detail) {
  try { sheet_('WhatsAppLog').appendRow([new Date(), target, result, String(detail || '').slice(0, 1000)]); } catch (e) { console.error(e); }
}

function findDevotional_(date) {
  return devotionalRows_().filter(function (d) { return d.date === date; })[0] || null;
}

function setDevotionalStatus_(row, status, error) {
  var sh = sheet_('Devotionals');
  sh.getRange(row, 7).setValue(status);
  if (status === 'Posted') sh.getRange(row, 8).setValue(new Date());
  sh.getRange(row, 9).setValue(error || '');
}

function devotionalLink_(date) {
  var base = (setting('WEBSITE_URL') || '').replace(/\/$/, '');
  return base ? base + '/#/devotional/' + date : '';
}

/** Builds the WhatsApp message, kept under 4,000 characters. */
function buildMessage(d) {
  var oneLine = function (s) { return String(s || '').replace(/\s*\n\s*/g, ' ').trim(); };
  var link = devotionalLink_(d.date);
  var head = '*' + oneLine(d.title) + '*\n' + (d.scripture ? '_' + oneLine(d.scripture) + '_\n' : '') + '\n';
  var tail = (d.prayer ? '\n\n*Prayer:* ' + d.prayer.trim() : '') + (link ? '\n\nRead online: ' + link : '');
  var body = String(d.body || '').trim();
  var msg = head + body + tail;
  if (msg.length <= MAX_WA_CHARS) return msg;

  // Too long: post the first part and link to the full text.
  var more = link ? '\n\nContinue reading: ' + link : '';
  var room = MAX_WA_CHARS - head.length - more.length - 3;
  var cut = body.slice(0, Math.max(0, room));
  var lastBreak = Math.max(cut.lastIndexOf('\n\n'), cut.lastIndexOf('. '));
  if (lastBreak > room * 0.6) cut = cut.slice(0, lastBreak + 1);
  return head + cut.trim().replace(/[.\s]+$/, '') + '...' + more;
}

/* ------------------------------------------------------------------ */
/* WAHA calls                                                          */
/* ------------------------------------------------------------------ */

function waha_(method, path, payload) {
  var base = (setting('WAHA_URL') || '').replace(/\/$/, '');
  var key = PropertiesService.getScriptProperties().getProperty('WAHA_API_KEY');
  if (!base) throw new Error('WAHA_URL is empty in Settings');
  if (!key) throw new Error('WhatsApp server key is not set (RPM menu > Set WhatsApp server key)');
  var opts = { method: method, headers: { 'X-Api-Key': key }, muteHttpExceptions: true };
  if (payload) { opts.contentType = 'application/json'; opts.payload = JSON.stringify(payload); }
  var res = UrlFetchApp.fetch(base + path, opts);
  var code = res.getResponseCode(), text = res.getContentText();
  if (code < 200 || code >= 300) throw new Error('WhatsApp server replied ' + code + ': ' + text.slice(0, 300));
  try { return JSON.parse(text); } catch (e) { return text; }
}

function wahaSendText_(chatId, text) {
  return waha_('post', '/api/sendText', {
    session: setting('WAHA_SESSION') || 'default',
    chatId: chatId,
    text: text,
    linkPreview: true
  });
}

function wahaSessionStatus_() {
  var s = waha_('get', '/api/sessions/' + encodeURIComponent(setting('WAHA_SESSION') || 'default'));
  return (s && s.status) || 'UNKNOWN';
}

/* ------------------------------------------------------------------ */
/* Daily publish                                                       */
/* ------------------------------------------------------------------ */

/**
 * Runs from the daily timer. Safe to run more than once: it never double-posts.
 * opts.isRetry is set by the 2-minute retry.
 */
function publishDevotional(opts) {
  opts = (opts && typeof opts === 'object' && !opts.triggerUid) ? opts : {};
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(60000)) { logWa_('-', 'Skipped', 'Another post was already running'); return 'busy'; }
  try {
    var today = todayStr();
    var d = findDevotional_(today);
    if (!d) { logWa_('-', 'No devotional', 'Nothing in the Devotionals tab for ' + today); return 'none'; }
    if (d.status === 'Skip') { logWa_('-', 'Skipped', 'Status is Skip for ' + today); return 'skip'; }
    if (d.status === 'Posted') { logWa_('-', 'Already posted', today); return 'posted'; }

    var mode = (setting('WHATSAPP_MODE') || 'assist').toLowerCase();
    var text = buildMessage(d);

    if (mode === 'off') { logWa_('-', 'Off', 'WhatsApp mode is off'); return 'off'; }

    if (mode === 'assist') {
      var props = PropertiesService.getScriptProperties();
      if (props.getProperty('ASSIST_SENT_' + today) && !opts.manual) { logWa_('Email', 'Already sent', today); return 'assist'; }
      sendAssistEmail_(d, text, 'The church app is in assist mode, so the devotional is not posted automatically.');
      props.setProperty('ASSIST_SENT_' + today, '1');
      logWa_('Email', 'Assist email sent', setting('MEDIA_LEAD_EMAIL'));
      return 'assist';
    }

    // auto mode
    var targets = [
      { name: 'Channel', id: setting('WHATSAPP_CHANNEL_ID') },
      { name: 'Group', id: setting('WHATSAPP_GROUP_ID') }
    ].filter(function (t) { return t.id; });

    var p = PropertiesService.getScriptProperties();
    var doneKey = 'POSTED_' + today;
    var done = JSON.parse(p.getProperty(doneKey) || '[]');
    var errors = [];

    if (!targets.length) errors.push('No WhatsApp Channel or group ID in Settings');

    targets.forEach(function (t) {
      if (done.indexOf(t.id) !== -1) return; // already posted here today
      try {
        wahaSendText_(t.id, text);
        done.push(t.id);
        p.setProperty(doneKey, JSON.stringify(done));
        logWa_(t.name, 'Posted', t.id);
      } catch (err) {
        errors.push(t.name + ': ' + err.message);
        logWa_(t.name, 'Failed', err.message);
      }
    });

    if (!errors.length) {
      setDevotionalStatus_(d.row, 'Posted', '');
      return 'posted';
    }

    if (!opts.isRetry) {
      ScriptApp.newTrigger('retryPublishDevotional').timeBased().after(2 * 60 * 1000).create();
      logWa_('-', 'Will retry', 'Trying again in 2 minutes');
      return 'retrying';
    }

    setDevotionalStatus_(d.row, 'Failed', errors.join(' | '));
    sendAssistEmail_(d, text, 'Automatic posting failed twice, so please post it by hand. Reason: ' + errors.join('; '));
    logWa_('Email', 'Fallback email sent', setting('MEDIA_LEAD_EMAIL'));
    return 'failed';
  } finally {
    lock.releaseLock();
  }
}

function retryPublishDevotional() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'retryPublishDevotional') ScriptApp.deleteTrigger(t);
  });
  publishDevotional({ isRetry: true });
}

/* ------------------------------------------------------------------ */
/* Assist email (also the fallback)                                    */
/* ------------------------------------------------------------------ */

function sendAssistEmail_(d, text, reason) {
  var to = emailList_(setting('MEDIA_LEAD_EMAIL'));
  if (!to.length) to = emailList_(setting('ADMIN_ALERT_EMAIL'));
  if (!to.length) { logWa_('Email', 'Not sent', 'MEDIA_LEAD_EMAIL is empty in Settings'); return; }
  var wa = 'https://wa.me/?text=' + encodeURIComponent(text);
  var subject = "Please post today's devotional to WhatsApp: " + d.title;
  var plain = reason + '\n\n1. Group: open this link on your phone and choose the church group:\n' + wa +
    '\n\n2. Channel: copy the message below, open the church WhatsApp Channel and paste it.\n\n--------\n' + text + '\n--------';
  var html =
    '<div style="font-family:Arial,sans-serif;font-size:16px;line-height:1.5;color:#141414;max-width:600px">' +
    '<p>' + escHtml_(reason) + '</p>' +
    '<p><strong>1. Group:</strong> tap the button on your phone and choose the church group.</p>' +
    '<p><a href="' + escHtml_(wa) + '" style="display:inline-block;background:#1a7f4b;color:#fff;padding:14px 22px;border-radius:10px;text-decoration:none;font-weight:bold">Open in WhatsApp</a></p>' +
    '<p><strong>2. Channel:</strong> press and hold the message below to copy it, open the church WhatsApp Channel and paste it.</p>' +
    '<div style="white-space:pre-wrap;background:#f3ebdd;border-radius:10px;padding:16px">' + escHtml_(text) + '</div>' +
    '</div>';
  sendMail_(to.join(','), subject, plain, html);
}

/* ------------------------------------------------------------------ */
/* Health check (8pm daily)                                            */
/* ------------------------------------------------------------------ */

function checkWhatsAppHealth() {
  if ((setting('WHATSAPP_MODE') || '').toLowerCase() !== 'auto') return 'not-auto';
  var status, detail = '';
  try { status = wahaSessionStatus_(); } catch (err) { status = 'UNREACHABLE'; detail = err.message; }
  logWa_('Health', status, detail);
  if (status === 'WORKING') return status;

  var to = emailList_(setting('MEDIA_LEAD_EMAIL') + ',' + setting('ADMIN_ALERT_EMAIL'));
  if (!to.length) return status;
  var dash = (setting('WAHA_URL') || '').replace(/\/$/, '') + '/dashboard';
  sendMail_(to.join(','), 'Action needed: church WhatsApp is disconnected',
    'Tomorrow morning\'s devotional cannot post to WhatsApp automatically until this is fixed.\n\n' +
    'Status: ' + status + (detail ? ' (' + detail + ')' : '') + '\n\n' +
    'How to fix it (about 2 minutes):\n' +
    '1. On a computer, open ' + dash + ' and log in with the dashboard username and password.\n' +
    '2. Open the "default" session. If it shows a QR code, keep that page open.\n' +
    '3. On the automation phone, open WhatsApp > Settings > Linked devices > Link a device, and scan the QR code.\n' +
    '4. Wait until the status says WORKING.\n\n' +
    'If you cannot fix it tonight, nothing is lost: if posting fails in the morning, the media lead gets an email with the devotional ready to forward.');
  return status;
}

/* ------------------------------------------------------------------ */
/* Menu actions                                                        */
/* ------------------------------------------------------------------ */

function menuPostNow() {
  var ui = SpreadsheetApp.getUi();
  var d = findDevotional_(todayStr());
  if (!d) { ui.alert('There is no devotional in the Devotionals tab for today (' + todayStr() + ').'); return; }
  if (d.status === 'Posted') {
    if (ui.alert('Already posted', 'Today\'s devotional is already marked Posted. Post it again?', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
    setDevotionalStatus_(d.row, 'Scheduled', '');
    PropertiesService.getScriptProperties().deleteProperty('POSTED_' + todayStr());
  }
  if (d.status === 'Skip') { ui.alert('Today\'s devotional has Status "Skip". Change it to "Scheduled" first.'); return; }
  if (d.status === 'Failed') setDevotionalStatus_(d.row, 'Scheduled', '');
  var r = publishDevotional({ manual: true, isRetry: true });
  var words = { posted: 'Posted to WhatsApp.', assist: 'Assist mode: the forward-ready email has been sent to the media lead.', failed: 'Posting failed. The media lead has been emailed. See the WhatsAppLog tab for the reason.', off: 'WhatsApp mode is off.', busy: 'Another post is running. Try again in a minute.' };
  ui.alert(words[r] || ('Result: ' + r));
}

function sendTestPost() {
  var ui = SpreadsheetApp.getUi();
  var num = String(setting('TEST_WHATSAPP_NUMBER')).replace(/\D/g, '');
  if (!num) { ui.alert('Add a number to TEST_WHATSAPP_NUMBER in Settings first.'); return; }
  var d = findDevotional_(todayStr());
  var text = '[TEST] ' + (d ? buildMessage(d) : 'Test post from the RPM Hub. If you can read this, WhatsApp automation is working.');
  try {
    wahaSendText_(num + '@c.us', text);
    logWa_('Test', 'Posted', num);
    ui.alert('Test sent to ' + num + '.');
  } catch (err) {
    logWa_('Test', 'Failed', err.message);
    ui.alert('Test failed: ' + err.message);
  }
}

function menuCheckWhatsApp() {
  var ui = SpreadsheetApp.getUi();
  try {
    var s = wahaSessionStatus_();
    ui.alert(s === 'WORKING' ? 'WhatsApp is connected (WORKING).' : 'WhatsApp status: ' + s + '. If it is not WORKING, re-scan the QR code in the WhatsApp server dashboard.');
  } catch (err) {
    ui.alert('Could not reach the WhatsApp server: ' + err.message);
  }
}

function menuSetWahaKey() {
  var ui = SpreadsheetApp.getUi();
  var r = ui.prompt('WhatsApp server key', 'Paste the WAHA API key. It is stored privately in the script, not in the sheet.', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  var key = r.getResponseText().trim();
  if (!key) return;
  PropertiesService.getScriptProperties().setProperty('WAHA_API_KEY', key);
  ui.alert('Saved.');
}
