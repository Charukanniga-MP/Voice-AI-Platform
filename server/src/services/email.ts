import nodemailer from 'nodemailer';
import { env } from '../config/env.js';

interface EmailPayload {
  to: string;
  subject: string;
  text: string;
  html: string;
}

let transporter: any = null;

if (env.EMAIL_HOST && env.EMAIL_USER && env.EMAIL_PASSWORD) {
  transporter = nodemailer.createTransport({
    host: env.EMAIL_HOST,
    port: env.EMAIL_PORT || 587,
    secure: env.EMAIL_PORT === 465,
    auth: {
      user: env.EMAIL_USER,
      pass: env.EMAIL_PASSWORD
    }
  });
}

export async function sendEmail(payload: EmailPayload): Promise<{ delivered: boolean; mode: 'smtp' | 'simulated' }> {
  if (transporter) {
    try {
      await transporter.sendMail({
        from: env.EMAIL_FROM,
        to: payload.to,
        subject: payload.subject,
        text: payload.text,
        html: payload.html
      });
      return { delivered: true, mode: 'smtp' };
    } catch (err) {
      console.error('[Email Service] Failed to send via SMTP transport:', (err as Error).message);
      // Fallback to simulated delivery in dev/testing
      return { delivered: false, mode: 'smtp' };
    }
  }

  // Simulated email dispatch for local development & testing
  if (env.NODE_ENV !== 'production') {
    console.log(`[Email Service: Simulated] Dispatched to: ${payload.to} | Subject: ${payload.subject}`);
  }
  return { delivered: true, mode: 'simulated' };
}

export async function sendPasswordResetEmail(email: string, name: string, resetLink: string): Promise<boolean> {
  const subject = 'Reset Your KAIRA Password';
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
      <p style="color: #64748b; font-size: 12px; line-height: 1.5;">If you did not initiate this request, no action is needed. Your account remains completely secure.</p>

      <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
      <p style="color: #94a3b8; font-size: 11px; text-align: center;">KAIRA Voice AI Platform &bull; Security & Identity Protection</p>
    </div>
  `;

  const result = await sendEmail({ to: email, subject, text, html });
  return result.delivered;
}

export async function sendGoogleAccountRecoveryNotice(email: string, name: string): Promise<boolean> {
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

  const result = await sendEmail({ to: email, subject, text, html });
  return result.delivered;
}
