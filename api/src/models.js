import mongoose from 'mongoose';

const { Schema, model, Types } = mongoose;
const ref = (name) => ({ type: Schema.Types.ObjectId, ref: name });

export const PERMS = ['edit', 'approve', 'message', 'resources', 'people', 'groups', 'plans'];
export const EVENT_KINDS = ['service', 'soundcheck'];
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
    maxPerMonth: { type: Number, default: 0 }, // 0 = no limit
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
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

const positionSchema = new Schema({
  key: { type: String, required: true, unique: true },
  label: { type: String, required: true, trim: true },
  order: { type: Number, default: 0 },
});

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
    groups: [ref('Group')], // outside groups taking part (e.g. praise team at a sound check)
    forEvent: ref('Event'), // sound check: the service it prepares for
    manual: { type: Boolean, default: false }, // added by hand, not from the template
    // Archived before the Monday it would archive by itself ("Archive this weekend")
    archivedAt: { type: Date, default: null },
    archivedBy: ref('User'),
    planDeletedAt: { type: Date, default: null }, // its plan and files were deleted when archived
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
export const Song = model('Song', songSchema);
export const Media = model('Media', mediaSchema);
export const GuestLink = model('GuestLink', guestLinkSchema);
export const Submission = model('Submission', submissionSchema);

export const User = model('User', userSchema);
export const Position = model('Position', positionSchema);
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
export { Types };
