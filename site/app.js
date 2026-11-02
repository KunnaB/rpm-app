/* Renewed Purpose Ministry app. Plain JavaScript, no build step. */
(function () {
  "use strict";
  var C = window.RPM_CONFIG || {};
  var DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  /* ---------- helpers ---------- */
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function safeUrl(u) {
    u = String(u || "").trim();
    return /^(https?:|mailto:|tel:)/i.test(u) ? u : "";
  }
  function icon(id) { return '<svg aria-hidden="true"><use href="#i-' + id + '"/></svg>'; }
  function paras(text) {
    return String(text || "").split(/\n\s*\n/).map(function (p) {
      return "<p>" + esc(p.trim()).replace(/\n/g, "<br>") + "</p>";
    }).join("");
  }
  function store(key, val) {
    try {
      if (val === undefined) return JSON.parse(localStorage.getItem("rpm:" + key));
      localStorage.setItem("rpm:" + key, JSON.stringify(val));
    } catch (e) { return null; }
  }

  /* UK time, whatever the phone's own time zone is */
  function londonNow() {
    var parts = {};
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false
    }).formatToParts(new Date()).forEach(function (p) { parts[p.type] = p.value; });
    var dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
    return {
      date: parts.year + "-" + parts.month + "-" + parts.day,
      dow: dow,
      mins: (parseInt(parts.hour, 10) % 24) * 60 + parseInt(parts.minute, 10)
    };
  }
  function addDays(iso, n) {
    var d = new Date(iso + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function niceDate(iso) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || "")) return esc(iso);
    var d = new Date(iso + "T12:00:00Z");
    return DAYS[d.getUTCDay()] + " " + d.getUTCDate() + " " + MONTHS[d.getUTCMonth()] + " " + d.getUTCFullYear();
  }
  function shortDate(iso) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || "")) return esc(iso);
    var d = new Date(iso + "T12:00:00Z");
    return d.getUTCDate() + " " + MONTHS[d.getUTCMonth()].slice(0, 3);
  }
  function timeLabel(hhmm) {
    var p = String(hhmm || "").split(":"), h = parseInt(p[0], 10), m = p[1] || "00";
    if (isNaN(h)) return esc(hhmm);
    return (h % 12 || 12) + (m === "00" ? "" : ":" + m) + (h < 12 ? "am" : "pm");
  }
  function toMins(hhmm) { var p = String(hhmm).split(":"); return parseInt(p[0], 10) * 60 + parseInt(p[1] || 0, 10); }

  function nextService() {
    var list = C.serviceTimes || [];
    if (!list.length) return null;
    var now = londonNow(), best = null;
    list.forEach(function (s) {
      var diffDays = (s.day - now.dow + 7) % 7;
      var start = toMins(s.time), end = start + (s.durationMins || 120);
      if (diffDays === 0 && now.mins >= end) diffDays = 7;
      var live = diffDays === 0 && now.mins >= start && now.mins < end;
      var score = diffDays * 1440 + start;
      if (!best || score < best.score) best = { s: s, score: score, diffDays: diffDays, live: live };
    });
    var when = best.live ? "Happening now" :
      best.diffDays === 0 ? "Today at " + timeLabel(best.s.time) :
      best.diffDays === 1 ? "Tomorrow at " + timeLabel(best.s.time) :
      DAYS[best.s.day] + " at " + timeLabel(best.s.time);
    return { name: best.s.name, when: when };
  }

  function siteBase() {
    if (C.websiteUrl) return C.websiteUrl.replace(/\/$/, "");
    return location.origin + location.pathname.replace(/index\.html$/, "").replace(/\/$/, "");
  }

  /* ---------- data ---------- */
  function sampleDevotionals() {
    var today = londonNow().date;
    return [0, 1, 2].map(function (i) {
      return {
        date: addDays(today, -i),
        title: "Sample devotional " + (i + 1),
        scripture: "Romans 12:2 (KJV): And be not conformed to this world: but be ye transformed by the renewing of your mind.",
        body: "This is sample text so you can see how a devotional looks.\n\nType real devotionals into the Devotionals tab of the RPM Hub Google Sheet and they will appear here automatically on their date.",
        prayer: "Sample prayer text.",
        confession: "Sample confession text.",
        sample: true
      };
    });
  }
  function sampleEvents() {
    return [{ date: addDays(londonNow().date, 10), time: "", title: "[Sample event]", location: "", description: "Events typed into the Events tab of the Sheet will show here.", link: "" }];
  }

  function api(action, params) {
    if (!C.apiUrl) return Promise.resolve(null);
    var q = "?action=" + encodeURIComponent(action);
    Object.keys(params || {}).forEach(function (k) { q += "&" + k + "=" + encodeURIComponent(params[k]); });
    var key = "cache:" + action + JSON.stringify(params || {});
    return fetch(C.apiUrl + q).then(function (r) { return r.json(); }).then(function (j) {
      if (!j || !j.ok) throw new Error((j && j.error) || "Request failed");
      store(key, j.data);
      return j.data;
    }).catch(function () {
      var cached = store(key);
      if (cached) return cached;
      throw new Error("offline");
    });
  }
  window.RPM_API_POST = function (body) {
    if (!C.apiUrl) return Promise.resolve({ ok: true, preview: true });
    return fetch(C.apiUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(body)
    }).then(function (r) { return r.json(); });
  };

  function getDevotionals() {
    return api("devotionals").then(function (d) { return d || sampleDevotionals(); })
      .catch(function () { return []; });
  }
  function getDevotional(date) {
    if (!C.apiUrl) {
      var s = sampleDevotionals().filter(function (x) { return !date || x.date === date; });
      return Promise.resolve(s[0] || null);
    }
    return api("devotional", date ? { date: date } : {}).catch(function () { return null; });
  }
  function getSermons() { return api("sermons").then(function (d) { return d || []; }).catch(function () { return []; }); }
  function getEvents() { return api("events").then(function (d) { return d || sampleEvents(); }).catch(function () { return []; }); }

  /* ---------- pieces ---------- */
  function whatsappChannelButton(label) {
    var link = safeUrl(C.whatsapp && C.whatsapp.channelLink);
    if (!link) return "";
    return '<a class="btn whatsapp" href="' + esc(link) + '" target="_blank" rel="noopener">' + icon("chat") + esc(label || "Join our WhatsApp Channel") + "</a>";
  }
  function devoShareText(d) {
    return "*" + d.title + "*\n_" + d.scripture + "_\n\nRead today's devotional: " + siteBase() + "/#/devotional/" + d.date;
  }
  function devoCard(d, full) {
    if (!d) {
      return '<article class="card devo"><div class="eyebrow">Today\'s devotional</div><h2>No devotional for today yet</h2><p class="muted">Please check back later, or read a recent one below.</p></article>';
    }
    var head = '<div class="eyebrow">' + (d.sample ? "Sample devotional" : "Devotional") + '</div>' +
      '<h' + (full ? "1" : "2") + '>' + esc(d.title) + '</h' + (full ? "1" : "2") + '>' +
      '<div class="date">' + niceDate(d.date) + '</div>' +
      (d.scripture ? '<blockquote class="scripture">' + esc(d.scripture) + '</blockquote>' : "");
    if (!full) {
      return '<article class="card devo">' + head +
        '<div class="body excerpt">' + paras(d.body) + '</div>' +
        '<a class="btn secondary" href="#/devotional/' + esc(d.date) + '">Read the full devotional ' + icon("arrow") + '</a></article>';
    }
    return '<article class="card devo devo-full">' + head +
      '<div class="body">' + paras(d.body) + '</div>' +
      (d.prayer ? '<div class="block"><h3>Prayer</h3>' + paras(d.prayer) + '</div>' : "") +
      (d.confession ? '<div class="block"><h3>Confession</h3>' + paras(d.confession) + '</div>' : "") +
      '<div class="btn-row" style="margin-top:18px">' +
      '<a class="btn whatsapp" target="_blank" rel="noopener" href="https://wa.me/?text=' + encodeURIComponent(devoShareText(d)) + '">' + icon("share") + 'Share to WhatsApp</a>' +
      '<button class="btn secondary" type="button" data-copy="' + esc(d.date) + '">' + icon("copy") + 'Copy</button>' +
      '</div><p class="small muted" id="copy-msg" role="status"></p></article>';
  }
  function devoPlainText(d) {
    return d.title + "\n" + d.scripture + "\n\n" + d.body +
      (d.prayer ? "\n\nPrayer: " + d.prayer : "") +
      (d.confession ? "\n\nConfession: " + d.confession : "") +
      "\n\n" + siteBase() + "/#/devotional/" + d.date;
  }
  function videoCard(v) {
    var id = String(v.id || "").replace(/[^A-Za-z0-9_-]/g, "");
    return '<div class="video"><button class="thumb" type="button" data-video="' + id + '" aria-label="Play ' + esc(v.title) + '" style="background-image:url(\'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg\')">' +
      '<span class="play"><svg aria-hidden="true"><use href="#i-playfill"/></svg></span></button>' +
      '<div class="meta"><h3>' + esc(v.title) + '</h3><div class="small muted">' + shortDate(String(v.published || "").slice(0, 10)) + '</div></div></div>';
  }
  function eventItem(e) {
    var link = safeUrl(e.link);
    return '<li><span class="event-date">' + niceDate(e.date) + (e.time ? ", " + esc(e.time) : "") + '</span>' +
      '<h3>' + esc(e.title) + '</h3>' +
      (e.location ? '<div class="small muted">' + esc(e.location) + '</div>' : "") +
      (e.description ? paras(e.description) : "") +
      (link ? '<a href="' + esc(link) + '" target="_blank" rel="noopener">More details</a>' : "") + '</li>';
  }
  function loading(n) { var s = ""; for (var i = 0; i < (n || 3); i++) s += '<div class="skeleton"></div>'; return s; }
  function noSermons() {
    var ch = safeUrl(C.youtube && C.youtube.channelUrl);
    return '<div class="card flat"><p>Sermons will show here automatically from our YouTube channel.</p>' +
      (ch ? '<a class="btn secondary" href="' + esc(ch) + '" target="_blank" rel="noopener">' + icon("play") + 'Open YouTube</a>' : "") + '</div>';
  }

  /* ---------- pages ---------- */
  var pages = {};

  pages.home = function (el) {
    var ns = nextService();
    var logo = C.logoLight ? '<img class="hero-logo" src="' + esc(C.logoLight) + '" alt="' + esc(C.churchName) + '" onerror="this.remove();document.getElementById(\'hero-name\').hidden=false">' : "";
    el.innerHTML =
      '<section class="hero">' + logo +
      '<div class="hero-name" id="hero-name"' + (C.logoLight ? " hidden" : "") + '>' + esc(C.churchName) + '</div>' +
      (C.tagline ? '<div class="tagline">' + esc(C.tagline) + '</div>' : "") +
      (ns ? '<div class="next"><span class="small">Next service</span><strong>' + esc(ns.name) + '</strong><span>' + esc(ns.when) + '</span></div>' : "") +
      '</section>' +
      '<nav class="quick" aria-label="Quick links">' +
      '<a href="#/sermons">' + icon("play") + 'Watch</a>' +
      '<a href="#/visit">' + icon("pin") + 'Plan a visit</a>' +
      '<a href="#/give">' + icon("gift") + 'Give</a>' +
      '<a href="#/prayer">' + icon("pray") + 'Prayer</a></nav>' +
      '<div class="section-head"><h2>Today\'s devotional</h2><a href="#/devotional">Past devotionals</a></div>' +
      '<div id="h-devo">' + loading(4) + '</div>' +
      '<div class="section-head"><h2>Latest sermon</h2><a href="#/sermons">All sermons</a></div>' +
      '<div id="h-sermon">' + loading(2) + '</div>' +
      '<div class="grid grid-2" style="margin-top:24px">' +
      (whatsappChannelButton() ? '<div class="card"><h3>Daily devotional on WhatsApp</h3><p class="muted">Get each morning\'s devotional on your phone.</p>' + whatsappChannelButton() + '</div>' : "") +
      '<div class="card install" id="install-card"><h3>Install the app</h3><p class="muted" id="install-text">Add RPM to your home screen for quick access.</p><button class="btn" type="button" id="install-btn">' + icon("download") + 'Install</button></div>' +
      '</div>';
    getDevotional(londonNow().date).then(function (d) { var t = document.getElementById("h-devo"); if (t) t.innerHTML = devoCard(d, false); });
    getSermons().then(function (s) {
      var t = document.getElementById("h-sermon"); if (!t) return;
      t.innerHTML = s.length ? '<div class="grid grid-2">' + videoCard(s[0]) + '</div>' : noSermons();
    });
    setupInstall();
  };

  pages.devotional = function (el, date) {
    if (date) {
      el.innerHTML = loading(6);
      getDevotional(date).then(function (d) {
        el.innerHTML = '<p><a href="#/devotional">All devotionals</a></p>' +
          (d ? devoCard(d, true) : '<div class="card"><h1>Devotional not found</h1><p>There is no devotional for ' + niceDate(date) + '.</p></div>') +
          (whatsappChannelButton() ? '<div class="center" style="margin-top:20px">' + whatsappChannelButton() + '</div>' : "");
        if (d) document.title = d.title + " | " + C.churchName;
        bindCopy(d);
      });
      return;
    }
    el.innerHTML = '<h1>Devotional</h1><div id="d-today">' + loading(6) + '</div><div class="section-head"><h2>Archive</h2></div><ul class="archive" id="d-arch">' + loading(5) + '</ul>';
    getDevotional(londonNow().date).then(function (d) {
      var t = document.getElementById("d-today"); if (!t) return;
      t.innerHTML = devoCard(d, true); bindCopy(d);
    });
    getDevotionals().then(function (list) {
      var t = document.getElementById("d-arch"); if (!t) return;
      t.innerHTML = list.length ? list.map(function (d) {
        return '<li><a href="#/devotional/' + esc(d.date) + '"><span>' + esc(d.title) + '</span><span>' + shortDate(d.date) + '</span></a></li>';
      }).join("") : '<li class="muted">No devotionals yet.</li>';
    });
  };

  pages.sermons = function (el) {
    var ch = safeUrl(C.youtube && C.youtube.channelUrl);
    el.innerHTML = '<div class="section-head" style="margin-top:0"><h1>Sermons</h1>' + (ch ? '<a href="' + esc(ch) + '" target="_blank" rel="noopener">YouTube channel</a>' : "") + '</div><div id="s-list">' + loading(4) + '</div>';
    getSermons().then(function (s) {
      var t = document.getElementById("s-list"); if (!t) return;
      t.innerHTML = s.length ? '<div class="grid grid-2">' + s.map(videoCard).join("") + '</div>' : noSermons();
    });
  };

  pages.visit = function (el) {
    var a = C.address || {}, map = safeUrl(a.mapLink);
    el.innerHTML = '<h1>Visit us</h1>' +
      '<div class="grid grid-2">' +
      '<section class="card"><h2>Service times</h2><ul class="list-plain">' +
      (C.serviceTimes || []).map(function (s) { return '<li><strong>' + esc(s.name) + '</strong><br><span class="muted">' + DAYS[s.day] + 's at ' + timeLabel(s.time) + '</span></li>'; }).join("") +
      '</ul></section>' +
      '<section class="card"><h2>Where to find us</h2><address style="font-style:normal">' + (a.lines || []).map(esc).join("<br>") + '</address>' +
      (map ? '<p style="margin-top:14px"><a class="btn secondary" href="' + esc(map) + '" target="_blank" rel="noopener">' + icon("pin") + 'Open in Maps</a></p>' : "") +
      '</section></div>' +
      '<section class="card" style="margin-top:16px"><h2>New here?</h2><p>We would love to welcome you. When you arrive, scan the QR code at the door or use the link below to let us know you came.</p><a class="btn" href="checkin.html">' + icon("check") + 'Check in</a></section>' +
      '<section class="card" style="margin-top:16px"><h2>About us</h2>' + paras(C.about) + '</section>' +
      '<section class="card" style="margin-top:16px"><h2>' + esc(C.pastorName) + '</h2>' + paras(C.pastorBio) + '</section>' +
      (C.contactEmail ? '<p style="margin-top:16px">Questions? Email <a href="mailto:' + esc(C.contactEmail) + '">' + esc(C.contactEmail) + '</a></p>' : "");
  };

  pages.events = function (el) {
    el.innerHTML = '<h1>Events</h1><div class="card"><ul class="list-plain" id="e-list">' + loading(4) + '</ul></div>';
    getEvents().then(function (list) {
      var t = document.getElementById("e-list"); if (!t) return;
      t.innerHTML = list.length ? list.map(eventItem).join("") : '<li class="muted">No upcoming events at the moment.</li>';
    });
  };

  pages.prayer = function (el) {
    el.innerHTML = '<h1>Prayer request</h1><p class="muted">Share what is on your heart and our prayer team will pray with you.</p>' +
      '<form class="card" id="prayer-form" novalidate>' +
      '<div class="field"><label for="p-name">Your name (optional)</label><input id="p-name" name="name" type="text" autocomplete="name" maxlength="100"></div>' +
      '<div class="field"><label for="p-req">Prayer request</label><textarea id="p-req" name="request" required maxlength="3000"></textarea></div>' +
      '<div class="field"><label class="check"><input type="checkbox" name="teamOnly" checked> Keep this private to the prayer team</label></div>' +
      '<div class="hp" aria-hidden="true"><label for="p-web">Leave this empty</label><input id="p-web" name="website" type="text" tabindex="-1" autocomplete="off"></div>' +
      '<p class="small muted">See our <a href="privacy.html">privacy notice</a> for how we look after your request.</p>' +
      '<button class="btn block" type="submit">Send prayer request</button>' +
      '<div id="p-msg" role="status"></div></form>';
    var f = document.getElementById("prayer-form");
    f.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var msg = document.getElementById("p-msg"), req = f.request.value.trim();
      if (!req) { msg.innerHTML = '<div class="notice err">Please write your prayer request.</div>'; f.request.focus(); return; }
      var btn = f.querySelector("button[type=submit]"); btn.disabled = true; btn.textContent = "Sending...";
      window.RPM_API_POST({ action: "prayer", name: f.name.value.trim(), request: req, teamOnly: f.teamOnly.checked, website: f.website.value })
        .then(function (r) {
          if (!r.ok) throw new Error(r.error || "failed");
          f.reset();
          msg.innerHTML = '<div class="notice ok">Thank you. Your request has been received and we are praying with you.' + (r.preview ? " (Preview mode: nothing was saved.)" : "") + '</div>';
        })
        .catch(function () { msg.innerHTML = '<div class="notice err">Sorry, that did not send. Please check your connection and try again.</div>'; })
        .then(function () { btn.disabled = false; btn.textContent = "Send prayer request"; });
    });
  };

  pages.give = function (el) {
    var link = safeUrl(C.givingLink);
    el.innerHTML = '<h1>Give</h1><div class="card">' + paras(C.givingText) +
      (link ? '<a class="btn" href="' + esc(link) + '" target="_blank" rel="noopener">' + icon("gift") + 'Give online</a>' : '<p class="muted">Online giving details coming soon.</p>') + '</div>';
  };

  pages.more = function (el) {
    el.innerHTML = '<h1>More</h1><nav class="card more-links" aria-label="More">' +
      '<a href="#/events">' + icon("cal") + 'Events</a>' +
      '<a href="#/prayer">' + icon("pray") + 'Prayer request</a>' +
      '<a href="#/give">' + icon("gift") + 'Give</a>' +
      '<a href="checkin.html">' + icon("check") + 'Check in at a service</a>' +
      (safeUrl(C.whatsapp && C.whatsapp.channelLink) ? '<a href="' + esc(C.whatsapp.channelLink) + '" target="_blank" rel="noopener">' + icon("chat") + 'WhatsApp Channel</a>' : "") +
      '<a href="privacy.html">' + icon("shield") + 'Privacy notice</a></nav>' +
      '<div class="card install" id="install-card" style="margin-top:16px"><h3>Install the app</h3><p class="muted" id="install-text">Add RPM to your home screen.</p><button class="btn" type="button" id="install-btn">' + icon("download") + 'Install</button></div>';
    setupInstall();
  };

  /* ---------- behaviour ---------- */
  function bindCopy(d) {
    var b = document.querySelector("[data-copy]");
    if (!b || !d) return;
    b.addEventListener("click", function () {
      var m = document.getElementById("copy-msg");
      var done = function () { if (m) m.textContent = "Copied. You can paste it anywhere."; };
      if (navigator.clipboard) navigator.clipboard.writeText(devoPlainText(d)).then(done, function () { if (m) m.textContent = "Could not copy on this device."; });
    });
  }

  document.addEventListener("click", function (e) {
    var t = e.target.closest && e.target.closest("[data-video]");
    if (!t) return;
    var id = t.getAttribute("data-video");
    var f = document.createElement("iframe");
    f.src = "https://www.youtube-nocookie.com/embed/" + id + "?autoplay=1&rel=0";
    f.title = t.getAttribute("aria-label") || "Sermon video";
    f.allow = "accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen";
    f.allowFullscreen = true;
    t.replaceWith(f);
  });

  var deferredPrompt = null;
  window.addEventListener("beforeinstallprompt", function (e) { e.preventDefault(); deferredPrompt = e; setupInstall(); });
  function setupInstall() {
    var card = document.getElementById("install-card");
    if (!card) return;
    var standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
    if (standalone) return;
    var ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    var btn = document.getElementById("install-btn");
    if (deferredPrompt) {
      card.classList.add("show");
      btn.onclick = function () { deferredPrompt.prompt(); deferredPrompt.userChoice.then(function () { deferredPrompt = null; card.classList.remove("show"); }); };
    } else if (ios) {
      card.classList.add("show");
      btn.hidden = true;
      document.getElementById("install-text").textContent = "On iPhone: tap the Share button in Safari, then choose Add to Home Screen.";
    }
  }

  function renderChrome() {
    var brand = document.getElementById("brand");
    if (brand) {
      brand.innerHTML = C.logoDark ? '<img src="' + esc(C.logoDark) + '" alt="" onerror="this.outerHTML=\'<span class=wordmark>' + esc(C.churchName) + '</span>\'">' : '<span class="wordmark">' + esc(C.churchName) + '</span>';
    }
    var foot = document.getElementById("foot");
    if (foot) {
      var s = C.social || {}, links = [];
      [["facebook", "Facebook"], ["instagram", "Instagram"], ["youtube", "YouTube"], ["tiktok", "TikTok"]].forEach(function (p) {
        if (safeUrl(s[p[0]])) links.push('<a href="' + esc(s[p[0]]) + '" target="_blank" rel="noopener">' + p[1] + '</a>');
      });
      foot.innerHTML = '<div><strong>' + esc(C.churchName) + '</strong></div>' +
        (links.length ? '<div class="socials">' + links.join("") + '</div>' : "") +
        '<div><a href="privacy.html">Privacy notice</a></div>';
    }
    var r = document.documentElement.style, col = C.colours || {};
    if (col.ink) r.setProperty("--ink", col.ink);
    if (col.accent) r.setProperty("--accent", col.accent);
    if (col.paper) r.setProperty("--paper", col.paper);
  }

  function route() {
    var parts = (location.hash.replace(/^#\/?/, "") || "home").split("/");
    var name = pages[parts[0]] ? parts[0] : "home";
    var el = document.getElementById("app");
    document.title = C.churchName || "Renewed Purpose Ministry";
    var navKey = { events: "more", prayer: "more", give: "more" }[name] || name;
    document.querySelectorAll("[data-nav]").forEach(function (a) {
      var on = a.getAttribute("data-nav") === name || (a.closest(".bottom-nav") && a.getAttribute("data-nav") === navKey);
      if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    pages[name](el, parts[1] && /^\d{4}-\d{2}-\d{2}$/.test(parts[1]) ? parts[1] : null);
    window.scrollTo(0, 0);
    if (location.hash) el.focus({ preventScroll: true });
  }

  window.RPM = { esc: esc, londonNow: londonNow, toMins: toMins, store: store, safeUrl: safeUrl, timeLabel: timeLabel, DAYS: DAYS };

  if (document.body.getAttribute("data-page") === "app") {
    renderChrome();
    window.addEventListener("hashchange", route);
    route();
  }

  if ("serviceWorker" in navigator && location.protocol === "https:") {
    window.addEventListener("load", function () { navigator.serviceWorker.register("sw.js").catch(function () {}); });
  }
})();
