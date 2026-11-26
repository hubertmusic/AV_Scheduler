import nodemailer from 'nodemailer';
import { config } from '../config.js';

// SMTP_URL examples:
//   smtps://you%40gmail.com:app-password@smtp.gmail.com:465
//   smtp://apikey:SG.xxxx@smtp.sendgrid.net:587
// "json" logs messages instead of sending (for testing).
let transport = null;
if (config.smtpUrl === 'json') transport = nodemailer.createTransport({ jsonTransport: true });
else if (config.smtpUrl) transport = nodemailer.createTransport(config.smtpUrl);

export const mailerReady = () => !!transport;

export const sentForTests = [];

export async function sendMail({ to, subject, text, html }) {
  if (!transport) throw new Error('Email isn’t set up.');
  const info = await transport.sendMail({ from: config.mailFrom, to, subject, text, html });
  if (config.smtpUrl === 'json') sentForTests.push({ to, subject, text });
  return info;
}
