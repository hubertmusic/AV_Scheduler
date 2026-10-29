# Crew Call — AV volunteer scheduler

A self-hosted scheduler for an AV crew of 20–50 people (and more). It runs as three containers: React front end behind nginx, a Node/Express API, and MongoDB.

What it does:

- **Weekend schedule grid.** Services down the side, positions across the top. Click a cell to see who's trained and free, ranked by how many shifts they already have this weekend. Optionally jump straight to the next open spot after each placement. Double-booked or unavailable people get flagged.
- **Weekend template.** One click builds Friday Vespers and the Sabbath services, with their call times and the positions each needs. You can still add one-off services.
- **Sound checks.**
  - Add one from the 🎙 button on any service. It fills in times just before the crew call and can place the service's FOH and stream crew on it automatically.
  - Sound checks can also live in the weekend template, so they're built along with the services every week.
- **Outside groups.**
  - The Groups page holds the praise team, choir, guest musicians and anyone else you coordinate with. Each group can have a contact person, a WhatsApp group link, tech notes and members.
  - Groups don't need accounts.
  - Attach groups to sound checks or services. One 💬 tap then gets you the message for the group contact, the group chat and the assigned crew.
- **Service plans.** Each service has:
  - a sermon title and speaker
  - the pastor's notes
  - Bible texts (KJV, WEB and ASV look up automatically; any other version can be pasted)
  - an ordered song list with keys
  - media (photos, videos, audio, slides, documents, up to 80 MB each)

  Everyone signed in can read and download a plan. People with the **Edit service plans** privilege can change it.
- **Song library and ProPresenter.**
  - Each song's lyrics download as a `.txt` that ProPresenter 7 imports. Section labels such as Verse 1 or Chorus become groups.
  - You can store the song's real `.pro` file with it so anyone can download it. If the lyrics are edited after the `.pro` was uploaded, the app flags it.
  - **Download for ProPresenter** on a plan gives one zip with every song (`.txt`, plus `.pro` where stored), the Bible texts and the notes.
- **Guest upload links.** For a guest speaker or visiting group:
  - The link only lets them send files, notes, Bible texts and lyrics for that one service.
  - It stops working after 4 hours. You can make another link any time.
  - Nothing reaches the plan until a leader approves it.
- **Announcements.** Three levels, shown at the top of every shift (My shifts, the schedule, Weekend check, run sheets), in reminder emails and in everyone's calendar entries:
  - **Permanent:** stays until you change or clear it.
  - **Weekly:** only on that weekend's shifts, then drops off on its own.
  - **For this shift:** the important note on an individual service.

  Only the admin and leaders who edit the schedule can change announcements. **Share on WhatsApp** posts them to your crew group.
- **Regular schedules.** On **Team & roles**, give someone a pattern, such as the 2nd Sabbath of the month, the last Sabbath, every weekend or every other weekend. Set which service it's for (or any) and which jobs (or any of their trained positions, so their job can change). Auto-fill places regulars first and lists any it couldn't place, for example because they're away. Crew see their regular schedule on My shifts.
- **Sync with template.** After you edit the weekend template in Settings, **Sync with template** on the Schedule adds missing services to a weekend that's already built. It lists services whose times or positions changed and offers to update them, and lists services you removed or turned off in the template and offers to take them off that weekend. Services you added by hand with **Add service** are never offered for removal.
- **Skip a week.** To skip one service for one weekend (no Vespers this week), open it with the pencil and remove it. To skip a whole weekend, use **No services this weekend**. Skipped services show under **Not happening this weekend** with a **Bring back** button, and Sync with template won't put them back. Other weekends aren't affected.
- **Turn template services on or off.** Each template service has an On/Off switch. An Off service keeps its settings but isn't built until you turn it back on.
- **Auto-fill.** One button fills every open spot. It only uses people trained for the spot, free that day and under their monthly limit, and spreads shifts evenly. You see the full list first and can untick anyone before it places them. A sound check gets the same person as its service.
- **Availability.**
  - Crew add the date ranges they'll be away and the most shifts they can do in a month.
  - Away people never appear as options. Auto-fill skips them, and the schedule flags them if they're already placed.
  - **Weekend check** shows who hasn't updated their availability in 30 days, with a button to ask them on WhatsApp.
- **Confirmations.** Crew tap **Confirm** on each shift. If the spot changes hands, the new person has to confirm again.
- **Weekend check.** One screen listing what's left for the weekend:
  - open spots, with Auto-fill
  - unconfirmed people, with a WhatsApp nudge
  - anyone away or double-booked
  - services missing songs, notes or Bible texts
  - requests and guest uploads waiting for approval
  - stale availability
  - a WhatsApp reminder checklist that ticks people off as you message them
- **Email reminders.** Each person gets one email per shift, sent automatically a set number of days before it. The email has the call time, crew, songs and a Confirm link. This needs an SMTP account (see below).
- **Run sheets.** One printable page per service: crew with phones and confirmations, the linked sound check, songs and keys (lyrics optional), Bible texts, the pastor's notes and the media list.
- **Copy last weekend.** Creates the same services and puts the same people back in empty spots. It skips anyone now away, unavailable or no longer trained, and says why.
- **Trainee shadows.** Mark the positions someone is learning, then add them as a shadow beside the person on that position. Shadow shifts show in their My shifts and calendar.
- **Load report.** Team & roles shows each person's shifts in the last 90 days, how many are coming up, and their monthly limit.
- **Activity (admin only).** Your account gets:
  - a live ticker under the tabs
  - an Activity page with who's been seen, signed in, synced their calendar, viewed pages and made changes
  - a filterable feed of everything, including failed sign-ins, guest uploads and reminder emails

  Entries are kept for 180 days.
- **Home-screen app.** On a phone, use Share → Add to Home Screen. There's no service worker, so updates show up straight away.
- **Shift requests.** Crew can ask to swap, transfer, drop, or pick up an open shift. Leaders approve or deny. If the schedule changed since the request was made, approval is refused with a reason rather than corrupting anything.
- **Calendar feeds.** Each person gets a private subscription link for Apple Calendar or Google Calendar. Approved changes show up there automatically.
- **WhatsApp.** Lineups, reminders and invites open WhatsApp with the message already written. You tap Send. This needs no Meta business account and costs nothing.
- **Roles.** Admin (you), team leaders and crew. You choose each leader's privileges: edit the schedule, approve requests, message the crew, manage training links, manage crew and positions, manage outside groups.
- **Resources & help.** Training links per position, a *Quick review* button on each shift, and one-tap WhatsApp contact for leaders.
- **Availability.** Crew mark services they can't make. Leaders see this when placing people.

---

## 1. First start

```bash
cp .env.example .env
# edit .env: set MONGO_PASSWORD and JWT_SECRET (openssl rand -hex 32), and PUBLIC_URL
docker compose up -d --build
```

1. Open `http://<server>:8780`. The first visit asks you to create the admin account.
2. Go to **Settings** and check the weekend template, positions and time zone.
3. Go to **Team & roles** → **Add person** for each volunteer. Each one gets an invite link you can send on WhatsApp. The link works for 14 days.
4. Go to **Schedule** → **Build this weekend**, then click cells to place people.

## 2. Public access through a Cloudflare Tunnel

Point the tunnel's public hostname at `http://localhost:8780` (or whatever `WEB_PORT` you set). Then update `.env` and apply the change:

```env
PUBLIC_URL=https://crew.yourdomain.org
COOKIE_SECURE=true
```

```bash
docker compose up -d
```

`PUBLIC_URL` controls two things: the invite links and the calendar feed addresses. Phones and Google Calendar must be able to reach the calendar feed from the internet. So until `PUBLIC_URL` is your public https address, subscribing from a phone or from Google won't work.

## 3. How calendar sync works

Crew Call is the source of truth. Each person's feed (`/cal/<private-token>.ics`) always reflects their current shifts.

- **Apple Calendar.** Subscribe once and the feed refreshes on its own. On a Mac you can set the calendar's Auto-refresh to every 5 or 15 minutes. iPhones refresh on their own schedule.
- **Google Calendar.** Google re-reads subscribed calendars on its own schedule, often every several hours. Changes can take that long to appear.
- **Leaked links.** If someone shares their link by mistake, they can make a new one under **My shifts**. The old link stops working.

Each calendar event starts at the call time, includes the crew list and notes, and has a one-hour alert.

## 4. WhatsApp

WhatsApp only lets other apps open a chat with a message pre-filled; the person still taps Send. Buttons that use this:

- **Send lineup** and the 💬 button on each service open a sheet with one *Open chat* button per crew member, plus *Share to a group…*, which lets you pick your crew group.
- If you paste your group's invite link in **Settings**, the sheet adds *Copy & open crew group*.

Phone numbers are stored with the country code (10-digit numbers get the default code from Settings, `1` for the US).

To switch to fully automatic sending later (Meta Cloud API or Twilio), everything goes through the `WaSheet` component and `waLink()` in `web/src/`. A server-side sender can replace those without touching the rest of the app.

## 5. Email reminders (optional)

1. Add `SMTP_URL` and `MAIL_FROM` to `.env`.
   - For Gmail, turn on 2-step verification, create an App Password and use `smtps://you%40gmail.com:APP_PASSWORD@smtp.gmail.com:465`.
   - Any SMTP service works the same way (Fastmail, SendGrid, Brevo, your church's mail server).
2. Run `docker compose up -d`.
3. In **Settings → Shift reminders**, press **Send me a test**.

Reminders are checked every 15 minutes. Each shift gets one email, sent the number of days you choose before its call time. Without email set up, use the WhatsApp reminder list on **Weekend check**.

## 6. ProPresenter workflow

1. In **Service plans → Songs**, add or edit the song. Put each section label on its own line and leave a blank line between slides.
2. Click **.txt** on the song, or **Download for ProPresenter** for the whole service.
3. In ProPresenter 7, go to **File → Import** and pick the `.txt`. In the import window's parsing settings, set the delimiter so each blank-line-separated block becomes one slide. Labels like Verse 1, Chorus or Bridge become groups.
4. Style the presentation, save it, then upload the `.pro` back onto the song so the next person can download the finished file.

Crew Call doesn't write `.pro` files itself. The format is undocumented, and generating it risks files that ProPresenter can't open.

**What the exports contain**

- **Download for ProPresenter** (a zip): each song as an importable `.txt` plus its stored `.pro`, `Bible texts.txt`, `Service notes.txt`, a `Media` folder with every approved upload exactly as it was uploaded (pictures, videos, PDFs, the pastor's own slide decks), and a PowerPoint of the service.
- **PowerPoint**: 16:9 slides, white text on black: a title slide (pastor's notes in its speaker notes), each song's title and lyric slides, the Bible texts broken between verses, then each picture full screen. Videos and documents aren't put in the deck; they're in the zip's Media folder. Open it in PowerPoint or Keynote, or bring it into ProPresenter with **File → Import → PowerPoint**.

## 7. Accounts and guests

- **Crew and leaders** each have their own account. Add people on **Team & roles**, send each one their invite link, and they set a password. Any number can be signed in at once.
- **Outside guests** don't get accounts. On a service plan, use **Guest upload links**. Each link works for 4 hours (`GUEST_LINK_HOURS`) and can be turned off early. Guests see only their own uploads.
- **Approving guest uploads.** The **Service plans** tab shows a badge when guest uploads are waiting for approval.

### View as (admin)

Use **View as…** in the top bar to see Crew Call exactly as one person sees it: their tabs, their shifts, the phone numbers they can see, and the buttons they're allowed to use. A blue banner shows whose view you're in. Nothing can be changed while previewing, either in the app or on the server. Their private calendar link stays hidden. Choose **Switch person** or **Exit preview** in the banner.

### Booth Crew Academy sign-in

Crew use their Crew Call account for Booth Crew Academy too. They don't make a second account.

- **Open the Academy** (on **Resources & help**), and any resource that links to the Academy, signs them straight in there.
- **First visit:** the Academy makes them a volunteer account. Set roles and crews in the Academy as usual.
- **Already have an Academy account with the same email?** They type their Academy password once to connect the two, and keep their progress.
- **Signed out of Crew Call?** They sign in to Crew Call first, then go on to the Academy page they tapped.
- **Turned off in Crew Call?** They can't get into the Academy through Crew Call any more. Turn them off in the Academy as well if they also have an Academy password.

Behind the scenes, Crew Call gives the Academy a pass signed with a secret the two apps share. Each pass lasts 60 seconds and works once. No passwords move between the apps.

To set it up, add the same secret to both `.env` files and install the Academy add-on (`bca-crew-call-signin`):

```
ACADEMY_URL=https://practiceav.fyi
ACADEMY_SSO_SECRET=<openssl rand -hex 32>
```

## 8. Backups

```bash
# back up (writes into ./backups)
docker compose exec mongo sh -c 'mongodump --quiet --archive=/backups/crewcall-$(date +%F).gz --gzip -u "$MONGO_INITDB_ROOT_USERNAME" -p "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin --db crewcall'

# restore
docker compose exec mongo sh -c 'mongorestore --drop --archive=/backups/crewcall-YYYY-MM-DD.gz --gzip -u "$MONGO_INITDB_ROOT_USERNAME" -p "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin'
```

Uploaded media and `.pro` files live in the `uploads` volume. To back them up:

```bash
docker run --rm -v crew-call_uploads:/data -v "$PWD/backups":/backups alpine tar czf /backups/uploads-$(date +%F).tgz -C /data .
```

To restore them:

```bash
docker run --rm -v crew-call_uploads:/data -v "$PWD/backups":/backups alpine tar xzf /backups/uploads-YYYY-MM-DD.tgz -C /data
```

To back up automatically, add the backup commands to a nightly cron job on the host.

## 9. Updating

```bash
docker compose up -d --build
```

There's no service worker, and `index.html` is served with `no-cache`, so browsers pick up a new build on the next reload.

## 10. Moving to a Raspberry Pi

MongoDB 5 and later need an ARMv8.2 CPU:

- **Raspberry Pi 5:** runs `mongo:7`.
- **Raspberry Pi 4:** can't run `mongo:7` (its CPU is ARMv8.0). Either change the image to `mongo:4.4.18`, the last version that runs there, or keep MongoDB on the Mac mini.

To move the data, run the backup command on the old machine, copy the archive to the new one, and restore it there.

## 11. Development

```bash
# terminal 1: MongoDB on localhost:27017 (e.g. docker run -p 27017:27017 mongo:7)
cd api && npm install && JWT_SECRET=dev-secret-dev-secret-dev-secret-00 npm run dev
# terminal 2
cd web && npm install && npm run dev      # http://localhost:5173, proxies /api and /cal
```

To run the end-to-end API check, point it at an **empty** database:

```bash
cd api && BASE_URL=http://localhost:4000 node test/smoke.mjs
```

It covers:

- setup and invites
- weekend building and placement
- the calendar feed
- transfer, pick-up and swap approvals
- stale-request refusal
- leader privileges
- availability
- resources
- deactivation

## Project layout

```
docker-compose.yml   mongo + api + web (nginx)
api/src/
  index.js           Express app, routes, error handling
  auth.js            sign-in, first-run setup, invites, sessions (httpOnly cookie)
  models.js          User, Position, Event, Assignment, Unavailable, Request, Resource, Settings
  routes/            events, weekend (auto-fill, copy, check, run sheet), activity, requests, people, groups, plans (plans, songs, media, guest links, approvals), guest (public upload page), misc
  lib/               permissions, ICS builder, response shapes
web/src/
  App.jsx            sign-in flow, tabs, shared context
  pages/             Schedule, WeekendCheck, AutoFill, RunSheet, Activity, MyShifts, Plans, Songs, Guest, Requests, Groups, Team, Resources, Settings, Account, Auth
  ui.jsx             Modal, WhatsApp sheet, icons, avatars
```

## Security notes

- **Passwords and sessions.** Passwords are hashed with bcrypt. Sessions are a signed httpOnly cookie lasting 30 days.
- **Rate limiting.** Sign-in, setup and invite acceptance are rate-limited per visitor (Cloudflare's `CF-Connecting-IP`, when present).
- **Admin-only actions.** Only the admin can change roles and leader privileges, or reset a leader's password.
- **Leaders' scope.** Leaders with *Manage crew* can invite and edit crew members only.
- **Phone numbers.** Crew see leaders' phone numbers. Everyone else's numbers are visible only to people allowed to message the crew or manage people.
- **Deactivation.** Deactivating someone signs them out, frees their upcoming shifts and cancels their open requests.
- **Uploads.** Files are stored under random names and served with `nosniff`. Only images, video, audio and PDFs open in the browser; everything else (HTML, SVG, scripts) downloads instead of running.
- **Guest links.** Each link is a long random token tied to one service. It expires (4 hours by default), is rate-limited, and is capped at 40 files and 60 notes or texts. Guest uploads stay hidden from crew until a leader approves them, and rejected files are deleted from disk.
