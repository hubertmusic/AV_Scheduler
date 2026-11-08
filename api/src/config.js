const env = process.env;

export const config = {
  port: Number(env.PORT) || 4000,
  mongoUrl: env.MONGO_URL || 'mongodb://localhost:27017/crewcall',
  jwtSecret: env.JWT_SECRET || '',
  // The address people use to reach the app, e.g. https://crew.example.org
  publicUrl: (env.PUBLIC_URL || 'http://localhost:8080').replace(/\/+$/, ''),
  // true when the app is served over HTTPS (e.g. behind a Cloudflare Tunnel)
  cookieSecure: env.COOKIE_SECURE === 'true',
  uploadDir: env.UPLOAD_DIR || new URL('../uploads', import.meta.url).pathname,
  maxUploadMB: Number(env.MAX_UPLOAD_MB) || 80,
  // Cold storage for old service media, e.g. a NAS folder mounted into the container. Off when empty.
  archiveDir: (env.ARCHIVE_DIR || '').trim(),
  // Files from a service move to ARCHIVE_DIR this many days after it.
  archiveAfterDays: Math.max(1, Number(env.ARCHIVE_AFTER_DAYS) || 90),
  // Delete videos from services older than this many days (0 = keep forever). The plan record stays.
  purgeVideoAfterDays: Math.max(0, Number(env.PURGE_VIDEO_AFTER_DAYS) || 0),
  smtpUrl: env.SMTP_URL || '',
  mailFrom: env.MAIL_FROM || 'Crew Call <no-reply@localhost>',
  // Booth Crew Academy single sign-on. Both apps must share the same secret.
  academyUrl: (env.ACADEMY_URL || '').trim().replace(/\/+$/, ''),
  academySecret: env.ACADEMY_SSO_SECRET || '',
};

config.academyOn = Boolean(config.academyUrl && config.academySecret);
if (config.academyUrl && !/^https?:\/\//.test(config.academyUrl)) {
  console.error('ACADEMY_URL should start with https:// (e.g. https://practiceav.fyi). Academy sign-in is off.');
  config.academyOn = false;
}
if (config.academyUrl && config.academySecret.length < 32) {
  console.error('ACADEMY_SSO_SECRET must be at least 32 characters. Academy sign-in is off.');
  config.academyOn = false;
}

if (config.jwtSecret.length < 32) {
  console.error('JWT_SECRET must be set to a random string of at least 32 characters.');
  process.exit(1);
}
