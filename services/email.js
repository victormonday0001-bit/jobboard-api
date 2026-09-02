const nodemailer = require('nodemailer');
const logger     = require('../utils/logger');

const port   = parseInt(process.env.EMAIL_PORT) || 465;
const secure = port === 465; // true for 465 (SSL), false for 587 (STARTTLS)


// Escape HTML in user-provided content used in email templates
// Prevents XSS if a user registers with <script> in their name
const esc = (str) => String(str)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const transporter = nodemailer.createTransport({
  host:   process.env.EMAIL_HOST,
  port,
  secure,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

transporter.verify((err) => {
  if (err) logger.error(`❌ Email service error: ${err.message}`);
  else     logger.info('✅ Email service ready');
});

const APP  = process.env.APP_NAME || 'JobBoard';
const FROM = `"${APP}" <${process.env.EMAIL_FROM}>`;
const URL  = process.env.APP_URL;

const template = (content) => `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width"/></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:Inter,-apple-system,sans-serif;">
  <div style="max-width:560px;margin:40px auto;padding:0 20px;">
    <div style="background:#fff;border-radius:8px;padding:40px;border:1px solid #e1e4e8;">
      <div style="margin-bottom:28px;">
        <span style="font-size:1.25rem;font-weight:800;color:#1a1a1a;">${APP}</span>
      </div>
      ${content}
      <div style="margin-top:40px;padding-top:24px;border-top:1px solid #e1e4e8;font-size:12px;color:#b3b3b3;">
        This email was sent by ${APP}. If you didn't request this, you can safely ignore it.
      </div>
    </div>
  </div>
</body>
</html>`;

const btn = (text, url) =>
  `<a href="${url}" style="display:inline-block;background:#1a8917;color:#fff;padding:12px 28px;border-radius:20px;text-decoration:none;font-weight:600;font-size:14px;margin:20px 0;">${text}</a>`;

const send = async (to, subject, html) => {
  try {
    await transporter.sendMail({ from: FROM, to, subject, html });
    logger.debug(`Email sent to ${to}: ${subject}`);
  } catch (err) {
    logger.error(`Email failed to ${to}: ${err.message}`);
    throw err;
  }
};

module.exports = {
  sendVerificationEmail: (email, name, token) =>
    send(email, `Verify your ${APP} account`, template(`
      <h2 style="font-size:20px;font-weight:700;margin-bottom:8px;">Welcome, ${esc(name)}! 👋</h2>
      <p style="color:#3d3d3d;line-height:1.6;">Please verify your email address to unlock all features.</p>
      ${btn('Verify Email Address', `${URL}/api/auth/verify-email?token=${token}`)}
      <p style="color:#757575;font-size:13px;">This link expires in 24 hours.</p>
    `)),

  sendPasswordResetEmail: (email, name, token) =>
    send(email, `Reset your ${APP} password`, template(`
      <h2 style="font-size:20px;font-weight:700;margin-bottom:8px;">Password Reset Request</h2>
      <p style="color:#3d3d3d;line-height:1.6;">Hi ${esc(name)}, click below to reset your password. This link expires in 1 hour.</p>
      ${btn('Reset Password', `${URL}/api/auth/reset-password?token=${token}`)}
    `)),

  sendApplicationConfirmation: (email, name, jobTitle, company) =>
    send(email, `Application submitted — ${jobTitle}`, template(`
      <h2 style="font-size:20px;font-weight:700;margin-bottom:8px;">Application Received ✅</h2>
      <p style="color:#3d3d3d;line-height:1.6;">Hi ${esc(name)}, your application for <strong>${jobTitle}</strong> at <strong>${esc(company)}</strong> was submitted successfully.</p>
      <p style="color:#3d3d3d;line-height:1.6;">We'll notify you when the employer reviews your application.</p>
      ${btn('View Application', `${URL}/api/applications/my`)}
    `)),

  sendApplicationStatusUpdate: (email, name, jobTitle, status, company) => {
    const statusMessages = {
      reviewing:   { emoji: '👀', msg: 'is currently being reviewed' },
      shortlisted: { emoji: '⭐', msg: 'has been shortlisted' },
      interview:   { emoji: '🎉', msg: 'has been selected for an interview' },
      offered:     { emoji: '🎊', msg: 'has received a job offer' },
      rejected:    { emoji: '📩', msg: 'was not selected at this time' },
    };
    const info = statusMessages[status] || { emoji: '📋', msg: `status is now: ${status}` };
    return send(email, `Application update — ${jobTitle}`, template(`
      <h2 style="font-size:20px;font-weight:700;margin-bottom:8px;">${info.emoji} Application Update</h2>
      <p style="color:#3d3d3d;line-height:1.6;">Hi ${esc(name)}, your application for <strong>${jobTitle}</strong> at <strong>${esc(company)}</strong> ${info.msg}.</p>
      ${btn('View Application', `${URL}/api/applications/my`)}
    `));
  },

  sendNewApplicationAlert: (email, employerName, applicantName, jobTitle) =>
    send(email, `New application — ${jobTitle}`, template(`
      <h2 style="font-size:20px;font-weight:700;margin-bottom:8px;">New Application 📋</h2>
      <p style="color:#3d3d3d;line-height:1.6;">Hi ${esc(employerName)}, <strong>${esc(applicantName)}</strong> has applied for <strong>${jobTitle}</strong>.</p>
      ${btn('Review Application', `${URL}/api/applications`)}
    `)),
};
