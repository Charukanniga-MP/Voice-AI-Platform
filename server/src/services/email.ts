import nodemailer, { Transporter } from 'nodemailer';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { env } from '../config/env.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface EmailPayload {
  to: string;
  subject: string;
  text: string;
  html: string;
}

let transporter: Transporter | null = null;
let cachedUser: string | null = null;
let cachedPass: string | null = null;

/**
 * Returns a configured Nodemailer Transporter instance.
 * Automatically re-reads server/.env so newly added credentials take effect immediately without restarting.
 * Specifically configured for Gmail SMTP (smtp.gmail.com:465, secure: true).
 */
export function getTransporter(): Transporter | null {
  // Hot-reload .env if user recently updated credentials in server/.env
  dotenv.config({ path: path.resolve(__dirname, '../../.env'), override: true });
  dotenv.config({ path: path.resolve(process.cwd(), '.env'), override: true });

  const host = (process.env.EMAIL_HOST || env.EMAIL_HOST || 'smtp.gmail.com').trim();
  const port = parseInt(String(process.env.EMAIL_PORT || env.EMAIL_PORT || '465'), 10);
  const user = (process.env.EMAIL_USER || env.EMAIL_USER || '').trim();
  const pass = (process.env.EMAIL_PASSWORD || env.EMAIL_PASSWORD || '').trim().replace(/\s+/g, '');

  if (!user || !pass) {
    console.error('[Email Service] ❌ SMTP credentials incomplete: EMAIL_USER or EMAIL_PASSWORD missing in server/.env.');
    transporter = null;
    return null;
  }

  // Reuse existing transporter if credentials are unchanged
  if (transporter && cachedUser === user && cachedPass === pass) {
    return transporter;
  }

  cachedUser = user;
  cachedPass = pass;

  console.log(`[Email Service] Initializing Gmail SMTP Transporter for: ${user} (Host: ${host}:${port}, Secure: true)`);

  transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465, // SSL/TLS direct on port 465
    auth: {
      user,
      pass
    },
    tls: {
      rejectUnauthorized: true
    }
  });

  return transporter;
}

/**
 * Reset transporter cache if credentials change or on reload.
 */
export function resetTransporter(): void {
  transporter = null;
}

/**
 * Verify SMTP connection and authentication credentials against mail server.
 */
export async function verifySmtpConnection(): Promise<{ success: boolean; message: string; error?: string }> {
  const mailer = getTransporter();
  if (!mailer) {
    return {
      success: false,
      message: 'SMTP credentials missing in server/.env. EMAIL_HOST, EMAIL_USER, and EMAIL_PASSWORD are required.',
      error: 'MISSING_CREDENTIALS'
    };
  }

  try {
    await mailer.verify();
    console.log('[Email Service] ✓ SMTP connection & authentication verified successfully with smtp.gmail.com:465');
    return {
      success: true,
      message: 'SMTP connection verified successfully. Ready to dispatch emails.'
    };
  } catch (err: any) {
    console.error('[Email Service] ❌ SMTP Verification Error:', err.message);
    let userFriendlyError = err.message;
    if (err.code === 'EAUTH') {
      userFriendlyError = 'Gmail authentication failed. Please verify that your Google App Password (16 characters) is valid and that 2-Step Verification is active on your Google account.';
    }
    return {
      success: false,
      message: userFriendlyError,
      error: err.code || err.message
    };
  }
}

/**
 * Send an email payload via SMTP.
 */
export async function sendEmail(payload: EmailPayload): Promise<{ delivered: boolean; messageId?: string; error?: string }> {
  const mailer = getTransporter();
  if (!mailer) {
    const errorMsg = 'SMTP Transporter not configured in server/.env. EMAIL_USER and EMAIL_PASSWORD are required.';
    console.error(`[Email Service] ❌ Delivery blocked for ${payload.to}: ${errorMsg}`);
    return { delivered: false, error: errorMsg };
  }

  try {
    const sender = (env.EMAIL_USER || process.env.EMAIL_USER || '').trim();
    const fromAddress = env.EMAIL_FROM || process.env.EMAIL_FROM || `"KAIRA Voice AI" <${sender}>`;

    console.log(`[Email Service] Dispatching SMTP email to ${payload.to} via ${env.EMAIL_HOST || 'smtp.gmail.com'}:${env.EMAIL_PORT || 465}...`);

    const info = await mailer.sendMail({
      from: fromAddress,
      to: payload.to,
      subject: payload.subject,
      text: payload.text,
      html: payload.html
    });

    console.log(`[Email Service] ✓ Real email delivered successfully to ${payload.to}! MessageId: ${info.messageId}`);
    return { delivered: true, messageId: info.messageId };
  } catch (err: any) {
    console.error(`[Email Service] ❌ SMTP delivery failed for ${payload.to}:`, err.message);
    if (err.code === 'EAUTH') {
      console.error('[Email Service] ❌ Gmail Authentication Error: Invalid Gmail address or Google App Password.');
    }
    return { delivered: false, error: err.message };
  }
}

/**
 * Send a diagnostic test email to verify real delivery.
 */
export async function sendTestEmail(toEmail?: string): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const targetEmail = toEmail || env.EMAIL_USER || process.env.EMAIL_USER;
  if (!targetEmail) {
    return { success: false, error: 'No recipient email specified for test email.' };
  }

  const subject = 'KAIRA – SMTP Diagnostic Test';
  const timestamp = new Date().toLocaleString();
  const text = `Hello,\n\nThis is a diagnostic test email from your KAIRA Voice AI Platform.\n\nTimestamp: ${timestamp}\nSMTP Host: ${env.EMAIL_HOST || 'smtp.gmail.com'}\nPort: ${env.EMAIL_PORT || 465}\n\nIf you are reading this email, your Gmail SMTP delivery is functioning properly!`;

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background: #ffffff;">
      <div style="text-align: center; margin-bottom: 20px;">
        <div style="display: inline-block; width: 44px; height: 44px; line-height: 44px; border-radius: 10px; background: #10b981; color: #ffffff; font-weight: bold; font-size: 20px;">✓</div>
        <h2 style="color: #0f172a; margin-top: 12px; margin-bottom: 4px;">KAIRA – SMTP Test Email</h2>
        <p style="color: #64748b; font-size: 13px; margin: 0;">Email Delivery Verification</p>
      </div>
      <p style="color: #334155; font-size: 14px; line-height: 1.6;">Hello,</p>
      <p style="color: #334155; font-size: 14px; line-height: 1.6;">Your KAIRA Voice AI Platform has successfully connected to Gmail SMTP (<strong>smtp.gmail.com:465</strong>) and delivered this test message.</p>
      <div style="padding: 12px 16px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 12px; color: #475569; margin: 20px 0;">
        <p style="margin: 4px 0;"><strong>Recipient:</strong> ${targetEmail}</p>
        <p style="margin: 4px 0;"><strong>Timestamp:</strong> ${timestamp}</p>
        <p style="margin: 4px 0;"><strong>Status:</strong> <span style="color: #10b981; font-weight: bold;">Verified & Active</span></p>
      </div>
      <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
      <p style="color: #94a3b8; font-size: 11px; text-align: center;">KAIRA Voice AI Platform &bull; Diagnostic Suite</p>
    </div>
  `;

  const result = await sendEmail({ to: targetEmail, subject, text, html });
  return { success: result.delivered, messageId: result.messageId, error: result.error };
}

/**
 * Sends a password reset email containing a secure button linking directly to KAIRA.
 * Note: Raw reset token is embedded in the link but NEVER logged to console.
 */
export async function sendPasswordResetEmail(email: string, name: string, resetLink: string): Promise<{ delivered: boolean; error?: string }> {
  const subject = 'KAIRA – Password Reset Request';
  const text = `Hello ${name},\n\nWe received a request to reset your password for your KAIRA Voice AI Platform account.\n\nPlease open this link to reset your password (valid for 15 minutes):\n${resetLink}\n\nIf you did not request a password reset, you can safely ignore this email. Your password will remain unchanged.\n\nBest regards,\nKAIRA Security Team`;

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background: #ffffff;">
      <div style="text-align: center; margin-bottom: 24px;">
        <div style="display: inline-block; width: 44px; height: 44px; line-height: 44px; border-radius: 10px; background: #4f46e5; color: #ffffff; font-weight: bold; font-size: 20px;">K</div>
        <h2 style="color: #0f172a; margin-top: 12px; margin-bottom: 4px;">Password Reset Request</h2>
        <p style="color: #64748b; font-size: 13px; margin: 0;">KAIRA Voice AI Platform</p>
      </div>

      <p style="color: #334155; font-size: 14px; line-height: 1.6;">Hello <strong>${name}</strong>,</p>
      <p style="color: #334155; font-size: 14px; line-height: 1.6;">We received a request to reset the password associated with your KAIRA account. Click the button below to choose a new, secure password.</p>

      <div style="text-align: center; margin: 32px 0;">
        <a href="${resetLink}" style="background: #4f46e5; color: #ffffff; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-weight: 600; font-size: 14px; display: inline-block;">Reset Password</a>
      </div>

      <p style="color: #64748b; font-size: 12px; line-height: 1.5;">This reset link will expire in <strong>15 minutes</strong> and can only be used once.</p>
      <p style="color: #64748b; font-size: 12px; line-height: 1.5; word-break: break-all;">Or copy and paste this link in your browser: <a href="${resetLink}" style="color: #4f46e5;">${resetLink}</a></p>
      <p style="color: #64748b; font-size: 12px; line-height: 1.5;">If you did not initiate this request, no action is needed. Your account remains completely secure.</p>

      <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
      <p style="color: #94a3b8; font-size: 11px; text-align: center;">KAIRA Voice AI Platform &bull; Security & Identity Protection</p>
    </div>
  `;

  // Log dispatch event securely WITHOUT exposing the raw token or credentials
  console.log(`[Email Service] Initiating password reset email delivery to ${email} (Expires in 15 minutes)`);

  return await sendEmail({ to: email, subject, text, html });
}

export async function sendGoogleAccountRecoveryNotice(email: string, name: string): Promise<{ delivered: boolean; error?: string }> {
  const subject = 'KAIRA Account Access: Signed in with Google';
  const text = `Hello ${name},\n\nWe received a password reset request for your KAIRA account. However, your account was registered using Google Sign-In.\n\nTo access your account, simply use the "Continue with Google" option on the KAIRA login page.\n\nBest regards,\nKAIRA Security Team`;

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background: #ffffff;">
      <h2 style="color: #0f172a;">Google Account Sign-In Notice</h2>
      <p style="color: #334155; font-size: 14px; line-height: 1.6;">Hello <strong>${name}</strong>,</p>
      <p style="color: #334155; font-size: 14px; line-height: 1.6;">You requested a password reset for <strong>${email}</strong>. This account is linked to your Google identity and does not use a local password.</p>
      <p style="color: #334155; font-size: 14px; line-height: 1.6;">Please sign in to KAIRA using the <strong>"Continue with Google"</strong> button.</p>
      <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
      <p style="color: #94a3b8; font-size: 11px; text-align: center;">KAIRA Voice AI Platform &bull; Security Notice</p>
    </div>
  `;

  return await sendEmail({ to: email, subject, text, html });
}
