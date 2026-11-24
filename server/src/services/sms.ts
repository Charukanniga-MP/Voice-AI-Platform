import twilio from 'twilio';

export type SmsProviderName = 'twilio' | '2factor' | 'msg91' | 'fast2sms' | 'mock_gateway' | 'none';

export interface SmsSendResult {
  success: boolean;
  provider: SmsProviderName;
  messageId?: string;
  error?: string;
}

export type MockSmsHandler = (phone: string, otp: string) => Promise<SmsSendResult>;

export class SmsGatewayService {
  private twilioClient: twilio.Twilio | null = null;
  private mockHandler: MockSmsHandler | null = null;

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
        console.error('[SMS] Failed to initialize Twilio client:', err instanceof Error ? err.message : 'Init error');
      }
    }
  }

  /**
   * Set a temporary mock handler for automated unit and integration tests only
   */
  public setMockHandler(handler: MockSmsHandler | null): void {
    this.mockHandler = handler;
  }

  /**
   * Clear any active mock handler
   */
  public clearMockHandler(): void {
    this.mockHandler = null;
  }

  /**
   * Determine available SMS provider based on configured environment variables
   */
  public getActiveProvider(): SmsProviderName {
    if (this.mockHandler) {
      return 'mock_gateway';
    }

    const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
    const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
    const twilioSender = process.env.TWILIO_PHONE_NUMBER?.trim() ||
      process.env.TWILIO_CALLER_ID?.trim() ||
      process.env.TWILIO_MESSAGING_SERVICE_SID?.trim();

    if (this.twilioClient && accountSid && authToken && twilioSender) {
      return 'twilio';
    }

    const twoFactorKey = process.env.TWO_FACTOR_API_KEY?.trim() || process.env.TWOFACTOR_API_KEY?.trim();
    if (twoFactorKey && twoFactorKey.length > 5) {
      return '2factor';
    }

    const msg91Key = process.env.MSG91_AUTH_KEY?.trim();
    if (msg91Key && msg91Key.length > 5) {
      return 'msg91';
    }

    const fast2smsKey = process.env.FAST2SMS_API_KEY?.trim();
    if (fast2smsKey && fast2smsKey.length > 5) {
      return 'fast2sms';
    }

    return 'none';
  }

  /**
   * Check whether any valid telecom SMS gateway is configured
   */
  public isConfigured(): boolean {
    return this.getActiveProvider() !== 'none';
  }

  /**
   * Mask Indian mobile number for safe security logs (e.g. +91 98••• ••210)
   */
  private maskPhoneNumber(phone: string): string {
    const cleaned = phone.replace(/[^\d+]/g, '');
    if (cleaned.length >= 12) {
      return `${cleaned.slice(0, 5)}•••••${cleaned.slice(-3)}`;
    }
    return '••••••••••';
  }

  /**
   * Send 6-digit OTP SMS to Indian Mobile Number (+91XXXXXXXXXX)
   * Strictly enforces:
   * 1. Real telecom API delivery
   * 2. Zero terminal/console exposure of the OTP code
   * 3. Clear error if no provider is configured
   */
  public async sendOtpSms(normalizedPhone: string, otp: string): Promise<SmsSendResult> {
    const provider = this.getActiveProvider();
    const masked = this.maskPhoneNumber(normalizedPhone);
    const raw10Digit = normalizedPhone.replace(/^\+91/, '');
    const messageBody = `Your KAIRA verification code is: ${otp}. Valid for 5 minutes. Do not share this OTP with anyone.`;

    // 0. Mock Gateway (Strictly for automated test suites)
    if (provider === 'mock_gateway' && this.mockHandler) {
      try {
        const mockResult = await this.mockHandler(normalizedPhone, otp);
        return mockResult;
      } catch (err: any) {
        return {
          success: false,
          provider: 'mock_gateway',
          error: `Mock gateway error: ${err?.message || 'Execution error'}`
        };
      }
    }

    // 1. No provider configured: fail with clear, secure message
    if (provider === 'none') {
      return {
        success: false,
        provider: 'none',
        error: 'SMS service is not configured. Please contact support.'
      };
    }

    // 2. Twilio Programmable SMS
    if (provider === 'twilio' && this.twilioClient) {
      try {
        const fromNumber = process.env.TWILIO_PHONE_NUMBER?.trim() || process.env.TWILIO_CALLER_ID?.trim();
        const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID?.trim();

        const message = await this.twilioClient.messages.create({
          to: normalizedPhone,
          ...(messagingServiceSid ? { messagingServiceSid } : { from: fromNumber }),
          body: messageBody
        });

        console.log(`[SMS] Twilio dispatched SMS to ${masked}. SID: ${message.sid}`);
        return {
          success: true,
          provider: 'twilio',
          messageId: message.sid
        };
      } catch (err: any) {
        console.error('[SMS] Twilio delivery error:', err?.message || 'Network error');
        return {
          success: false,
          provider: 'twilio',
          error: `Twilio delivery failed: ${err?.message || 'Network dispatch failure'}`
        };
      }
    }

    // 3. 2Factor.in SMS (Indian DLT Transactional Gateway)
    if (provider === '2factor') {
      const apiKey = process.env.TWO_FACTOR_API_KEY?.trim() || process.env.TWOFACTOR_API_KEY?.trim();
      const template = process.env.TWO_FACTOR_TEMPLATE?.trim() || 'KAIRA_OTP';
      try {
        const url = `https://2factor.in/v1/API/V1/${encodeURIComponent(apiKey!)}/SMS/${encodeURIComponent(raw10Digit)}/${encodeURIComponent(otp)}/${encodeURIComponent(template)}`;
        const res = await fetch(url, { method: 'GET' });
        const data: any = await res.json().catch(() => ({}));

        if (res.ok && data?.Status === 'Success') {
          console.log(`[SMS] 2Factor dispatched SMS to ${masked}. SessionId: ${data?.Details}`);
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
        console.error('[SMS] 2Factor network exception:', err?.message || 'Connection failure');
        return {
          success: false,
          provider: '2factor',
          error: `2Factor network error: ${err?.message || 'Connection failure'}`
        };
      }
    }

    // 4. MSG91 SMS (Indian Enterprise DLT Gateway)
    if (provider === 'msg91') {
      const authKey = process.env.MSG91_AUTH_KEY?.trim();
      const templateId = process.env.MSG91_TEMPLATE_ID?.trim() || '';
      try {
        const url = `https://api.msg91.com/api/v5/otp?template_id=${encodeURIComponent(templateId)}&mobile=${encodeURIComponent('91' + raw10Digit)}&authkey=${encodeURIComponent(authKey!)}&otp=${encodeURIComponent(otp)}`;
        const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
        const data: any = await res.json().catch(() => ({}));

        if (res.ok && (data?.type === 'success' || data?.message === 'OTP sent successfully')) {
          console.log(`[SMS] MSG91 dispatched SMS to ${masked}. RequestId: ${data?.request_id}`);
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
        console.error('[SMS] MSG91 network error:', err?.message || 'Connection failure');
        return {
          success: false,
          provider: 'msg91',
          error: `MSG91 network error: ${err?.message || 'Connection failure'}`
        };
      }
    }

    // 5. Fast2SMS (Indian Bulk V2 Quick OTP Route)
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
        const data: any = await res.json().catch(() => ({}));

        if (res.ok && data?.return === true) {
          console.log(`[SMS] Fast2SMS dispatched SMS to ${masked}. RequestId: ${data?.request_id}`);
          return {
            success: true,
            provider: 'fast2sms',
            messageId: data?.request_id
          };
        } else {
          const errMsg = data?.message?.[0] || 'Fast2SMS rejected request';
          console.error('[SMS] Fast2SMS error:', errMsg);
          return {
            success: false,
            provider: 'fast2sms',
            error: `Fast2SMS delivery failed: ${errMsg}`
          };
        }
      } catch (err: any) {
        console.error('[SMS] Fast2SMS network error:', err?.message || 'Connection failure');
        return {
          success: false,
          provider: 'fast2sms',
          error: `Fast2SMS network error: ${err?.message || 'Connection failure'}`
        };
      }
    }

    return {
      success: false,
      provider: 'none',
      error: 'SMS service is not configured. Please contact support.'
    };
  }
}

export const smsService = new SmsGatewayService();
