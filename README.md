# Renewed Purpose Ministry app

The church website and phone app, service check-in, and the daily WhatsApp devotional.
Running cost: £0 a month.

| Part | Where it lives |
|---|---|
| Website and app | GitHub Pages: https://kunnab.github.io/rpm-app |
| Check-in page (QR code target) | https://kunnab.github.io/rpm-app/checkin.html |
| Usher headcount | https://kunnab.github.io/rpm-app/checkin.html?mode=usher |
| Everything the team edits | The "RPM Hub" Google Sheet |
| WhatsApp automation | WAHA server on a free cloud VM |

---

## Day-to-day use (for the church team)

### Add a devotional

1. Open the RPM Hub sheet and go to the **Devotionals** tab.
2. Add a row: **Date**, **Title**, **Scripture**, **Body**, **Prayer** and **Confession**.
   - Leave a blank line between paragraphs in Body (press Ctrl+Enter or Cmd+Enter inside the cell).
   - Set **Status** to `Scheduled`.
3. That's it. On that date:
   - it appears on the website at midnight
   - it posts itself to the WhatsApp Channel and group at about 6:00am (Google runs timers within a few minutes of the hour)

Tips:
- To stop a day posting, set its Status to `Skip`.
- Never edit **PostedAt** or **Error**. The system fills them in.
- Future devotionals stay hidden on the website until their date.

### Add an event

Add a row in the **Events** tab. Past events disappear from the site on their own.

### First timers

When someone checks in for the first time:

1. A row appears in **FirstTimers** straight away.
2. If they ticked the consent box, two emails go out:
   - they get a welcome email
   - a follow-up team member is assigned in turn and emailed their details
3. Once you've contacted them, set **Status** to `Contacted` and fill in **ContactedOn**. Set it to `Member` if they join.
4. Anyone still `New` after 3 days triggers a reminder email to the person assigned, at 9am each day.

### Prayer requests

They arrive in the **Prayer** tab.

### Dashboard

The **Dashboard** tab updates itself and shows:
- attendance per service
- first timers per month
- follow-up progress
- how reliably the devotional posted

### The RPM menu (top of the sheet)

| Menu item | What it does |
|---|---|
| Post today's devotional now | Posts immediately, for example after a late edit |
| Send test post to Akunna only | Sends to the number in `TEST_WHATSAPP_NUMBER` |
| Check WhatsApp connection | Shows whether the WhatsApp server is connected |
| Set WhatsApp server key | Stores the server key privately |
| Install daily timers | Run again after changing `POST_TIME` |
| Re-run setup | Repairs the tabs and headings. It never deletes data. |

---

## If WhatsApp stops working

You'll know because an email titled **"Action needed: church WhatsApp is disconnected"** arrives at 8pm.

1. On a computer, open the dashboard address in the email (`https://<your-subdomain>.duckdns.org/dashboard`).
2. Log in with username `rpm` and the dashboard password.
3. Open the `default` session. If a QR code shows, keep the page open.
4. On the automation phone, open WhatsApp, go to **Settings**, then **Linked devices**, then **Link a device**, and scan the code.
5. Wait for **WORKING**, then use **RPM menu > Send test post to Akunna only** to confirm.

If posting fails in the morning anyway, nothing is missed. The media lead gets an email titled **"Please post today's devotional to WhatsApp"**:

- **Group:** tap the green button and choose the group.
- **Channel:** copy the text in the email and paste it into the Channel.

Look after the automation phone:
- Keep it charged.
- Open WhatsApp on it at least once every couple of weeks, because linked devices can drop if the main phone is offline for 14 days.

### WhatsApp modes

Set `WHATSAPP_MODE` in the **Settings** tab:

| Mode | What happens |
|---|---|
| `auto` | Posts by itself. If that fails, falls back to the email. |
| `assist` | Emails the media lead each morning with the post ready to forward. |
| `off` | Website only. |

### Safety rules for the automation number

- Use a dedicated SIM, never the pastor's or the main church number.
- Make that number an **admin** (not owner) of the Channel and group. The owner stays the main church number, so if the automation number is ever banned the Channel survives.
- Never use the automation number to message individuals.

---

## Settings tab reference

| Key | Meaning |
|---|---|
| CHURCH_NAME | Name used in emails |
| MEDIA_LEAD_EMAIL | Gets the forward-ready email and connection alerts |
| ADMIN_ALERT_EMAIL | Also gets connection alerts |
| FOLLOW_UP_EMAILS | Follow-up team, comma separated. New first timers are shared out in turn. |
| WEBSITE_URL | `https://kunnab.github.io/rpm-app` |
| WHATSAPP_MODE | `auto`, `assist` or `off` |
| WAHA_URL | `https://<subdomain>.duckdns.org` |
| WAHA_SESSION | `default` |
| WHATSAPP_CHANNEL_ID | Ends in `@newsletter` |
| WHATSAPP_GROUP_ID | Ends in `@g.us` (optional) |
| TEST_WHATSAPP_NUMBER | For test posts, e.g. `447700900000` |
| POST_TIME | Hour for the daily post (default 6). Run "Install daily timers" after changing. |
| YOUTUBE_CHANNEL_ID | Starts with `UC`. Feeds the Sermons page. |
| WELCOME_EMAIL_SUBJECT / BODY | Welcome email for first timers. `{name}` and `{service}` are filled in. |

The WhatsApp server key is not in the sheet. It is stored privately in the script (Script Properties).

---

## Changing church details on the website

Edit `site/config.js`. It holds:
- name and tagline
- address and map link
- service times
- links for giving, YouTube, WhatsApp and social media
- About text
- colours

Push to GitHub and the site updates within a minute or two.

The logos live in `site/icons/`:
- `logo-black.png` for light backgrounds
- `logo-white.png` for dark backgrounds

## Data protection

Attendance reveals religious belief, so it is special category data under UK GDPR.

- `site/privacy.html` explains what is collected and why.
- Share the RPM Hub sheet only with named team members.
- Retention runs automatically on the 1st of each month:
  - first timers older than 12 months are deleted unless their Status is `Member`
  - prayer requests older than 12 months are deleted
  - names on attendance rows older than 12 months are removed, but the counts are kept

---

## Technical setup (for whoever maintains it)

```
site/            static PWA (no build step), deployed by .github/workflows/pages.yml
apps-script/     Code.gs (API, setup, emails, triggers), WhatsApp.gs (publishing)
whatsapp-server/ docker-compose.yml (WAHA + Caddy), Caddyfile, setup-vm.sh
scripts/         make-qr.py (QR PNG + A5 poster PDF)
```

**Website:** push to `main` and GitHub Actions publishes `site/`.

**Apps Script:**
1. `cd apps-script && clasp push`.
2. Deploy a new version of the web app: `clasp deploy -i <deploymentId>`. Keeping the same deployment ID keeps the same URL.
3. The web app runs as the owner, and anyone can access it.
4. The API is:
   - GET `?action=devotional[&date=YYYY-MM-DD] | devotionals | sermons | events | ping`
   - POST, with a `text/plain` JSON body: `{action: "checkin" | "headcount" | "prayer", ...}`

**WhatsApp server:**
1. Copy `whatsapp-server/` to an Ubuntu VM and run `sudo bash setup-vm.sh`.
2. It installs Docker, sets up DuckDNS, gets HTTPS through Caddy, and generates the API key and dashboard password into `.env`.
3. Only ports 80 and 443 are open. WAHA itself is never exposed directly.

Useful commands on the VM:

```
cd ~/whatsapp-server
docker compose ps          # is it running?
docker compose logs -f waha
docker compose pull && docker compose up -d   # update WAHA
```

**QR code:** `python3 scripts/make-qr.py https://kunnab.github.io/rpm-app/checkin.html` writes `qr/checkin-qr.png` and `qr/checkin-poster-A5.pdf`.
