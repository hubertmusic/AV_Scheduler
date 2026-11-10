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
  - Bible texts. KJV, BSB (Berean Standard), WEB, ASV, YLT, Darby, BBE and Douay-Rheims look up automatically. **More translations…** searches 1,000+ more by language from the free bible.helloao.org service (for example, Spanish Reina-Valera 1909); the ones you pick are remembered on that device. Copyrighted versions (NKJV, NIV, ESV, NLT and others) are pasted. References like `1 Cor 13:4-7`, `Psalm 23` and `John 3:16-4:2` work; book names must be in English.
  - an ordered song list with keys
  - media (photos, videos, audio, slides, documents, up to 80 MB each)

  Everyone signed in can read and download a plan. People with the **Edit service plans** privilege can change it.
- **Weekly links** (Service plans → Weekly links): one permanent link and 6-digit code for people who send things every week, like the pastor or worship leader. Each time they open it, it goes to the next matching service's guest page, with the deadline a set number of days before it (e.g. 2 days before at 6 PM). New code or turn off any time.
- **Order-of-service templates:** save an order as a template; with "Start every new … plan from this", new plans for services of that name start pre-filled. Any template can also be added to a plan by hand.
- **Announcement slides:** the bulletin's announcements download as a PowerPoint for ProPresenter's pre-service loop (one slide per announcement; separate them with a blank line).
- **Livestream details:** each plan has a YouTube/Facebook title and description written from the plan, with chapter markers from the order of service's minutes, plus a standard ending set in Settings.
- **Who can cover?** In the schedule's place panel, each free, trained person has an **Ask** button (a WhatsApp message asking them to cover), and **Ask all who are free** messages them together.
- **Gear tab:** wireless mics, camera bag, batteries and anything else people borrow. Take it, give it to someone (or a guest), return it, log battery swaps and notes, and report problems; filters for checked out, needs fixing and with me.
- **Burnout watch:** anyone serving several weekends in a row (default 4, set in Settings) is flagged on Team & roles and in the month planner.
- **Planning tab** (admin and team leaders):
  - **Flow charts:** shared boards of boxes, sticky notes, decisions, text and team members joined by lines, for sketching the week. Drag from the dots on a box to connect it; double-click to edit text. Boards save on their own, and if two people edit at once, the second is shown the newer version instead of overwriting it. **Week kickoff** starts with a ready-made outline.
  - **Month planner (admin only):** every service in a month against every position, with who's available, who's unavailable and how many shifts each person has. Tiles show open spots, services without a Lead and people with room for more; select a person to see the open spots they could fill. **Fill open spots** drafts placements for the whole month, weekday services included (respecting monthly limits and unavailability, spreading shifts, preferring a Lead on each service). Nothing reaches the schedule until **Apply**. After Apply, **Let people know** lists everyone whose shifts changed, with a WhatsApp button that opens a message listing their new and removed shifts.
- **Skill levels.** On Team & roles, each position is Learning (can shadow), Capable (trained) or Lead. Auto-fill prefers a Lead on any service that doesn't have one yet.
- **Order of service (optional).** On each service plan: items in order with who and, if you want times, minutes. Crew Call works out each start time and warns when the service runs past its scheduled end. Start from a basic order, copy last week's, or add the plan's songs, Bible texts and sermon. Each line can carry cues for the team (rundown only) and can be left out of the bulletin.
- **Rundown and bulletin (beta).** Two separate links, each with a QR code, a printable page and a phone-friendly page, no sign-in needed:
  - **Service rundown — platform & crew only:** the order with times, cues and who, songs with keys, Bible texts and AV positions (names only, no phone numbers). For speakers, worship leaders and the AV team.
  - **Congregation bulletin:** the order without times or cues, sermon and speaker, Bible references, songs and the week's announcements, under your church logo (Settings → Bulletin logo). Print it full page, or as **half sheets**: two copies side by side on a landscape page, to cut in half.
  - **New link…** replaces either one; the old link and any printed QR code stop working.
- **Archive.** Each weekend moves to the archive on Monday morning (the org's time zone). Archived services leave the planning page and become read-only, so last week's slides never get mixed into this week, but nothing is deleted.
  - **Archive this weekend…** at the bottom of the planning page does it right away, so the page is a clean slate for next weekend. Pick the services, then **Save to the archive** or, for the admin only, **Delete** (removes the plans, uploaded files and guest links; songs, media library items and the schedule of who served stay). Late guest items still waiting for approval are turned down and guest links close.
  - A service saved early can be **put back on the planning page** from the Archive until its Monday.
  - The **Archive** view lists past services, newest first. Search by sermon title, speaker, song, Bible text or service name.
  - **Copy to this week** on any archived service copies its songs (with keys), Bible texts, notes, sermon title, media library items or individual files into an upcoming service. Things already there aren't added twice.
  - Deleting a file from an archived service frees the space but keeps it listed, so you can still see what was used.
- **Media library.** Backgrounds, countdowns, logo loops and announcement loops you use every week.
  - Services link to library items instead of holding their own copy. Pick them under **Media → From the media library** on a plan.
  - **Save to library** on any file in a plan moves it into the library (from an archived service it's copied).
  - Upload a file that's already in the library and the plan links to the library copy instead of storing it again.
  - Library items are in **Download for ProPresenter** and the PowerPoint, and are never archived or moved.
- **Song history.** Each song shows when it was last sung and how many times in the past year. **CCLI usage report** downloads a spreadsheet of every song sung between two dates.
  - Deleting a song that past services used *retires* it: it's hidden from the library and pickers, but archived plans still list it. **Show retired songs** → **Bring back** undoes it.
- **Cold storage (optional).** Files from services older than 90 days can move to a NAS folder. They still open from the plan, a little slower. See [Archive and cold storage](#12-archive-and-cold-storage).
- **Song library and ProPresenter.**
  - Each song's lyrics download as a `.txt` that ProPresenter 7 imports. Section labels such as Verse 1 or Chorus become groups.
  - You can store the song's real `.pro` file with it so anyone can download it. If the lyrics are edited after the `.pro` was uploaded, the app flags it.
  - **Download for ProPresenter** on a plan gives one zip with every song (`.txt`, plus `.pro` where stored), the Bible texts and the notes.
- **Guest links.** For a guest speaker or visiting group. The admin or any leader who can edit plans makes one on the service plan and sends it on WhatsApp.
  - **Link + 6-digit code.** The guest opens the link and enters the code that came with it. Eight wrong codes lock it until a leader makes a new code.
  - **Schedule.** Each link opens at a set time and locks at a deadline (by default 6 PM the evening before the service). The guest sees the service's date and times and the deadline.
  - **Before the deadline**, what they submit goes straight into the plan. They can save drafts (private until submitted), edit what they submitted, or take it back out. Their edits update the plan in place.
  - **After the deadline** it locks. New items and changes go to the leaders for approval. Or reopen the link for 30 minutes, an hour, or longer.
  - Guests only ever see what they sent. No team files, no downloads, nothing else from the plan.
- **Announcements.** Three levels, shown at the top of every shift (My shifts, the schedule, Weekend check, run sheets), in reminder emails and in everyone's calendar entries:
  - **Permanent:** stays until you change or clear it.
  - **Weekly:** only on that weekend's shifts, then drops off on its own.
  - **For this shift:** the important note on an individual service.

  Only the admin and leaders who edit the schedule can change announcements. **Share on WhatsApp** posts them to your crew group.
- **Regular schedules.** On **Team & roles**, give someone a pattern, such as the 2nd Sabbath of the month, the last Sabbath, every weekend or every other weekend. Set which service it's for (or any) and which jobs (or any of their trained positions, so their job can change). Regulars are placed **automatically** as soon as a matching weekend is built, and on weekends already built when you save their schedule, so the shift reaches their calendar early. A regular you take off by hand stays off, and anyone away or at their monthly limit is skipped (Auto-fill lists them with the reason). Crew see their regular schedule on My shifts, and their shifts are tagged Regular.
- **Build weekends ahead.** In **Settings → Weekend template**, choose how far ahead weekends are built from the template automatically (default 4 weeks; Off to build by hand). Regulars are placed as each one is built. Skipped weekends and services stay skipped.
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
- **Calendar alerts.** Each shift in a synced calendar has an alert a set number of days before (default 5, in **Settings → Shift reminders**), plus one an hour before call time. iPhone and Mac calendars can be set to drop alerts from subscribed calendars, and Google ignores them; **My shifts** shows each person how to fix that.
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
- **Outside guests** don't get accounts. On a service plan, use **Guest links**: each comes with a 6-digit code, opens and locks on a schedule, and can be reopened, given a new code, or turned off. Guests see only what they sent.
- **Approving late guest changes.** The **Service plans** tab shows a badge when something sent after a guest's deadline is waiting for approval.

### Signing out

- **Automatic.** People are signed out after 90 minutes without activity and when they close their browser. Change both on **Settings → Sign-in**. Background checks (badges, the live activity feed) don't count as activity. Some browsers reopen tabs after a restart and keep cookies; the no-activity limit still applies.
- **Sign out everywhere.** Anyone can sign themselves out on every device from **Your account**. Changing your password signs out your other devices too.
- **Admin.** Sign one person out on all devices from **Team & roles → their name → Sign out everywhere**, or everyone except you from **Settings → Sign-in → Sign everyone else out**.

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

`scripts/backup.sh` backs up the database and a copy of `.env` (it holds the database password) every time it runs, plus the uploaded files (media and `.pro` files) once a week on Mondays. It keeps 30 days and deletes older copies. Files already in cold storage live on the NAS, so back those up with the NAS's own tools.

### Nightly backups to the NAS

1. On the NAS, make a shared folder, e.g. `CrewCallBackups`, with an account that can read and write it.
2. On the server, mount it at boot (the same way as the cold-storage share, below), owned by your user:

   ```bash
   sudo apt install cifs-utils
   sudo mkdir -p /mnt/crewcall-backups
   sudo sh -c 'printf "username=NAS_USER\npassword=NAS_PASSWORD\n" > /root/.nas-crewcall-backups && chmod 600 /root/.nas-crewcall-backups'
   echo "//NAS_ADDRESS/CrewCallBackups /mnt/crewcall-backups cifs credentials=/root/.nas-crewcall-backups,uid=$(id -u),gid=$(id -g),file_mode=0600,dir_mode=0700,nofail,_netdev,x-systemd.automount 0 0" | sudo tee -a /etc/fstab
   sudo systemctl daemon-reload && sudo mount -a
   touch /mnt/crewcall-backups/.crewcall-backups
   ```

   The `.crewcall-backups` file marks the real share. If the NAS isn't mounted, the script stops instead of filling the server's disk.
3. In `.env`:

   ```env
   BACKUP_DEST=/mnt/crewcall-backups
   BACKUP_KEEP_DAYS=30
   BACKUP_UPLOADS=weekly
   ```

4. Check it, then run it once by hand:

   ```bash
   scripts/backup.sh --check
   scripts/backup.sh
   ```

5. Run it every night at 3:30 AM: `crontab -e`, then add

   ```
   30 3 * * * /srv/stacks/org/crew-call/scripts/backup.sh >> /srv/stacks/org/crew-call/backups/backup.log 2>&1
   ```

   `last-backup.txt` in the backup folder shows when the last good backup finished, and `backups/backup.log` shows any errors.

Without `BACKUP_DEST`, backups go to `./backups` on the server itself, which won't survive a dead disk.

### Restoring

```bash
C="docker compose -f docker-compose.yml -f compose.override.yaml"
# database (replaces what's there now)
$C exec -T mongo sh -c 'mongorestore --drop --archive --gzip -u "$MONGO_INITDB_ROOT_USERNAME" -p "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin' < /mnt/crewcall-backups/crewcall-db-YYYY-MM-DD-HHMM.gz
# uploaded files
$C exec -T api tar xzf - -C /data/uploads < /mnt/crewcall-backups/crewcall-uploads-YYYY-MM-DD-HHMM.tgz
```

If `.env` is lost or changed, copy back the matching `crewcall-env-*.txt`: the database only accepts the password it was first set up with.

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

## 12. Archive and cold storage

How a week's media is handled:

| Stage | When | What crew see | Where files are |
|---|---|---|---|
| Active | This weekend and anything coming up | Editable plans | `uploads` volume |
| Archived | Monday morning after the service, or **Archive this weekend** | Read-only, under **Archive**, searchable | `uploads` volume |
| Cold | `ARCHIVE_AFTER_DAYS` (90) after the service | Same; files show **In the archive** | NAS folder |
| Removed | Only if `PURGE_VIDEO_AFTER_DAYS` is set | Videos show **Removed to save space** | Deleted |

The plan record itself (who served, songs, Bible texts, sermon, notes) is never deleted. Songs' `.pro` files and media library items never move.

### Setting up cold storage on a NAS (Linux server + TerraMaster)

1. On the NAS, make a shared folder, e.g. `CrewCallArchive`, with an account that can read and write it.
2. On the server, mount it at boot. The API container runs as user `node` (uid 1000), so the mount is owned by 1000:

   ```bash
   sudo apt install cifs-utils
   sudo mkdir -p /mnt/crewcall-archive
   sudo sh -c 'printf "username=NAS_USER\npassword=NAS_PASSWORD\n" > /root/.nas-crewcall && chmod 600 /root/.nas-crewcall'
   echo '//NAS_ADDRESS/CrewCallArchive /mnt/crewcall-archive cifs credentials=/root/.nas-crewcall,uid=1000,gid=1000,file_mode=0660,dir_mode=0770,nofail,_netdev,x-systemd.automount 0 0' | sudo tee -a /etc/fstab
   sudo systemctl daemon-reload && sudo mount -a
   ```

   `nofail` keeps the server booting normally when the NAS is off.
3. Mark the folder as Crew Call's archive (only once the share is mounted):

   ```bash
   touch /mnt/crewcall-archive/.crewcall-archive
   ```

4. In `.env`, set `ARCHIVE_HOST_DIR=/mnt/crewcall-archive`, then restart Crew Call with your usual `docker compose ... up -d`.
5. As admin, open **Service plans → Media** and check the **Storage** card. **Run now** moves anything that's due.

### Setting up cold storage on a NAS (Mac mini + TerraMaster)

1. On the NAS, make a shared folder, e.g. `CrewCallArchive`, and give the Mac mini's account read/write access.
2. On the Mac mini: **Finder → Go → Connect to Server**, enter `smb://<nas-address>/CrewCallArchive`, and sign in. To reconnect it after a restart, drag the mounted share into **System Settings → General → Login Items**.
3. Mark the folder as Crew Call's archive:

   ```bash
   touch /Volumes/CrewCallArchive/.crewcall-archive
   ```

   Crew Call only uses a folder that contains this file. If the NAS isn't mounted, `/Volumes/CrewCallArchive` is just an empty local folder, and without the marker Crew Call won't fill your Mac's disk with files meant for the NAS.
4. In `.env`:

   ```env
   ARCHIVE_HOST_DIR=/Volumes/CrewCallArchive
   ARCHIVE_AFTER_DAYS=90
   PURGE_VIDEO_AFTER_DAYS=0
   ```

5. Run `docker compose up -d`. Docker Desktop shares `/Volumes` by default; if it doesn't on your Mac, add it under **Settings → Resources → File sharing**.
6. As admin, open **Service plans → Media**. The **Storage** card at the bottom shows how much is in the library, in recent services and in the archive. **Run now** moves anything that's due; otherwise it checks every 6 hours.

If the NAS is off or unmounted, nothing breaks: files stay on the Mac mini until it's back, archived files say the NAS isn't reachable when opened, and **Copy to this week** tells you which files couldn't come across.

To test the archive features against an empty database:

```bash
cd api && ARCHIVE_DIR=/tmp/cc-archive BASE_URL=http://localhost:4000 node test/archive.mjs
# the API must run with the same ARCHIVE_DIR, plus ARCHIVE_AFTER_DAYS=90 PURGE_VIDEO_AFTER_DAYS=200
```

## Project layout

```
docker-compose.yml   mongo + api + web (nginx)
api/src/
  index.js           Express app, routes, error handling
  auth.js            sign-in, first-run setup, invites, sessions (httpOnly cookie)
  models.js          User, Position, Event, Assignment, Unavailable, Request, Resource, Settings
  routes/            events, weekend (auto-fill, copy, check, run sheet), activity, requests, people, groups, plans (plans, archive, copy, songs, media, guest links, approvals), library (media library, storage), guest (public upload page), misc
  lib/               permissions, ICS builder, response shapes, archive.js (cold storage job)
web/src/
  App.jsx            sign-in flow, tabs, shared context
  pages/             Schedule, WeekendCheck, AutoFill, RunSheet, Activity, MyShifts, Plans (plans + archive), Songs, Library (media library), Guest, Requests, Groups, Team, Resources, Settings, Account, Auth
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
- **Rundown and bulletin links** are long random tokens, rate-limited, kept out of search engines, and replaceable. The rundown shows names but never phone numbers or emails.
- **Guest links.** Each link is a long random token tied to one service, plus a 6-digit code (8 wrong tries lock it; tries are also rate-limited). The code unlocks a cookie that only works for that one link, and a new code signs out anyone using the old one. Links stop working at the end of the service day (or an hour after a later deadline), are rate-limited, and are capped at 40 files and 60 notes or texts. Late uploads stay hidden from crew until a leader approves them, and rejected files are deleted from disk.
- **Sessions.** Each sign-in carries a per-person session version, so "sign out everywhere" and admin sign-outs take effect on the next request from every device.
