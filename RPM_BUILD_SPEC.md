# Renewed Purpose Ministry: Website, App, Check-in and WhatsApp Automation

Build and hosting spec for Claude Code. Product owner: Akunna. Target running cost: £0 a month (optional custom domain about £10 a year).

---

## How to use this file (for Akunna)

1. Create an empty folder, put this file in it, and open Claude Code in that folder.
2. Paste this prompt:

> Read RPM_BUILD_SPEC.md and build the whole project exactly as specified, following the build order. Work phase by phase. At each "Akunna action" step, stop, tell me exactly what to click or type, and wait for me to confirm before continuing. Do not add paid services. No emojis anywhere.

3. Claude Code does the building, pushing and deploying. Akunna only does the steps marked **Akunna action** (logins, scanning one QR code, filling in church details), because those need her accounts and phone.

---

## Goal

One installable web app (PWA) for Renewed Purpose Ministry, led by Pastor John Oyakhilome, where people can:

- read today's devotional and past devotionals
- watch sermons from the church YouTube channel
- find service times, location, events and ways to give
- submit prayer requests
- check in at services by scanning a QR code (first timers' details go straight into a Google Sheet)

And the most important automation: **every morning the devotional posts itself to the church WhatsApp Channel (and optionally the WhatsApp group) with no human involved**, with a safe fallback if anything fails.

## Stack (all free)

| Need | Tool |
|---|---|
| Website and app | Static HTML, CSS and vanilla JS as a PWA. No framework, no build step. |
| Website hosting | GitHub Pages (deployed by Claude Code with the `gh` CLI) |
| Database and admin | One Google Sheet that the church team manages |
| Back end / API | Google Apps Script bound to the Sheet, deployed as a web app with `clasp` |
| Sermons | YouTube channel RSS feed, fetched by Apps Script, cached 1 hour |
| Emails | Apps Script MailApp (free Gmail quota) |
| Scheduling | Apps Script time-driven triggers |
| WhatsApp automation | WAHA (free, open-source WhatsApp HTTP API) in Docker on an always-free cloud VM |
| HTTPS for WAHA | Caddy (automatic free TLS) + free DuckDNS subdomain |

Do not add paid services, databases or frameworks.

## Repository structure

```
/site
  index.html        main app (single page, hash-routed sections)
  checkin.html      QR check-in page
  privacy.html      privacy notice
  config.js         all church details in one place
  styles.css
  app.js
  manifest.json
  sw.js
  icons/
/apps-script
  Code.gs           API, sheet setup, emails, triggers
  WhatsApp.gs       WhatsApp publishing module
  appsscript.json
  .clasp.json
/whatsapp-server
  docker-compose.yml  WAHA + Caddy
  Caddyfile
  .env.example
  setup-vm.sh         one-command install on the VM
/scripts
  make-qr.py        generates the check-in QR code PNG and a printable A5 PDF
README.md           setup and day-to-day guide for a non-developer
RPM_BUILD_SPEC.md   this file
```

---

## Part 1: Website and app

### config.js

All church details live here with clear placeholders: church name, pastor name, Apps Script URL, YouTube channel URL and channel ID, WhatsApp Channel link, WhatsApp group invite link, address, map link, contact email, service times (day, time, name), giving link, social links, brand colours.

If the Apps Script URL is empty, the site must still render with built-in sample content so it can be previewed before the back end exists.

### index.html (mobile-first, bottom nav on phones)

- **Home**: today's devotional card, latest sermon, next service, quick buttons (Watch, Plan a visit, Give, Prayer), "Join our WhatsApp Channel" button, "Install app" prompt
- **Devotional**: full text, archive, Share to WhatsApp and Copy buttons
- **Sermons**: grid of YouTube videos, plays in an embedded player
- **Visit / About**: about the church and Pastor John, service times, address, map, "New here?" link to check-in
- **Events**
- **Prayer request form**
- **Give** (link out)

Each devotional must also have its own shareable URL (`/#/devotional/2026-11-03`) so the WhatsApp post can link to it.

### checkin.html (target of the QR code)

- Two big buttons: "I'm a regular" and "First time here"
- First-timer form: name, email, phone, how they heard, optional prayer request, consent tick for follow-up, short privacy notice with link to privacy.html
- Regulars are remembered on their phone (localStorage) so next time is one tap
- Service auto-selected from day and time in config
- `?mode=usher` shows a +/- tally counter that submits a headcount
- After a first timer submits, show a "Join our WhatsApp Channel" button

### Design

Clean, warm, modern church feel. Fast on cheap phones. Accessible (good contrast, large tap targets, screen-reader friendly). No emojis anywhere in the UI, code or messages.

---

## Part 2: Google Sheets back end (Apps Script)

### Sheet tabs (created by `setup()`)

- **Settings**: key / value pairs (media lead email, follow-up team emails, website URL, WhatsApp mode, WAHA URL, WhatsApp Channel ID, WhatsApp group ID, post time)
- **Devotionals**: Date, Title, Scripture, Body, Prayer, Confession, Status (Scheduled / Posted / Failed / Skip), PostedAt, Error
- **Attendance**: Timestamp, Service, Type (First timer / Regular / Usher count), Name, Count
- **FirstTimers**: Timestamp, Name, Email, Phone, HowHeard, PrayerRequest, ConsentFollowUp, AssignedTo, Status (New / Contacted / Member), ContactedOn
- **Events**: Date, Time, Title, Location, Description, Link
- **Prayer**: Timestamp, Name, Request, ShareWithTeamOnly
- **WhatsAppLog**: Timestamp, Target, Result, Detail
- **Dashboard**: formulas only: attendance per service date, first timers per month, follow-up status counts, devotional post success rate

Secrets (WAHA API key) go in Apps Script **Script Properties**, never in the Sheet or the repo.

### API (Apps Script web app)

GET (JSON): `devotional` (today, or `&date=`), `devotionals` (latest 30), `sermons`, `events`
POST (`text/plain` JSON body to avoid CORS preflight): `checkin`, `headcount`, `prayer`

Honeypot field for spam. Escape all sheet content before rendering.

### Other automations

- **On first-timer check-in**: welcome email (only with consent), round-robin assignment to a follow-up team member, email that person the details
- **9:00am daily**: remind any assignee whose first timer is still "New" after 3 days
- **Monthly**: delete first timers older than 12 months whose status is not Member

---

## Part 3: WhatsApp automation (most important)

### Why this design

Meta's official WhatsApp Cloud API cannot post to WhatsApp Channels at all, and its Groups API caps groups at 8 people. So the only free way to post automatically to the church Channel and group is a WhatsApp Web-based gateway. WAHA is free and open source (all former paid features are now in the free version) and is self-hosted, so church data does not pass through a third-party company.

### Risks and how the design handles them

These gateways are not approved by Meta, so a number using one can be banned. To protect the church:

- Use a **dedicated WhatsApp number** for automation (a cheap SIM), never the pastor's or the main church number
- Make that number an **admin of the Channel** and of the group, so if it is ever banned the Channel itself survives (the Channel's owner stays on the main number)
- Post **once a day**, to the Channel and at most one group. Never bulk-message individuals from this number
- Always have the **fallback** below, so a devotional is never missed

### Publishing modes (Settings tab: `WHATSAPP_MODE`)

| Mode | What happens at post time | Cost |
|---|---|---|
| `auto` (default) | Apps Script calls WAHA, which posts to the Channel and group. If it fails, falls back to `assist` automatically | £0 |
| `assist` | Media lead receives an email with the formatted post and a one-tap wa.me link to forward it | £0 |
| `off` | Website only | £0 |

### Daily flow (`publishDevotional()` trigger, default 6:00am Europe/London)

1. Find today's row in Devotionals. If none, or Status is Skip, log it and stop.
2. If Status is already Posted, stop (never double-post).
3. Build the message:
   ```
   *[Title]*
   _[Scripture]_

   [Body]

   *Prayer:* [Prayer]

   Read online: [website]/#/devotional/[date]
   ```
   Respect WhatsApp formatting (`*bold*`, `_italic_`). Keep under 4,000 characters; if longer, post the first part and link to the full text.
4. In `auto` mode, POST to WAHA `sendText` for the Channel ID and then the group ID, with `X-Api-Key` header. Use `LockService` so two runs never post twice.
5. On success, set Status to Posted with PostedAt, log to WhatsAppLog.
6. On failure, retry once after 2 minutes. If it still fails, set Status to Failed, write the error, and immediately send the media lead the `assist` email so a human can forward it.

### Health check (`checkWhatsAppHealth()` trigger, 8:00pm daily)

Call WAHA's session status. If the session is not `WORKING` (for example the phone was logged out), email the media lead and Akunna with a plain-English instruction to re-scan the QR code, before the next morning's post.

### Admin menu in the Sheet

Add a custom "RPM" menu: Post today's devotional now, Send test post to Akunna only, Check WhatsApp connection, Re-run setup.

### WAHA server

- **Host**: Oracle Cloud Always Free VM (preferred, more memory) or Google Cloud `e2-micro` free tier. Ubuntu LTS.
- **docker-compose.yml**: WAHA (lightweight NOWEB engine, sessions stored on a mounted volume so a restart does not log out) and Caddy as a reverse proxy with automatic HTTPS. `restart: unless-stopped` on both.
- **Security**: WAHA API key required on every request, dashboard password set, only ports 80 and 443 open, WAHA port not exposed directly, keys in `.env` (never committed).
- **setup-vm.sh**: installs Docker, writes `.env` from prompts, starts the stack, enables automatic security updates.
- **Domain**: free DuckDNS subdomain (for example `rpm-wa.duckdns.org`) pointing at the VM, updated by a cron job.

### Finding the IDs

After the WhatsApp session is connected, Claude Code calls WAHA's channels and groups list endpoints, shows Akunna the names, she picks the right Channel and group, and Claude Code writes the IDs into the Settings tab.

---

## Part 4: Hosting and deployment (Claude Code does this)

### Website: GitHub Pages

1. **Akunna action**: run `gh auth login` once if not already logged in.
2. Claude Code creates the repo `rpm-app`, pushes, and enables GitHub Pages from `/site` via `gh api`.
3. Optional: custom domain (CNAME file + DNS instructions for Akunna).

### Back end: Apps Script with clasp

1. **Akunna action**: create a new Google Sheet named "RPM Hub" from the church Google account, then run `clasp login` once.
2. Claude Code creates a bound script, `clasp push`, then guides Akunna to run `setup()` and `installTriggers()` once (Google needs her to approve permissions in the browser).
3. Claude Code deploys as a web app (Execute as: me, Access: anyone) and writes the URL into `config.js`, then redeploys the site.

### WhatsApp server

1. **Akunna action**: create the free Oracle Cloud (or Google Cloud) account and a DuckDNS subdomain. Claude Code gives click-by-click steps.
2. Claude Code provides the VM creation steps and the SSH command, then runs `setup-vm.sh` on the VM.
3. **Akunna action**: open the WAHA dashboard, scan the QR code with the dedicated automation phone (WhatsApp > Linked devices). Keep that phone switched on and connected occasionally.
4. Claude Code fetches the Channel and group IDs, saves them, stores the API key in Script Properties, and sends a test post to Akunna only.

### QR code

Claude Code runs `scripts/make-qr.py` to produce the check-in QR (pointing at the live `checkin.html`) as a PNG plus a printable A5 PDF with the church name and "Scan to check in".

---

## Data protection (UK GDPR)

Church attendance reveals religious belief, which is special category data.
- privacy.html explains what is collected, why, who sees it and how long it is kept
- Follow-up messages only with the consent tick
- Sheet shared only with named team members
- 12-month retention rule as above
- WhatsApp automation never messages individuals, only the Channel and group they chose to join

## Build order

1. `config.js` and static site with sample content
2. `checkin.html` and `privacy.html`
3. Apps Script: `setup()`, GET endpoints, POST endpoints
4. Connect site to the API
5. Emails and follow-up triggers
6. WhatsApp module in `assist` mode (works before the server exists)
7. WAHA server files and deployment, then switch to `auto`
8. PWA (manifest, service worker, icons)
9. Deploy site to GitHub Pages, generate the QR code
10. README covering setup, daily use ("type tomorrow's devotional into the Sheet"), and what to do if WhatsApp disconnects

## Done when

- Site is live on GitHub Pages and installable to a phone home screen
- A first-timer check-in appears in the Sheet within seconds and triggers welcome and assignment emails
- A devotional typed into the Sheet for tomorrow appears on the website tomorrow **and posts itself to the WhatsApp Channel and group at 6:00am** with no human action
- If WhatsApp posting fails, the media lead gets the forward-ready email within minutes
- If the WhatsApp session disconnects, an alert arrives the evening before
- Latest YouTube sermons show without manual updates
- Running cost is £0 a month

## Details Akunna to provide

Logo and brand colours, YouTube channel link, WhatsApp Channel link, WhatsApp group (if wanted), a dedicated automation SIM, venue address, service times, giving link, media lead and follow-up team emails, short "About us" text.
