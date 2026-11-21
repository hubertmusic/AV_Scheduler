import mongoose from 'mongoose';

const { Schema, model, Types } = mongoose;
const ref = (name) => ({ type: Schema.Types.ObjectId, ref: name });

export const PERMS = ['edit', 'approve', 'message', 'resources', 'people', 'groups', 'plans', 'vault'];
export const EVENT_KINDS = ['service', 'soundcheck', 'rehearsal'];
// What a team does decides which parts of Crew Call it sees (gear, media, outside groups… are AV's)
export const TEAM_KINDS = ['av', 'music', 'other', 'office'];
// Church Admin (office team): kinds of calendar items
export const OFFICE_TYPES = ['board', 'business', 'committee', 'deadline', 'event', 'other'];
export const REQUEST_TYPES = ['swap', 'transfer', 'pickup', 'drop'];
// Kinds of reusable files in the media library
export const LIBRARY_CATEGORIES = ['Backgrounds', 'Countdowns', 'Logos & bumpers', 'Announcement loops', 'Other'];

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    phone: { type: String, default: '' }, // digits only, country code included
    passwordHash: { type: String, default: '' },
    role: { type: String, enum: ['admin', 'leader', 'crew'], default: 'crew' },
    leaderTitle: { type: String, default: '' },
    perms: {
      edit: { type: Boolean, default: false },
      approve: { type: Boolean, default: false },
      message: { type: Boolean, default: false },
      resources: { type: Boolean, default: false },
      people: { type: Boolean, default: false },
      groups: { type: Boolean, default: false },
      plans: { type: Boolean, default: false },
      vault: { type: Boolean, default: false },
    },
    positions: { type: [String], default: [] },
    trainee: { type: [String], default: [] }, // positions they're learning (can shadow)
    leads: { type: [String], default: [] }, // trained positions where they're the most experienced (Lead)
    // Regular commitments, e.g. 2nd Sabbath of the month at Worship Service (lib/regulars.js)
    regulars: {
      type: [
        new Schema(
          {
            week: { type: String, default: 'every' },
            anchor: { type: String, default: '' },
            service: { type: String, default: '' }, // '' = any service that weekend
            positions: { type: [String], default: [] }, // [] = any position they're trained for
            note: { type: String, default: '' },
          },
          { _id: true }
        ),
      ],
      default: [],
    },
    maxPerMonth: { type: Number, default: 0 }, // 0 = no limit (legacy; per team in teams[])
    // The teams this person is on, with their role in each. The admin (role 'admin') is over all.
    teams: {
      type: [
        new Schema(
          {
            team: { type: String, required: true }, // Team.key
            role: { type: String, enum: ['leader', 'crew'], default: 'crew' },
            head: { type: Boolean, default: false }, // the team's leader: manages its people and leaders
            title: { type: String, default: '' },
            perms: {
              edit: { type: Boolean, default: false },
              approve: { type: Boolean, default: false },
              message: { type: Boolean, default: false },
              resources: { type: Boolean, default: false },
              people: { type: Boolean, default: false },
              groups: { type: Boolean, default: false },
              plans: { type: Boolean, default: false },
              vault: { type: Boolean, default: false }, // open and keep the team's vault (head leaders always can)
            },
            maxPerMonth: { type: Number, default: 0 }, // 0 = no limit
            // Office teams: the committees they sit on, and offices they hold (Secretary of the
            // Finance Committee; committee '' = the whole team), with when the term ends
            committees: { type: [String], default: [] },
            offices: {
              type: [new Schema({ committee: { type: String, default: '' }, role: { type: String, required: true }, termEnds: { type: String, default: '' } }, { _id: false })],
              default: [],
            },
          },
          { _id: false }
        ),
      ],
      default: [],
    },
    // Asked to join a team by its leaders (Church Admin): it isn't on their profile until they accept
    teamInvites: {
      type: [new Schema({ team: { type: String, required: true }, from: { type: Schema.Types.ObjectId, ref: 'User' }, at: { type: Date, default: Date.now } }, { _id: false })],
      default: [],
    },
    availabilityUpdatedAt: Date,
    lastLoginAt: Date,
    lastSeenAt: Date,
    lastDevice: { type: String, default: '' },
    calLastFetchedAt: Date,
    calClient: { type: String, default: '' },
    calToken: { type: String, index: true },
    sessionVersion: { type: Number, default: 0 }, // raised to sign this person out on every device
    inviteToken: { type: String, index: true },
    inviteExpires: Date,
    // "Forgot password?" and sign-in help: a one-time reset link (only a hash is kept)
    resetHash: { type: String, index: true },
    resetExpires: Date,
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

const positionSchema = new Schema({
  key: { type: String, required: true, unique: true },
  label: { type: String, required: true, trim: true },
  order: { type: Number, default: 0 },
  team: { type: String, default: 'av', index: true }, // Team.key
});

// A ministry team with its own people, positions and leaders (AV, Praise…). Services, plans,
// songs and the calendar are shared between teams.
const teamSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    name: { type: String, required: true, trim: true },
    kind: { type: String, enum: TEAM_KINDS, default: 'other' },
    groupLink: { type: String, default: '' }, // the team's WhatsApp group
    order: { type: Number, default: 0 },
    // Office teams: rooms (services: the room services and rehearsals use), calendar reminders
    // on meetings people are invited to, and the yearly rhythm to fill each year's calendar from
    rooms: { type: [new Schema({ name: String, services: { type: Boolean, default: false } }, { _id: false })], default: [] },
    // The room request link anyone can use without an account (/reserve/<token>)
    requestLink: { token: { type: String, default: '' }, on: { type: Boolean, default: false }, madeAt: Date },
    remindMinutes: { type: Number, default: 60 },
    remindDays: { type: Number, default: 1 },
    yearPlan: {
      type: [
        new Schema(
          {
            title: { type: String, required: true },
            type: { type: String, enum: OFFICE_TYPES, default: 'event' },
            month: { type: Number, min: 1, max: 12, required: true },
            day: { type: Number, default: 0 }, // a day of the month, or 0 to use nth + weekday
            nth: { type: Number, default: 1 }, // 1–4, or -1 = last
            weekday: { type: Number, default: 6 }, // 0 Sunday … 6 Sabbath
            start: { type: String, default: '' },
            end: { type: String, default: '' },
            committees: { type: [String], default: [] },
            visibility: { type: String, default: 'office' },
          },
          { _id: true }
        ),
      ],
      default: [],
    },
  },
  { timestamps: true }
);

const eventSchema = new Schema(
  {
    date: { type: String, required: true, index: true }, // YYYY-MM-DD, local to the org's time zone
    title: { type: String, required: true, trim: true },
    start: { type: String, required: true }, // HH:mm
    call: { type: String, required: true }, // HH:mm — when crew arrive
    end: { type: String, required: true }, // HH:mm
    needs: { type: [String], default: [] }, // position keys
    notes: { type: String, default: '' },
    kind: { type: String, enum: EVENT_KINDS, default: 'service' },
    team: { type: String, default: null }, // whose rehearsal or meeting this is; null = a service for everyone
    groups: [ref('Group')], // outside groups taking part (e.g. praise team at a sound check)
    forEvent: ref('Event'), // sound check: the service it prepares for
    manual: { type: Boolean, default: false }, // added by hand, not from the template
    // Archived before the Monday it would archive by itself ("Archive this weekend")
    archivedAt: { type: Date, default: null },
    archivedBy: ref('User'),
    planDeletedAt: { type: Date, default: null }, // its plan and files were deleted when archived
    office: ref('OfficeEvent'), // a Church Admin event that asked for AV
  },
  { timestamps: true }
);

// Outside groups the AV team coordinates with: praise team, choir, guest musicians, speakers.
// They don't sign in; they're contacts you message on WhatsApp.
const memberSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    phone: { type: String, default: '' },
    role: { type: String, default: '' }, // e.g. "Keys", "Vocals"
  },
  { _id: false }
);
const groupSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    contactName: { type: String, default: '' },
    phone: { type: String, default: '' }, // contact's WhatsApp number
    groupLink: { type: String, default: '' }, // WhatsApp group invite link
    notes: { type: String, default: '' }, // e.g. "Needs 4 vocal mics, DI for keys"
    members: { type: [memberSchema], default: [] },
  },
  { timestamps: true }
);

const assignmentSchema = new Schema(
  {
    event: { ...ref('Event'), required: true },
    position: { type: String, required: true },
    user: { ...ref('User'), required: true },
    confirmedAt: Date,
    reminderEmailAt: Date, // email reminder sent
    waRemindedAt: Date, // a leader marked the WhatsApp reminder as sent
    viaRegular: { type: String, default: '' }, // placed automatically by a regular schedule, e.g. "2nd Sabbath"
  },
  { timestamps: true }
);
// position is a position key, or "<key>+shadow" for a trainee shadowing that position
assignmentSchema.index({ event: 1, position: 1 }, { unique: true });
assignmentSchema.index({ user: 1 });

const unavailableSchema = new Schema({
  user: { ...ref('User'), required: true },
  event: { ...ref('Event'), required: true },
});
unavailableSchema.index({ user: 1, event: 1 }, { unique: true });

// Date ranges someone is away (inclusive, YYYY-MM-DD)
const blackoutSchema = new Schema(
  {
    user: { ...ref('User'), required: true, index: true },
    from: { type: String, required: true },
    to: { type: String, required: true },
    note: { type: String, default: '' },
  },
  { timestamps: true }
);

// What people do in the app. Only the admin can read it. Kept for 180 days.
const activitySchema = new Schema(
  {
    user: ref('User'),
    who: { type: String, default: '' }, // name at the time (or a guest's name)
    kind: { type: String, enum: ['login', 'login-failed', 'view', 'calendar', 'change', 'guest', 'system'], required: true },
    action: { type: String, required: true },
    page: { type: String, default: '' },
    device: { type: String, default: '' },
    ip: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now },
  },
  { versionKey: false }
);
activitySchema.index({ user: 1, createdAt: -1 });
activitySchema.index({ createdAt: -1 }); // entries older than 180 days are removed daily (lib/reminders.js)

const requestSchema = new Schema(
  {
    type: { type: String, enum: REQUEST_TYPES, required: true },
    from: { ...ref('User'), required: true },
    event: { ...ref('Event'), required: true },
    position: { type: String, required: true },
    targetUser: ref('User'), // transfer: who gets it; swap: who holds the other shift
    targetEvent: ref('Event'), // swap only
    targetPosition: String, // swap only
    note: { type: String, default: '' },
    status: { type: String, enum: ['pending', 'approved', 'denied', 'cancelled'], default: 'pending', index: true },
    reason: { type: String, default: '' },
    decidedBy: ref('User'),
    decidedAt: Date,
  },
  { timestamps: true }
);

const resourceSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    url: { type: String, default: '' },
    position: { type: String, default: '' }, // '' = general
    team: { type: String, default: 'av' }, // whose training and help this is
    kind: { type: String, default: 'Link' },
    minutes: { type: Number, default: 0 },
  },
  { timestamps: true }
);

const templateItem = new Schema(
  {
    day: { type: Number, min: 0, max: 2, required: true }, // 0 = Friday, 1 = Sabbath, 2 = Sunday
    title: { type: String, required: true },
    start: String,
    call: String,
    end: String,
    needs: [String],
    kind: { type: String, enum: EVENT_KINDS, default: 'service' },
    groups: [ref('Group')],
    off: { type: Boolean, default: false }, // kept in the template but not built for now
  },
  { _id: false }
);

const settingsSchema = new Schema({
  key: { type: String, default: 'main', unique: true },
  orgName: { type: String, default: 'AV Crew' },
  timezone: { type: String, default: 'America/New_York' },
  countryCode: { type: String, default: '1' },
  groupLink: { type: String, default: '' }, // WhatsApp group invite link, optional
  logo: { type: String, default: '' }, // stored file name of the church logo (bulletin)
  streamFooter: { type: String, default: '' }, // added to every livestream description
  features: { type: Schema.Types.Mixed, default: {} }, // extra features the admin turned on (Settings → Extra features)
  checklists: { type: Schema.Types.Mixed, default: {} }, // { positionKey: ['Check mic batteries', …] }
  burnoutWeeks: { type: Number, default: 4 }, // warn after this many weekends in a row (0 = off)
  logoAt: { type: Date, default: null },
  weekendTemplate: { type: [templateItem], default: [] },
  reminderEmails: { type: Boolean, default: true },
  reminderDays: { type: Number, default: 2 },
  calendarAlertDays: { type: Number, default: 5 }, // calendar alert this many days before a shift (0 = off)
  autoBuildWeeks: { type: Number, default: 4 }, // build weekends from the template this many weeks ahead (0 = off)
  idleMinutes: { type: Number, default: 90 }, // sign people out after this long without activity (0 = never)
  endOnBrowserClose: { type: Boolean, default: true }, // sign-in lasts only until the browser is closed
  // Shown at the top of every shift until changed
  permanentNote: { type: String, default: '' },
  migrations: { type: [String], default: [] }, // one-time data updates already applied
  vaultCheck: { type: String, default: '' }, // a known value encrypted with the vault key, to notice a wrong key
  permanentNoteAt: Date,
  permanentNoteBy: { type: String, default: '' },
});

// One announcement per weekend (keyed by its Friday); only shows on that weekend's shifts.
const announcementSchema = new Schema(
  {
    friday: { type: String, required: true, unique: true },
    text: { type: String, default: '' },
    updatedByName: { type: String, default: '' },
  },
  { timestamps: true }
);

// ---------- service plans ----------
const scriptureSchema = new Schema(
  {
    reference: { type: String, required: true }, // e.g. "John 3:16-17"
    version: { type: String, default: '' }, // e.g. "KJV"
    text: { type: String, default: '' },
  },
  { _id: false }
);
const planSongSchema = new Schema(
  {
    song: { ...ref('Song'), required: true },
    key: { type: String, default: '' },
    note: { type: String, default: '' },
  },
  { _id: false }
);
// One line of the order of service. Times come from the service start plus the minutes before it.
export const ORDER_KINDS = ['item', 'song', 'scripture', 'prayer', 'sermon', 'heading'];
const orderItemSchema = new Schema({
  kind: { type: String, enum: ORDER_KINDS, default: 'item' },
  title: { type: String, default: '' },
  who: { type: String, default: '' },
  minutes: { type: Number, default: 0 },
  notes: { type: String, default: '' }, // cues for the platform and crew; never in the bulletin
  bulletin: { type: Boolean, default: true }, // listed in the congregation's bulletin
});

const planSchema = new Schema(
  {
    event: { ...ref('Event'), required: true, unique: true },
    speaker: { type: String, default: '' },
    sermonTitle: { type: String, default: '' },
    notes: { type: String, default: '' }, // pastor's notes
    scriptures: { type: [scriptureSchema], default: [] },
    songs: { type: [planSongSchema], default: [] },
    assets: [ref('Media')], // media library items used in this service (backgrounds, countdowns…)
    order: { type: [orderItemSchema], default: [] }, // order of service (optional)
    announcements: { type: String, default: '' }, // bulletin only
    // Songs to sample or play (beta): Spotify, Apple Music and YouTube links, in order
    playlist: { type: [new Schema({ url: String, title: String, note: String, addedBy: String }, { _id: false })], default: [] },
    // Live run-of-show: { startedAt, index, itemAt, endedAt, log: [{ index, title, at }] }
    live: { type: Schema.Types.Mixed, default: null },
    inputs: { type: [Schema.Types.Mixed], default: [] }, // input list: [{ ch, source, mic, stand, notes }]
    // Share links: the rundown is for the platform and crew, the bulletin for the congregation.
    rundownToken: { type: String, index: true, sparse: true },
    bulletinToken: { type: String, index: true, sparse: true },
    updatedBy: ref('User'),
  },
  { timestamps: true }
);

const songSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    artist: { type: String, default: '' },
    ccli: { type: String, default: '' },
    lyrics: { type: String, default: '' }, // section labels on their own lines: Verse 1, Chorus…
    notes: { type: String, default: '' },
    proMedia: ref('Media'), // the ProPresenter .pro file, if one was uploaded
    lyricsUpdatedAt: Date,
    // Hidden from the library and pickers but kept, because past services used it
    retired: { type: Boolean, default: false },
    updatedBy: ref('User'),
  },
  { timestamps: true }
);

const mediaSchema = new Schema(
  {
    plan: ref('Plan'),
    song: ref('Song'),
    storedName: { type: String, required: true },
    originalName: { type: String, required: true },
    mime: { type: String, default: 'application/octet-stream' },
    size: { type: Number, default: 0 },
    title: { type: String, default: '' },
    uploadedBy: ref('User'),
    guest: ref('GuestLink'),
    status: { type: String, enum: ['approved', 'pending', 'rejected'], default: 'approved' },
    // A reusable media library item, not owned by one service
    library: { type: Boolean, default: false },
    category: { type: String, default: '' },
    sha256: { type: String, default: '' }, // fingerprint, to spot the same file uploaded twice
    // hot = the uploads folder; cold = ARCHIVE_DIR, where files of long-past services are moved
    location: { type: String, enum: ['hot', 'cold'], default: 'hot' },
    movedAt: Date,
    purgedAt: Date, // file deleted to save space; the record stays so the plan still lists it
  },
  { timestamps: true }
);
mediaSchema.index({ plan: 1 });
mediaSchema.index({ library: 1 });
mediaSchema.index({ sha256: 1 });

// A 4-hour upload link for someone outside the team (guest speaker, visiting band).
const guestLinkSchema = new Schema(
  {
    token: { type: String, required: true, unique: true },
    event: { ...ref('Event'), required: true },
    name: { type: String, required: true },
    note: { type: String, default: '' },
    createdBy: ref('User'),
    // Schedule: guests can add and change things from opensAt until closesAt. After that it's
    // locked, and anything new or changed waits for a leader's approval, until expiresAt.
    opensAt: Date,
    closesAt: Date,
    expiresAt: { type: Date, required: true },
    revoked: { type: Boolean, default: false },
    // 6-digit code the guest enters with the link ('' on links made before codes existed)
    code: { type: String, default: '' },
    codeVersion: { type: Number, default: 0 }, // raised with each new code, so earlier sign-ins stop working
    codeTries: { type: Number, default: 0 }, // wrong codes in a row
    standing: ref('StandingLink'), // made by a weekly link for this service
  },
  { timestamps: true }
);

// A permanent weekly link for someone who sends things every week (pastor, worship leader).
// Opening it goes to the next matching service's guest page, with a deadline before it.
const standingLinkSchema = new Schema(
  {
    token: { type: String, required: true, unique: true },
    name: { type: String, required: true, trim: true },
    note: { type: String, default: '' },
    serviceTitle: { type: String, default: '' }, // '' = any service
    deadlineDays: { type: Number, default: 2 }, // days before the service…
    deadlineTime: { type: String, default: '18:00' }, // …at this time
    code: { type: String, required: true },
    revoked: { type: Boolean, default: false },
    createdBy: ref('User'),
  },
  { timestamps: true }
);
export const StandingLink = model('StandingLink', standingLinkSchema);

// Anything a guest sends. Nothing reaches the plan until a leader approves it.
const submissionSchema = new Schema(
  {
    event: { ...ref('Event'), required: true },
    guest: { ...ref('GuestLink'), required: true },
    kind: { type: String, enum: ['note', 'scripture', 'song', 'media'], required: true },
    data: { type: Schema.Types.Mixed, default: {} },
    media: ref('Media'),
    // draft: only the guest sees it · live: in the service plan · pending: sent after the
    // window closed, waiting for a leader · approved (older links) · rejected
    status: { type: String, enum: ['draft', 'live', 'pending', 'approved', 'rejected'], default: 'pending', index: true },
    applied: { type: Schema.Types.Mixed, default: null }, // what it added to the plan, so edits can update it
    replaces: ref('Submission'), // a late change to a live item, waiting for approval
    decidedBy: ref('User'),
    decidedAt: Date,
  },
  { timestamps: true }
);
submissionSchema.index({ event: 1 });

// A flow-chart board: boxes, notes and people joined by lines (Planning tab, admin and leaders)
const boardSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    nodes: { type: [Schema.Types.Mixed], default: [] },
    edges: { type: [Schema.Types.Mixed], default: [] },
    rev: { type: Number, default: 0 }, // bumps on every save, so two people can't overwrite each other unknowingly
    team: { type: String, default: 'av', index: true }, // whose board this is
    shared: { type: Boolean, default: false }, // shown to every team's leaders
    createdBy: ref('User'),
    updatedBy: ref('User'),
  },
  { timestamps: true, minimize: false }
);
export const Board = model('Board', boardSchema);

export const Plan = model('Plan', planSchema);

// A saved order of service. With serviceTitle set, new plans for services of that name start from it.
const orderTemplateSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    serviceTitle: { type: String, default: '' },
    order: { type: [orderItemSchema], default: [] },
    createdBy: ref('User'),
  },
  { timestamps: true }
);
export const OrderTemplate = model('OrderTemplate', orderTemplateSchema);

// Gear the crew checks out and returns (wireless mics, camera bag, spare batteries…)
const gearSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    category: { type: String, default: '' },
    notes: { type: String, default: '' },
    holder: ref('User'), // who has it now
    holderName: { type: String, default: '' }, // or someone outside the crew
    outAt: { type: Date, default: null },
    attention: { type: String, default: '' }, // what's wrong with it, '' = fine
    batteryAt: { type: Date, default: null },
  },
  { timestamps: true }
);
export const Gear = model('Gear', gearSchema);

const gearLogSchema = new Schema(
  {
    gear: { ...ref('Gear'), required: true, index: true },
    action: { type: String, enum: ['out', 'in', 'battery', 'note', 'attention', 'fixed'], required: true },
    text: { type: String, default: '' },
    by: ref('User'),
  },
  { timestamps: true }
);
export const GearLog = model('GearLog', gearLogSchema);

// Pre-service checklist ticks: one per service, position and item
const checklistTickSchema = new Schema(
  {
    event: { ...ref('Event'), required: true },
    position: { type: String, required: true },
    item: { type: String, required: true },
    user: ref('User'),
  },
  { timestamps: true }
);
checklistTickSchema.index({ event: 1, position: 1, item: 1 }, { unique: true });
export const ChecklistTick = model('ChecklistTick', checklistTickSchema);

// Problem reports: the fix list
const issueSchema = new Schema(
  {
    title: { type: String, required: true },
    details: { type: String, default: '' },
    event: ref('Event'),
    gear: ref('Gear'),
    reportedBy: ref('User'),
    status: { type: String, enum: ['open', 'fixed'], default: 'open' },
    fixedBy: ref('User'),
    fixedAt: Date,
    fixNote: { type: String, default: '' },
  },
  { timestamps: true }
);
export const Issue = model('Issue', issueSchema);

// After-service check-in, one per person per service
const debriefSchema = new Schema(
  {
    event: { ...ref('Event'), required: true },
    user: { ...ref('User'), required: true },
    wentWell: { type: String, default: '' },
    problems: { type: String, default: '' },
    ideas: { type: String, default: '' },
  },
  { timestamps: true }
);
debriefSchema.index({ event: 1, user: 1 }, { unique: true });
export const Debrief = model('Debrief', debriefSchema);

// A Lead (or the admin) signing off a learner on a position
const signOffSchema = new Schema(
  {
    user: { ...ref('User'), required: true, index: true },
    position: { type: String, required: true },
    by: ref('User'),
    event: ref('Event'),
    note: { type: String, default: '' },
  },
  { timestamps: true }
);
export const SignOff = model('SignOff', signOffSchema);
export const Song = model('Song', songSchema);
export const Media = model('Media', mediaSchema);
export const GuestLink = model('GuestLink', guestLinkSchema);
export const Submission = model('Submission', submissionSchema);

export const User = model('User', userSchema);
export const Position = model('Position', positionSchema);
export const Team = model('Team', teamSchema);
export const Event = model('Event', eventSchema);
export const Group = model('Group', groupSchema);
export const Assignment = model('Assignment', assignmentSchema);
export const Unavailable = model('Unavailable', unavailableSchema);
export const Blackout = model('Blackout', blackoutSchema);
export const Activity = model('Activity', activitySchema);
export const Announcement = model('Announcement', announcementSchema);
export const Request = model('Request', requestSchema);
export const Resource = model('Resource', resourceSchema);
export const Settings = model('Settings', settingsSchema);

// A template service left out of one weekend ("no Vespers this week"), so Build and
// Sync don't put it back.
const skipSchema = new Schema(
  {
    date: { type: String, required: true },
    title: { type: String, required: true },
    by: ref('User'),
  },
  { timestamps: true }
);
skipSchema.index({ date: 1, title: 1 }, { unique: true });
export const Skip = model('Skip', skipSchema);
// ---------- Church Admin (office teams) ----------
// Who can see an office item: its committees (empty = the whole team) plus any committees it's
// shared with (read-only). "everyone" calendar items also show to the other teams.
const audience = {
  team: { type: String, required: true, index: true },
  committees: { type: [String], default: [] },
  sharedWith: { type: [String], default: [] },
};

const committeeSchema = new Schema(
  {
    team: { type: String, required: true, index: true },
    key: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    color: { type: String, default: 'blue' },
    quorum: { type: Number, default: 0 }, // people needed for a vote; 0 = not tracked
    order: { type: Number, default: 0 },
  },
  { timestamps: true }
);
committeeSchema.index({ team: 1, key: 1 }, { unique: true });
export const Committee = model('Committee', committeeSchema);

// A repeating calendar item ("2nd Tuesday of every month"); its dates are real OfficeEvents
const officeSeriesSchema = new Schema(
  {
    team: { type: String, required: true },
    freq: { type: String, enum: ['weekly', 'monthly-nth', 'monthly-day', 'yearly'], required: true },
    interval: { type: Number, default: 1 },
    weekday: Number,
    nth: Number,
    monthDay: Number,
    first: { type: String, required: true }, // the first date
    until: { type: String, default: '' }, // last date, or '' = keeps going (filled a year ahead)
    filledTo: { type: String, default: '' },
    template: { type: Schema.Types.Mixed, default: {} }, // fields copied onto each new date
    createdBy: ref('User'),
  },
  { timestamps: true }
);
export const OfficeSeries = model('OfficeSeries', officeSeriesSchema);

const agendaItemSchema = new Schema(
  {
    kind: { type: String, enum: ['item', 'heading'], default: 'item' },
    title: { type: String, default: '' },
    presenter: { type: String, default: '' },
    minutes: { type: Number, default: 0 },
    notes: { type: String, default: '' },
  },
  { _id: true }
);
const motionSchema = new Schema(
  {
    text: { type: String, required: true },
    movedBy: { type: String, default: '' },
    secondedBy: { type: String, default: '' },
    result: { type: String, enum: ['passed', 'failed', 'tabled', 'withdrawn'], default: 'passed' },
    votesFor: { type: Number, default: 0 },
    votesAgainst: { type: Number, default: 0 },
    abstain: { type: Number, default: 0 },
  },
  { _id: true, timestamps: true }
);

const officeEventSchema = new Schema(
  {
    ...audience,
    type: { type: String, enum: OFFICE_TYPES, default: 'event' },
    title: { type: String, required: true, trim: true },
    date: { type: String, required: true, index: true },
    start: { type: String, default: '' }, // '' with allDay
    end: { type: String, default: '' },
    allDay: { type: Boolean, default: false },
    room: { type: String, default: '' },
    notes: { type: String, default: '' },
    visibility: { type: String, enum: ['office', 'everyone'], default: 'office' },
    attendees: { type: [new Schema({ user: ref('User'), role: { type: String, default: '' } }, { _id: false })], default: [] },
    rsvps: { type: [new Schema({ user: ref('User'), status: { type: String, enum: ['yes', 'no', 'maybe'] }, at: Date }, { _id: false })], default: [] },
    series: ref('OfficeSeries'),
    // Meetings
    agenda: { type: [agendaItemSchema], default: [] },
    agendaSentAt: Date,
    minutes: { type: String, default: '' },
    present: [ref('User')],
    guests: { type: String, default: '' }, // others present, by name
    minutesOpen: { type: Boolean, default: false }, // a leader let anyone in the meeting take minutes
    minutesBy: ref('User'),
    minutesApprovedAt: Date,
    minutesApprovedBy: ref('User'),
    motions: { type: [motionSchema], default: [] },
    // Extras
    needsAv: { type: Boolean, default: false },
    avNote: { type: String, default: '' },
    bulletin: {
      service: ref('Event'),
      text: { type: String, default: '' },
      status: { type: String, enum: ['', 'pending', 'added', 'declined'], default: '' },
      decidedBy: ref('User'),
      decidedAt: Date,
    },
    fromRequest: ref('OfficeRequest'),
    createdBy: ref('User'),
    updatedBy: ref('User'),
  },
  { timestamps: true }
);
export const OfficeEvent = model('OfficeEvent', officeEventSchema);

const goalSchema = new Schema(
  {
    ...audience,
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    owner: ref('User'),
    start: { type: String, default: '' }, // YYYY-MM-DD
    due: { type: String, default: '' },
    status: { type: String, enum: ['not-started', 'on-track', 'behind', 'done'], default: 'not-started' },
    milestones: {
      type: [new Schema({ title: { type: String, required: true }, due: { type: String, default: '' }, owner: ref('User'), done: { type: Boolean, default: false }, doneAt: Date }, { _id: true })],
      default: [],
    },
    events: [ref('OfficeEvent')],
    createdBy: ref('User'),
  },
  { timestamps: true }
);
export const Goal = model('Goal', goalSchema);

const actionItemSchema = new Schema(
  {
    ...audience,
    title: { type: String, required: true, trim: true },
    notes: { type: String, default: '' },
    owner: ref('User'),
    due: { type: String, default: '' },
    done: { type: Boolean, default: false },
    doneAt: Date,
    meeting: ref('OfficeEvent'),
    goal: ref('Goal'),
    remindedOn: { type: String, default: '' }, // the day its last reminder email went out
    createdBy: ref('User'),
  },
  { timestamps: true }
);
export const ActionItem = model('ActionItem', actionItemSchema);

// Bylaws, policies, forms… a link or an uploaded file
export const DOC_CATEGORIES = ['Bylaws', 'Policies', 'Forms', 'Minutes', 'Reports', 'Other'];
const officeDocSchema = new Schema(
  {
    ...audience,
    title: { type: String, required: true, trim: true },
    category: { type: String, enum: DOC_CATEGORIES, default: 'Other' },
    url: { type: String, default: '' },
    file: { stored: String, originalName: String, mime: String, size: Number },
    notes: { type: String, default: '' },
    createdBy: ref('User'),
  },
  { timestamps: true }
);
export const OfficeDoc = model('OfficeDoc', officeDocSchema);

// Someone asks for a church event or a room, signed in or through the room request link. It goes
// on the next board meeting's agenda; office leaders approve or decline.
const officeRequestSchema = new Schema(
  {
    team: { type: String, required: true, index: true }, // the office team it goes to
    source: { type: String, enum: ['member', 'link'], default: 'member' },
    from: { name: { type: String, default: '' }, email: { type: String, default: '' }, phone: { type: String, default: '' } }, // link requests
    people: { type: Number, default: 0 }, // about how many are coming
    meeting: ref('OfficeEvent'), // the board meeting whose agenda it's on (null: waiting for one)
    agendaItem: Schema.Types.ObjectId,
    title: { type: String, required: true, trim: true },
    date: { type: String, required: true },
    start: { type: String, default: '' },
    end: { type: String, default: '' },
    room: { type: String, default: '' },
    notes: { type: String, default: '' },
    needsAv: { type: Boolean, default: false },
    requestedBy: ref('User'),
    status: { type: String, enum: ['pending', 'approved', 'declined'], default: 'pending' },
    reply: { type: String, default: '' },
    decidedBy: ref('User'),
    decidedAt: Date,
    event: ref('OfficeEvent'),
  },
  { timestamps: true }
);
export const OfficeRequest = model('OfficeRequest', officeRequestSchema);

// ---------- team vaults and personal notes (secrets are encrypted: lib/secrets.js) ----------
export const VAULT_CATEGORIES = ['Streaming', 'Software & licenses', 'Accounts', 'Wi-Fi & network', 'Devices', 'Other'];
const vaultEntrySchema = new Schema(
  {
    team: { type: String, required: true, index: true },
    title: { type: String, required: true, trim: true },
    category: { type: String, enum: VAULT_CATEGORIES, default: 'Other' },
    url: { type: String, default: '' },
    username: { type: String, default: '' }, // encrypted
    secret: { type: String, default: '' }, // encrypted
    notes: { type: String, default: '' }, // encrypted
    leadersOnly: { type: Boolean, default: false }, // never shared with crew, even with access
    createdBy: ref('User'),
    updatedBy: ref('User'),
  },
  { timestamps: true }
);
export const VaultEntry = model('VaultEntry', vaultEntrySchema);

// Crew access to a team's vault, given by its leaders: everything (not leaders-only) or chosen
// entries, until a time or with no end
const vaultGrantSchema = new Schema(
  {
    team: { type: String, required: true, index: true },
    user: { ...ref('User'), required: true },
    all: { type: Boolean, default: true },
    entries: [ref('VaultEntry')],
    expiresAt: { type: Date, default: null }, // null = until taken back
    grantedBy: ref('User'),
  },
  { timestamps: true }
);
export const VaultGrant = model('VaultGrant', vaultGrantSchema);

// Who opened what, for the team's leaders
const vaultLogSchema = new Schema(
  {
    team: { type: String, required: true, index: true },
    user: ref('User'),
    action: { type: String, enum: ['viewed', 'added', 'changed', 'removed', 'granted', 'revoked', 'asked'], required: true },
    entry: ref('VaultEntry'),
    entryTitle: { type: String, default: '' },
    detail: { type: String, default: '' },
  },
  { timestamps: true }
);
export const VaultLog = model('VaultLog', vaultLogSchema);

// Personal notes: private to the person who wrote them unless they share one with a whole team
// they're on, or with chosen people (who can read it, not change it). The body is encrypted.
const noteSchema = new Schema(
  {
    user: { ...ref('User'), required: true, index: true },
    title: { type: String, default: '', trim: true },
    body: { type: String, default: '' }, // encrypted
    pinned: { type: Boolean, default: false },
    shareTeams: { type: [String], default: [], index: true }, // Team.key: everyone on that team can read it
    shareUsers: { type: [{ type: Schema.Types.ObjectId, ref: 'User' }], default: [], index: true },
  },
  { timestamps: true }
);
export const Note = model('Note', noteSchema);

export { Types };
