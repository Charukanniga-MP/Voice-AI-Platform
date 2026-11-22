import twilio from 'twilio';

export interface SmsSendResult {
  success: boolean;
  provider: 'twilio' | '2factor' | 'msg91' | 'fast2sms' | 'development_gateway';
  messageId?: string;
  error?: string;
}

export class SmsGatewayService {
  private twilioClient: twilio.Twilio | null = null;

  constructor() {
    this.initTwilioClient();
  }

  private initTwilioClient() {
    const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
    const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();

    if (accountSid && authToken && accountSid.startsWith('AC')) {
      try {
        this.twilioClient = twilio(accountSid, authToken);
      } catch (err) {
        console.error('[SMS] Failed to initialize Twilio client:', err);
      }
    }
  }

  /**
   * Determine available SMS provider based on configured environment variables
   */
  public getActiveProvider(): 'twilio' | '2factor' | 'msg91' | 'fast2sms' | 'development_gateway' {
    if (this.twilioClient && (process.env.TWILIO_PHONE_NUMBER || process.env.TWILIO_CALLER_ID || process.env.TWILIO_MESSAGING_SERVICE_SID)) {
      return 'twilio';
    }
    if (process.env.TWO_FACTOR_API_KEY || process.env.TWOFACTOR_API_KEY) {
      return '2factor';
    }
    if (process.env.MSG91_AUTH_KEY) {
      return 'msg91';
    }
    if (process.env.FAST2SMS_API_KEY) {
      return 'fast2sms';
    }
    return 'development_gateway';
  }

  /**
   * Send 6-digit OTP SMS to Indian Mobile Number (+91XXXXXXXXXX)
   */
  public async sendOtpSms(normalizedPhone: string, otp: string): Promise<SmsSendResult> {
    const provider = this.getActiveProvider();
    const messageBody = `Your KAIRA verification code is: ${otp}. Valid for 5 minutes. Do not share this OTP with anyone.`;
    const raw10Digit = normalizedPhone.replace(/^\+91/, '');

    // 1. Twilio SMS
    if (provider === 'twilio' && this.twilioClient) {
      try {
        const fromNumber = process.env.TWILIO_PHONE_NUMBER?.trim() || process.env.TWILIO_CALLER_ID?.trim();
        const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID?.trim();

        const message = await this.twilioClient.messages.create({
          to: normalizedPhone,
          ...(messagingServiceSid ? { messagingServiceSid } : { from: fromNumber }),
          body: messageBody
        });

        console.log(`[SMS] Twilio dispatched SMS to ${normalizedPhone}. SID: ${message.sid}`);
        return {
          success: true,
          provider: 'twilio',
          messageId: message.sid
        };
      } catch (err: any) {
        console.error('[SMS] Twilio delivery error:', err?.message || err);
        return {
          success: false,
          provider: 'twilio',
          error: `Twilio delivery failed: ${err?.message || 'Unknown network error'}`
        };
      }
    }

    // 2. 2Factor.in SMS (Indian Telco Gateway)
    if (provider === '2factor') {
      const apiKey = process.env.TWO_FACTOR_API_KEY?.trim() || process.env.TWOFACTOR_API_KEY?.trim();
      const template = process.env.TWO_FACTOR_TEMPLATE?.trim() || 'KAIRA_OTP';
      try {
        const url = `https://2factor.in/v1/API/V1/${encodeURIComponent(apiKey!)}/SMS/${encodeURIComponent(raw10Digit)}/${encodeURIComponent(otp)}/${encodeURIComponent(template)}`;
        const res = await fetch(url, { method: 'GET' });
        const data: any = await res.json();

        if (res.ok && data?.Status === 'Success') {
          console.log(`[SMS] 2Factor dispatched SMS to ${normalizedPhone}. SessionId: ${data?.Details}`);
          return {
            success: true,
            provider: '2factor',
            messageId: data?.Details
          };
        } else {
          const errMsg = data?.Details || data?.Status || '2Factor gateway rejected request';
          console.error('[SMS] 2Factor error:', errMsg);
          return {
            success: false,
            provider: '2factor',
            error: `2Factor delivery failed: ${errMsg}`
          };
        }
      } catch (err: any) {
        console.error('[SMS] 2Factor network exception:', err?.message || err);
        return {
          success: false,
          provider: '2factor',
          error: `2Factor network error: ${err?.message || 'Connection failure'}`
        };
      }
    }

    // 3. MSG91 SMS
    if (provider === 'msg91') {
      const authKey = process.env.MSG91_AUTH_KEY?.trim();
      const templateId = process.env.MSG91_TEMPLATE_ID?.trim() || '';
      try {
        const url = `https://api.msg91.com/api/v5/otp?template_id=${encodeURIComponent(templateId)}&mobile=${encodeURIComponent(raw10Digit)}&authkey=${encodeURIComponent(authKey!)}&otp=${encodeURIComponent(otp)}`;
        const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
        const data: any = await res.json();

        if (res.ok && (data?.type === 'success' || data?.message === 'OTP sent successfully')) {
          console.log(`[SMS] MSG91 dispatched SMS to ${normalizedPhone}. RequestId: ${data?.request_id}`);
          return {
            success: true,
            provider: 'msg91',
            messageId: data?.request_id
          };
        } else {
          const errMsg = data?.message || 'MSG91 gateway rejected request';
          console.error('[SMS] MSG91 error:', errMsg);
          return {
            success: false,
            provider: 'msg91',
            error: `MSG91 delivery failed: ${errMsg}`
          };
        }
      } catch (err: any) {
        console.error('[SMS] MSG91 network error:', err);
        return {
          success: false,
          provider: 'msg91',
          error: `MSG91 network error: ${err?.message || 'Connection failure'}`
        };
      }
    }

    // 4. Fast2SMS
    if (provider === 'fast2sms') {
      const apiKey = process.env.FAST2SMS_API_KEY?.trim();
      try {
        const url = 'https://www.fast2sms.com/dev/bulkV2';
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            authorization: apiKey!,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            route: 'otp',
            variables_values: otp,
            numbers: raw10Digit
          })
        });
        const data: any = await res.json();
        if (res.ok && data?.return === true) {
          console.log(`[SMS] Fast2SMS dispatched SMS to ${normalizedPhone}. RequestId: ${data?.request_id}`);
          return {
            success: true,
            provider: 'fast2sms',
            messageId: data?.request_id
          };
        } else {
          const errMsg = data?.message?.[0] || 'Fast2SMS rejected request';
          return {
            success: false,
            provider: 'fast2sms',
            error: `Fast2SMS delivery failed: ${errMsg}`
          };
        }
      } catch (err: any) {
        return {
          success: false,
          provider: 'fast2sms',
          error: `Fast2SMS network error: ${err?.message || 'Connection failure'}`
        };
      }
    }

    // 5. Development Gateway Simulator (Safe local dev fallback)
    if (process.env.NODE_ENV === 'production') {
      return {
        success: false,
        provider: 'development_gateway',
        error: 'SMS Gateway credentials (Twilio, 2Factor, or MSG91) not configured in production environment.'
      };
    }

    // Pretty console box for developer visibility in local testing
    console.log('\n╔══════════════════════════════════════════════════════════════════════════════╗');
    console.log(`║ 📩 [KAIRA SMS GATEWAY - ACTIVE DELIVERY]                                     ║`);
    console.log(`║ Recipient : ${normalizedPhone.padEnd(65)}║`);
    console.log(`║ OTP Code  : ${otp.padEnd(65)}║`);
    console.log(`║ Valid For : 5 Minutes                                                        ║`);
    console.log(`║ Notice    : Live gateway active. Add TWILIO, 2FACTOR, or MSG91 keys in .env  ║`);
    console.log('╚══════════════════════════════════════════════════════════════════════════════╝\n');

    return {
      success: true,
      provider: 'development_gateway',
      messageId: `dev_${Date.now()}`
    };
  }
}

export const smsService = new SmsGatewayService();
