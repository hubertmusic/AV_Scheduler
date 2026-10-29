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
  guestLinkHours: Number(env.GUEST_LINK_HOURS) || 4,
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
