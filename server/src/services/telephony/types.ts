/**
 * Telephony Provider Abstraction Interface
 * Enables KAIRA to support multiple telephony backends (Exotel, Twilio, Mock)
 * without rewriting the call workflow or UI logic.
 */

export interface OutboundCallRequest {
  destinationNumber: string; // E.164 formatted (+91XXXXXXXXXX)
  customerName?: string;
  agentId: string;
  agentName?: string;
  agentPhoneOrClient?: string; // Agent's PSTN phone, SIP endpoint, or WebRTC identity
  callbackBaseUrl: string;
  customData?: Record<string, any>;
}

export interface OutboundCallResult {
  success: boolean;
  providerCallId: string;
  providerName: string;
  status: 'initiated' | 'ringing' | 'active' | 'failed';
  error?: string;
  callerIdUsed?: string;
  details?: Record<string, any>;
}

export type CallLifecycleStatus =
  | 'initiated'
  | 'ringing'
  | 'active'
  | 'completed'
  | 'busy'
  | 'no-answer'
  | 'rejected'
  | 'failed'
  | 'cancelled';

export interface CallStatusUpdate {
  providerCallId: string;
  status: CallLifecycleStatus;
  duration?: number;
  failureReason?: string;
  recordingUrl?: string;
  rawPayload?: any;
}

export interface TelephonyProviderStatus {
  configured: boolean;
  provider: string;
  displayName: string;
  callerId?: string;
  supportsIndianPSTN: boolean;
  callerNameBranding: {
    requestedName: string;
    status: 'approved' | 'pending' | 'unsupported';
    cNapSupported: boolean;
    explanation: string;
  };
  hasCredentials: boolean;
  message: string;
  details?: Record<string, any>;
  apiAuthentication?: 'connected' | 'failed' | 'unconfigured';
  accountStatus?: 'active' | 'inactive' | 'trial' | 'unconfigured';
  callerIdStatus?: 'configured' | 'missing';
  browserCallingStatus?: 'enabled' | 'not_enabled';
  realCallingStatus?: 'ready' | 'activation_required' | 'simulation_mode';
}

export interface ITelephonyProvider {
  name: string;
  displayName: string;
  isConfigured(): boolean;
  getStatus(): TelephonyProviderStatus;
  initiateOutboundCall(req: OutboundCallRequest): Promise<OutboundCallResult>;
  terminateCall(providerCallId: string): Promise<{ success: boolean; error?: string }>;
  handleStatusWebhook(payload: any, headers?: any): Promise<CallStatusUpdate | null>;
  validateWebhookSignature(req: any): boolean;
}
