
const axios  = require('axios');
const logger = require('../utils/logger');

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';
const BREVO_API_KEY = process.env.BREVO_API_KEY;

const APP  = process.env.APP_NAME || 'JobBoard';
const FROM_EMAIL = process.env.EMAIL_FROM;
const URL  = process.env.APP_URL;

// ── STARTUP CHECK ─────────────────────────────────────────────────
// Confirms the API key is present and valid at boot time,
// same purpose as the old transporter.verify() call.
const verifyEmailService = async () => {
  if (!BREVO_API_KEY) {
    logger.error('❌ Email service error: BREVO_API_KEY is not set.');
    return;
  }
  try {
    await axios.get('https://api.brevo.com/v3/account', {
      headers: { 'api-key': BREVO_API_KEY },
      timeout: 8000,
    });
    logger.info('✅ Email service ready (Brevo HTTP API)');
  } catch (err) {
    logger.error(`❌ Email service error: ${err.response?.data?.message || err.message}`);
  }
};
verifyEmailService();

// ── HTML ESCAPE ───────────────────────────────────────────────────
// Unchanged from before — still needed for defense in depth
// against XSS in email templates, even though data is
// sanitized with xss() before storage.
const esc = (str) => String(str)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

// ── EMAIL TEMPLATE SHELL ──────────────────────────────────────────
// Unchanged — the visual wrapper is identical.
// Only the delivery mechanism changed, not the design.
const template = (content) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width"/>
</head>
<body style="margin:0;padding:0;background:#f4f5f7;
             font-family:Inter,-apple-system,sans-serif;">
  <div style="max-width:560px;margin:40px auto;padding:0 20px;">
    <div style="background:#fff;border-radius:8px;
                padding:40px;border:1px solid #e1e4e8;">
      <div style="margin-bottom:28px;">
        <span style="font-size:1.25rem;font-weight:800;
                     color:#1a1a1a;">${APP}</span>
      </div>
      ${content}
      <div style="margin-top:40px;padding-top:24px;
                  border-top:1px solid #e1e4e8;
                  font-size:12px;color:#b3b3b3;">
        This email was sent by ${APP}.
        If you didn't request this, you can safely ignore it.
      </div>
    </div>
  </div>
</body>
</html>`;

const btn = (text, url) =>
  `<a href="${url}"
      style="display:inline-block;background:#1a8917;
             color:#fff;padding:12px 28px;border-radius:20px;
             text-decoration:none;font-weight:600;
             font-size:14px;margin:20px 0;">
    ${text}
   </a>`;

// ── CORE SEND FUNCTION ────────────────────────────────────────────
// This replaces transporter.sendMail(). Same signature,
// same error handling philosophy — but sends via HTTPS POST
// to Brevo's API instead of opening an SMTP socket.
const send = async (to, subject, html) => {
  try {
    await axios.post(
      BREVO_API_URL,
      {
        sender:      { name: APP, email: FROM_EMAIL },
        to:          [{ email: to }],
        subject,
        htmlContent: html,
      },
      {
        headers: {
          'api-key':      BREVO_API_KEY,
          'Content-Type': 'application/json',
          'Accept':       'application/json',
        },
        timeout: 10000, // 10s — HTTPS request, not a slow SMTP handshake
      }
    );
    logger.debug(`Email sent to ${to}: ${subject}`);
  } catch (err) {
    // Brevo's API returns structured error messages — log the real reason
    const reason = err.response?.data?.message || err.message;
    logger.error(`Email failed to ${to}: ${reason}`);
    throw err;
  }
};

// ── EMAIL FUNCTIONS ────────────────────────────────────────────────
// All five functions below are UNCHANGED in behavior and signature.
// Controllers calling these functions require ZERO code changes.
// Only the internal send() mechanism changed.

exports.sendVerificationEmail = (email, name, token) =>
  send(email, `Verify your ${APP} account`, template(`
    <h2>Welcome, ${esc(name)}! 👋</h2>
    <p>Please verify your email address to unlock all features.</p>
    ${btn('Verify Email Address', `${URL}/api/auth/verify-email?token=${token}`)}
    <p>This link expires in 24 hours.</p>
  `));

exports.sendPasswordResetEmail = (email, name, token) =>
  send(email, `Reset your ${APP} password`, template(`
    <h2>Password Reset Request</h2>
    <p>Hi ${esc(name)}, click below to reset your password.
       This link expires in 1 hour.</p>
    ${btn('Reset Password', `${URL}/api/auth/reset-password?token=${token}`)}
  `));

exports.sendApplicationConfirmation = (email, name, jobTitle, company) =>
  send(email, `Application submitted: ${jobTitle}`, template(`
    <h2>Application Submitted ✅</h2>
    <p>Hi ${esc(name)}, your application for
       <strong>${esc(jobTitle)}</strong> at
       <strong>${esc(company)}</strong> has been submitted successfully.</p>
    <p>We'll notify you as soon as there's an update.</p>
  `));

exports.sendNewApplicationAlert = (email, name, applicantName, jobTitle) =>
  send(email, `New application: ${jobTitle}`, template(`
    <h2>New Application Received 📩</h2>
    <p>Hi ${esc(name)}, <strong>${esc(applicantName)}</strong>
       just applied for <strong>${esc(jobTitle)}</strong>.</p>
    <p>Log in to your dashboard to review the application.</p>
  `));

exports.sendApplicationStatusUpdate = (email, name, jobTitle, status, company) => {
  const statusMessages = {
    reviewing:   { emoji: '👀', msg: 'is currently being reviewed' },
    shortlisted: { emoji: '⭐', msg: 'has been shortlisted' },
    interview:   { emoji: '🎉', msg: 'has been selected for an interview' },
    offered:     { emoji: '🎊', msg: 'has received a job offer' },
    rejected:    { emoji: '📩', msg: 'was not selected at this time' },
  };
  const info = statusMessages[status] || { emoji: '📋', msg: `status is now: ${status}` };

  return send(email, `Application Update: ${jobTitle}`, template(`
    <h2>${info.emoji} Application Update</h2>
    <p>Hi ${esc(name)}, your application for
       <strong>${esc(jobTitle)}</strong> at
       <strong>${esc(company)}</strong> ${info.msg}.</p>
  `));
};