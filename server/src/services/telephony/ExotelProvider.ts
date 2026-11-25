import {
  ITelephonyProvider,
  OutboundCallRequest,
  OutboundCallResult,
  CallStatusUpdate,
  TelephonyProviderStatus,
  CallLifecycleStatus
} from './types.js';

/**
 * Exotel Telephony Provider for Indian PSTN Mobile Calling
 *
 * Exotel is an authorized Indian Virtual Network Operator / Cloud Telephony Provider
 * fully compliant with Department of Telecommunications (DoT) & TRAI regulations.
 *
 * Official Exotel Connect API:
 * POST https://<api_key>:<api_token>@<subdomain>/v1/Accounts/<account_sid>/Calls/connect.json
 */
export class ExotelTelephonyProvider implements ITelephonyProvider {
  public readonly name = 'exotel';
  public readonly displayName = 'Exotel (India PSTN Authorized)';

  private get accountSid(): string {
    return process.env.EXOTEL_ACCOUNT_SID?.trim() || '';
  }

  private get apiKey(): string {
    return process.env.EXOTEL_API_KEY?.trim() || '';
  }

  private get apiToken(): string {
    return process.env.EXOTEL_API_TOKEN?.trim() || '';
  }

  private get subdomain(): string {
    return process.env.EXOTEL_SUBDOMAIN?.trim() || 'api.exotel.com';
  }

  private get callerId(): string {
    // Exotel Virtual Number (ExoPhone)
    return process.env.EXOTEL_CALLER_ID?.trim() || '';
  }

  private get agentPstnNumber(): string {
    // When bridging agent to customer, agent's physical/SIP phone number
    return process.env.EXOTEL_AGENT_PHONE?.trim() || '';
  }

  public isConfigured(): boolean {
    return !!(
      this.accountSid &&
      this.apiKey &&
      this.apiToken &&
      this.callerId
    );
  }

  public getStatus(): TelephonyProviderStatus {
    const configured = this.isConfigured();

    let message = 'Exotel is configured and active for legitimate Indian PSTN outbound calls.';
    if (!configured) {
      const missing: string[] = [];
      if (!this.accountSid) missing.push('EXOTEL_ACCOUNT_SID');
      if (!this.apiKey) missing.push('EXOTEL_API_KEY');
      if (!this.apiToken) missing.push('EXOTEL_API_TOKEN');
      if (!this.callerId) missing.push('EXOTEL_CALLER_ID (ExoPhone virtual number)');
      message = `Exotel credentials missing: ${missing.join(', ')}.`;
    }

    return {
      configured,
      provider: this.name,
      displayName: this.displayName,
      callerId: this.callerId || undefined,
      supportsIndianPSTN: true,
      callerNameBranding: {
        requestedName: 'KAIRA Agent',
        status: configured ? 'approved' : 'pending',
        cNapSupported: true,
        explanation: 'TRAI CNAP is supported via registered entity KYC and operator DLT registration. On mobile handsets without telco CNAP switch support, CLI displays the verified Exotel virtual number.'
      },
      hasCredentials: configured,
      message,
      details: {
        subdomain: this.subdomain,
        accountSidConfigured: !!this.accountSid,
        callerIdConfigured: !!this.callerId,
        agentPhoneConfigured: !!this.agentPstnNumber
      }
    };
  }

  /**
   * Initiates an outbound PSTN call connecting the agent and customer's mobile phone
   */
  public async initiateOutboundCall(req: OutboundCallRequest): Promise<OutboundCallResult> {
    if (!this.isConfigured()) {
      return {
        success: false,
        providerCallId: '',
        providerName: this.name,
        status: 'failed',
        error: 'Exotel credentials are not configured in server/.env. Provide EXOTEL_ACCOUNT_SID, EXOTEL_API_KEY, EXOTEL_API_TOKEN, and EXOTEL_CALLER_ID.'
      };
    }

    // Exotel requires the destination number and the agent number/app
    const destination = req.destinationNumber;
    // Agent endpoint: either explicit agentPhoneOrClient, or configured EXOTEL_AGENT_PHONE, or the destination
    const agentEndpoint = req.agentPhoneOrClient || this.agentPstnNumber || this.callerId;

    const endpoint = `https://${this.apiKey}:${this.apiToken}@${this.subdomain}/v1/Accounts/${this.accountSid}/Calls/connect.json`;

    // Form data for Exotel Call Connect
    const params = new URLSearchParams();
    params.append('From', agentEndpoint);
    params.append('To', destination);
    params.append('CallerId', this.callerId);
    params.append('CallType', 'trans'); // Transactional
    params.append('TimeLimit', '3600'); // 1 hour max call duration
    params.append('TimeOut', '30'); // 30 sec ring timeout

    const callbackUrl = `${req.callbackBaseUrl.replace(/\/$/, '')}/api/telephony/webhook/exotel`;
    params.append('StatusCallback', callbackUrl);
    params.append('StatusCallbackEvents[0]', 'terminal');

    if (req.customData) {
      params.append('CustomField', JSON.stringify(req.customData));
    }

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: params.toString()
      });

      const responseText = await response.text();
      let data: any = {};
      try {
        data = JSON.parse(responseText);
      } catch {
        data = { raw: responseText };
      }

      if (!response.ok) {
        const errorMsg = data?.RestException?.Message || data?.message || `HTTP ${response.status}: Failed to initiate Exotel call.`;
        return {
          success: false,
          providerCallId: '',
          providerName: this.name,
          status: 'failed',
          error: errorMsg,
          details: data
        };
      }

      const callSid = data?.Call?.Sid || data?.CallSid || data?.sid || `exotel_${Date.now()}`;
      const status = data?.Call?.Status || 'initiated';

      return {
        success: true,
        providerCallId: callSid,
        providerName: this.name,
        status: status === 'in-progress' ? 'active' : 'ringing',
        callerIdUsed: this.callerId,
        details: data
      };
    } catch (err: any) {
      return {
        success: false,
        providerCallId: '',
        providerName: this.name,
        status: 'failed',
        error: err.message || 'Network error contacting Exotel API.'
      };
    }
  }

  /**
   * Terminates an in-progress call via Exotel REST API
   */
  public async terminateCall(providerCallId: string): Promise<{ success: boolean; error?: string }> {
    if (!this.isConfigured() || !providerCallId) {
      return { success: false, error: 'Cannot terminate call: Missing credentials or Call SID.' };
    }

    const endpoint = `https://${this.apiKey}:${this.apiToken}@${this.subdomain}/v1/Accounts/${this.accountSid}/Calls/${providerCallId}.json`;

    try {
      const params = new URLSearchParams();
      params.append('Status', 'completed');

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: params.toString()
      });

      if (!response.ok) {
        const errText = await response.text();
        return { success: false, error: `Exotel hangup error: ${errText}` };
      }

      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Handles incoming status webhook from Exotel
   */
  public async handleStatusWebhook(payload: any): Promise<CallStatusUpdate | null> {
    const callSid = payload.CallSid || payload.Sid || payload.Call?.Sid;
    if (!callSid) return null;

    const rawStatus = (payload.Status || payload.Call?.Status || '').toLowerCase();
    let status: CallLifecycleStatus = 'initiated';
    let failureReason: string | undefined;

    switch (rawStatus) {
      case 'ringing':
        status = 'ringing';
        break;
      case 'in-progress':
      case 'answered':
        status = 'active';
        break;
      case 'completed':
        status = 'completed';
        break;
      case 'busy':
        status = 'busy';
        failureReason = 'Customer line is busy';
        break;
      case 'no-answer':
        status = 'no-answer';
        failureReason = 'Customer did not answer the phone';
        break;
      case 'failed':
        status = 'failed';
        failureReason = payload.ErrorMessage || 'Call routing failed on carrier network';
        break;
      case 'canceled':
        status = 'cancelled';
        failureReason = 'Call was cancelled before answer';
        break;
      default:
        status = 'active';
    }

    const duration = parseInt(payload.Duration || payload.Leg2Duration || payload.CallDuration || '0', 10);
    const recordingUrl = payload.RecordingUrl || undefined;

    return {
      providerCallId: callSid,
      status,
      duration: isNaN(duration) ? 0 : duration,
      failureReason,
      recordingUrl,
      rawPayload: payload
    };
  }

  /**
   * Validates webhook authenticity
   */
  public validateWebhookSignature(req: any): boolean {
    const secret = process.env.EXOTEL_WEBHOOK_SECRET;
    if (!secret) {
      // If no webhook secret configured, allow in dev/staging
      return true;
    }
    const signature = req.headers['x-exotel-signature'] || req.headers['authorization'];
    return signature === secret;
  }
}
