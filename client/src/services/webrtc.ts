import { getSocket } from './socket.js';
import { callQualityMonitor, CallQualityStats } from './callQuality.js';
import { audioDeviceManager } from './audioDevice.js';

export interface WebRTCCallbacks {
  onQualityChange?: (stats: CallQualityStats) => void;
  onReconnecting?: (attempt: number, maxAttempts: number) => void;
  onReconnected?: () => void;
  onReconnectFailed?: (message: string) => void;
  onConnectionStateChange?: (state: string) => void;
}

export class WebRTCManager {
  private peerConnection: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private remoteAudio: HTMLAudioElement | null = null;
  private targetSocketId: string | null = null;
  private callId: string | null = null;
  private isMuted: boolean = false;
  private isInitiator: boolean = false;
  private authToken: string | null = null;

  // Reconnection management
  private isReconnecting: boolean = false;
  private reconnectAttempts: number = 0;
  private totalReconnectCount: number = 0;
  private readonly maxReconnectAttempts: number = 3;
  private reconnectTimeoutTimer: any = null;
  private reconnectBackoffTimer: any = null;

  private callbacks: WebRTCCallbacks = {};
  private iceServersLoaded: boolean = false;
  private isTurnActive: boolean = false;

  private rtcConfig: RTCConfiguration = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' }
    ],
    iceCandidatePoolSize: 2
  };

  constructor() {
    this.setupSocketListeners();
    this.setupNetworkListeners();
    this.loadIceServers();
  }

  // Load configured ICE/TURN servers from backend
  private async loadIceServers(): Promise<void> {
    try {
      const token = localStorage.getItem('kaira_token') || localStorage.getItem('token');
      const headers: Record<string, string> = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      const res = await fetch('/api/telephony/ice-servers', { headers });
      if (res.ok) {
        const data = await res.json();
        if (data.iceServers && Array.isArray(data.iceServers) && data.iceServers.length > 0) {
          this.rtcConfig.iceServers = data.iceServers;
          this.isTurnActive = data.turnAvailable === true;
          this.iceServersLoaded = true;
          console.log(`[WebRTC] ICE servers loaded (${data.provider}, TURN active: ${this.isTurnActive})`);
        }
      }
    } catch (err) {
      console.warn('[WebRTC] Fallback to default STUN servers due to fetch error:', err);
    }
  }

  public setCallbacks(callbacks: WebRTCCallbacks) {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  // Ensure remote audio element exists and sink ID is applied
  public getAudioElement(): HTMLAudioElement {
    if (!this.remoteAudio) {
      this.remoteAudio = new Audio();
      this.remoteAudio.autoplay = true;
      (this.remoteAudio as any).playsInline = true;
      document.body.appendChild(this.remoteAudio);
    }
    // Apply preferred speaker if set
    audioDeviceManager.applySpeakerToAudioElement(this.remoteAudio);
    return this.remoteAudio;
  }

  // Pre-unlock audio element in response to user click gesture (prevents browser Autoplay blocking)
  public unlockAudio(): void {
    try {
      const audio = this.getAudioElement();
      // Calling play() directly in a user gesture unlocks the audio pipeline for incoming WebRTC streams
      audio.play().catch(() => {
        // Expected promise rejection when srcObject is not yet attached
      });
      console.log('[WebRTC] Audio pipeline unlocked for two-way voice.');
    } catch (e) {
      console.warn('[WebRTC] Audio unlock warning:', e);
    }
  }

  private setupNetworkListeners() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        console.log('[WebRTC] Network online event detected.');
        if (this.peerConnection && this.callId && (this.isReconnecting || this.peerConnection.iceConnectionState === 'disconnected')) {
          this.attemptReconnection('Network restored');
        }
      });

      window.addEventListener('offline', () => {
        console.warn('[WebRTC] Network offline event detected.');
        if (this.peerConnection && this.callId) {
          this.handleDisconnection('Internet connection offline');
        }
      });
    }
  }

  private setupSocketListeners() {
    const socket = getSocket();

    // Handle incoming WebRTC offer
    socket.on('webrtc:offer', async (data: { sender: string; offer: RTCSessionDescriptionInit; callId: string; isReconnect?: boolean }) => {
      console.log('[WebRTC] Received offer from', data.sender, 'isReconnect:', data.isReconnect);
      this.targetSocketId = data.sender;
      this.callId = data.callId;

      try {
        await this.initPeerConnection();
        await this.peerConnection!.setRemoteDescription(new RTCSessionDescription(data.offer));

        const answer = await this.peerConnection!.createAnswer();
        await this.peerConnection!.setLocalDescription(answer);

        socket.emit('webrtc:answer', {
          target: data.sender,
          answer,
          callId: data.callId,
          isReconnect: data.isReconnect
        });

        if (data.isReconnect) {
          this.handleReconnectionSuccess();
        }
      } catch (err) {
        console.error('[WebRTC] Error handling offer:', err);
      }
    });

    // Handle incoming WebRTC answer
    socket.on('webrtc:answer', async (data: { sender: string; answer: RTCSessionDescriptionInit; callId: string; isReconnect?: boolean }) => {
      console.log('[WebRTC] Received answer from', data.sender, 'isReconnect:', data.isReconnect);
      if (this.peerConnection) {
        try {
          await this.peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
          if (data.isReconnect || this.isReconnecting) {
            this.handleReconnectionSuccess();
          }
        } catch (err) {
          console.error('[WebRTC] Error handling answer:', err);
        }
      }
    });

    // Handle incoming ICE candidate
    socket.on('webrtc:ice-candidate', async (data: { sender: string; candidate: RTCIceCandidateInit; callId: string }) => {
      if (this.peerConnection && data.candidate) {
        try {
          await this.peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch (err) {
          console.error('[WebRTC] Error adding ICE candidate:', err);
        }
      }
    });

    // Handle peer reconnect notification
    socket.on('call:reconnecting', (data: { callId: string; attempt?: number; reason?: string }) => {
      if (this.callId === data.callId && !this.isReconnecting) {
        console.log('[WebRTC] Remote peer reported reconnection:', data.reason);
        this.isReconnecting = true;
        callQualityMonitor.setConnectionState('reconnecting', data.attempt || 1);
        this.callbacks.onReconnecting?.(data.attempt || 1, this.maxReconnectAttempts);
      }
    });

    // Handle peer reconnected notification
    socket.on('call:reconnected', (data: { callId: string }) => {
      if (this.callId === data.callId) {
        console.log('[WebRTC] Remote peer reported reconnected');
        this.handleReconnectionSuccess();
      }
    });
  }

  // Request user microphone permission with preferred device
  public async getMicrophoneStream(preferredDeviceId?: string): Promise<MediaStream> {
    if (this.localStream && this.localStream.active) {
      return this.localStream;
    }

    const deviceId = preferredDeviceId || audioDeviceManager.getPreferredMicrophoneId();
    this.localStream = await audioDeviceManager.requestMicrophoneAccess(deviceId);
    return this.localStream;
  }

  // Switch microphone input device dynamically during active call
  public async switchMicrophone(deviceId: string): Promise<void> {
    audioDeviceManager.setPreferredMicrophoneId(deviceId);

    try {
      const newStream = await audioDeviceManager.requestMicrophoneAccess(deviceId);
      const newAudioTrack = newStream.getAudioTracks()[0];

      if (this.peerConnection) {
        const senders = this.peerConnection.getSenders();
        const audioSender = senders.find(s => s.track && s.track.kind === 'audio');
        if (audioSender && newAudioTrack) {
          await audioSender.replaceTrack(newAudioTrack);
        }
      }

      if (this.localStream) {
        this.localStream.getTracks().forEach(t => t.stop());
      }
      this.localStream = newStream;
      newAudioTrack.enabled = !this.isMuted;
      console.log(`[WebRTC] Switched active microphone to device: ${deviceId}`);
    } catch (err) {
      console.error('[WebRTC] Failed to switch microphone:', err);
      throw err;
    }
  }

  // Switch speaker output device
  public async switchSpeaker(deviceId: string): Promise<void> {
    audioDeviceManager.setPreferredSpeakerId(deviceId);
    if (this.remoteAudio) {
      await audioDeviceManager.applySpeakerToAudioElement(this.remoteAudio, deviceId);
    }
  }

  // Initialize RTCPeerConnection
  private async initPeerConnection(): Promise<RTCPeerConnection> {
    if (this.peerConnection) return this.peerConnection;

    if (!this.iceServersLoaded) {
      await this.loadIceServers();
    }

    this.peerConnection = new RTCPeerConnection(this.rtcConfig);

    // Add local tracks
    const stream = await this.getMicrophoneStream();
    stream.getTracks().forEach(track => {
      this.peerConnection!.addTrack(track, stream);
    });

    // On remote track received
    this.peerConnection.ontrack = (event) => {
      console.log('[WebRTC] Received remote audio stream track');
      const audio = this.getAudioElement();
      audio.srcObject = event.streams[0];
      audio.play().catch(e => console.warn('[WebRTC] Audio auto-play blocked by browser:', e));
    };

    // On ICE candidate generated
    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        const candType = event.candidate.type;
        const protocol = event.candidate.protocol;
        const port = event.candidate.port;
        console.log(`[WebRTC ICE] Local candidate: type=${candType}, protocol=${protocol}, port=${port}`);
        if (candType === 'relay') {
          console.log(`🛡️ [WebRTC TURN Relay] Successfully allocated active TURN relay candidate (${candType}, ${protocol}:${port})`);
        }

        if (this.callId) {
          const socket = getSocket();
          socket.emit('webrtc:ice-candidate', {
            target: this.targetSocketId,
            candidate: event.candidate,
            callId: this.callId
          });
        }
      }
    };

    // ICE candidate error monitor (e.g. 401 Unauthorized from TURN server)
    (this.peerConnection as any).onicecandidateerror = (event: any) => {
      console.warn(`[WebRTC ICE Error] Server: ${event.url}, Code: ${event.errorCode}, Text: ${event.errorText}`);
    };

    // Connection state monitor
    this.peerConnection.onconnectionstatechange = () => {
      const state = this.peerConnection?.connectionState || 'closed';
      console.log('[WebRTC] Connection state changed:', state);
      this.callbacks.onConnectionStateChange?.(state);

      if (state === 'connected') {
        this.handleReconnectionSuccess();
        this.inspectActiveCandidatePair();
      } else if (state === 'disconnected' || state === 'failed') {
        this.handleDisconnection(`Connection state: ${state}`);
      }
    };

    // ICE connection state monitor
    this.peerConnection.oniceconnectionstatechange = () => {
      const iceState = this.peerConnection?.iceConnectionState;
      console.log('[WebRTC] ICE connection state:', iceState);

      if (iceState === 'connected' || iceState === 'completed') {
        this.handleReconnectionSuccess();
        this.inspectActiveCandidatePair();
      } else if (iceState === 'disconnected' || iceState === 'failed') {
        this.handleDisconnection(`ICE state: ${iceState}`);
      }
    };

    // Start Real-Time Call Quality Monitor
    if (this.callId) {
      callQualityMonitor.start(this.peerConnection, this.callId, this.authToken);
    }

    return this.peerConnection;
  }

  // Inspect active candidate pair to confirm whether TURN relay is actively routing audio
  public async inspectActiveCandidatePair(): Promise<{ localType?: string; remoteType?: string; isRelay: boolean }> {
    if (!this.peerConnection) return { isRelay: false };
    try {
      const stats = await this.peerConnection.getStats();
      let selectedPair: any = null;
      stats.forEach((report: any) => {
        if (report.type === 'transport' && report.selectedCandidatePairId) {
          selectedPair = stats.get(report.selectedCandidatePairId);
        } else if (report.type === 'candidate-pair' && report.nominated && report.state === 'succeeded') {
          selectedPair = report;
        }
      });
      if (selectedPair) {
        const localCand = stats.get(selectedPair.localCandidateId);
        const remoteCand = stats.get(selectedPair.remoteCandidateId);
        const isRelay = localCand?.candidateType === 'relay' || remoteCand?.candidateType === 'relay';
        console.log(`[WebRTC Diagnostics] Active pair: Local=${localCand?.candidateType} (${localCand?.protocol}), Remote=${remoteCand?.candidateType} (${remoteCand?.protocol}), TURN Relay Used: ${isRelay}`);
        return {
          localType: localCand?.candidateType,
          remoteType: remoteCand?.candidateType,
          isRelay
        };
      }
    } catch (err) {
      console.warn('[WebRTC Diagnostics] Failed to inspect candidate pair:', err);
    }
    return { isRelay: false };
  }

  // Handle network or ICE disconnection by initiating auto-reconnection
  private handleDisconnection(reason: string) {
    if (this.isReconnecting || !this.callId) return;

    console.warn(`[WebRTC] Disconnection detected (${reason}). Starting automatic reconnection...`);
    this.isReconnecting = true;
    this.reconnectAttempts = 0;

    const socket = getSocket();
    socket.emit('call:reconnecting', {
      callId: this.callId,
      attempt: 1,
      reason
    });

    callQualityMonitor.setConnectionState('reconnecting', 1);
    this.callbacks.onReconnecting?.(1, this.maxReconnectAttempts);

    // Set overall timeout (25 seconds)
    if (this.reconnectTimeoutTimer) clearTimeout(this.reconnectTimeoutTimer);
    this.reconnectTimeoutTimer = setTimeout(() => {
      if (this.isReconnecting) {
        console.error('[WebRTC] Automatic reconnection timed out after 25s.');
        this.handleReconnectionFailure('Call disconnected: Reconnection timed out. Please check your internet connection.');
      }
    }, 25000);

    this.attemptReconnection(reason);
  }

  // Attempt ICE restart or signaling renegotiation
  private async attemptReconnection(reason: string) {
    if (!this.callId || !this.peerConnection) return;

    this.reconnectAttempts++;
    console.log(`[WebRTC] Reconnection attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} (${reason})`);

    this.callbacks.onReconnecting?.(this.reconnectAttempts, this.maxReconnectAttempts);
    callQualityMonitor.setConnectionState('reconnecting', this.reconnectAttempts);

    try {
      if (this.isInitiator && this.targetSocketId) {
        // ICE restart offer
        const offer = await this.peerConnection.createOffer({ iceRestart: true });
        await this.peerConnection.setLocalDescription(offer);

        const socket = getSocket();
        socket.emit('webrtc:offer', {
          target: this.targetSocketId,
          offer,
          callId: this.callId,
          isReconnect: true
        });
      }
    } catch (err) {
      console.warn(`[WebRTC] Reconnect attempt ${this.reconnectAttempts} failed:`, err);
    }

    // Schedule next attempt if not reconnected yet
    if (this.reconnectAttempts < this.maxReconnectAttempts && this.isReconnecting) {
      const backoffMs = Math.min(6000, 1500 * Math.pow(1.5, this.reconnectAttempts));
      this.reconnectBackoffTimer = setTimeout(() => {
        if (this.isReconnecting) {
          this.attemptReconnection('Scheduled retry');
        }
      }, backoffMs);
    } else if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      // Reached max attempts, wait for overall timeout
      console.warn('[WebRTC] Max ICE restart attempts sent. Waiting for remote peer response or timeout...');
    }
  }

  // Called when connection successfully restores
  private handleReconnectionSuccess() {
    if (!this.isReconnecting && this.reconnectAttempts === 0) return;

    console.log('[WebRTC] ✓ Call connection successfully re-established!');
    this.isReconnecting = false;
    this.reconnectAttempts = 0;
    this.totalReconnectCount++;

    if (this.reconnectTimeoutTimer) {
      clearTimeout(this.reconnectTimeoutTimer);
      this.reconnectTimeoutTimer = null;
    }
    if (this.reconnectBackoffTimer) {
      clearTimeout(this.reconnectBackoffTimer);
      this.reconnectBackoffTimer = null;
    }

    callQualityMonitor.setConnectionState('connected', 0);
    this.callbacks.onReconnected?.();

    const socket = getSocket();
    socket.emit('call:reconnected', { callId: this.callId });

    // Sync reconnect stats with database
    callQualityMonitor.syncWithBackend(this.totalReconnectCount);
  }

  // Called when auto-reconnect permanently fails
  private handleReconnectionFailure(message: string) {
    this.isReconnecting = false;
    if (this.reconnectTimeoutTimer) clearTimeout(this.reconnectTimeoutTimer);
    if (this.reconnectBackoffTimer) clearTimeout(this.reconnectBackoffTimer);

    callQualityMonitor.setConnectionState('failed', this.reconnectAttempts);
    this.callbacks.onReconnectFailed?.(message);

    const socket = getSocket();
    socket.emit('call:reconnect_failed', {
      callId: this.callId,
      reason: message
    });

    this.endCall();
  }

  // Start outgoing call to peer (create offer)
  public async startCall(targetSocketId: string, callId: string, authToken?: string) {
    this.targetSocketId = targetSocketId;
    this.callId = callId;
    this.isInitiator = true;
    this.authToken = authToken || null;
    this.isReconnecting = false;
    this.reconnectAttempts = 0;
    this.totalReconnectCount = 0;

    await this.initPeerConnection();
    const offer = await this.peerConnection!.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: false
    });

    await this.peerConnection!.setLocalDescription(offer);

    const socket = getSocket();
    socket.emit('webrtc:offer', {
      target: targetSocketId,
      offer,
      callId
    });

    // Start quality monitor
    callQualityMonitor.start(this.peerConnection, callId, this.authToken);
  }

  // Mute / Unmute local microphone
  public toggleMute(): boolean {
    if (this.localStream) {
      this.isMuted = !this.isMuted;
      this.localStream.getAudioTracks().forEach(track => {
        track.enabled = !this.isMuted;
      });
    }
    return this.isMuted;
  }

  public getIsMuted(): boolean {
    return this.isMuted;
  }

  public sendDigits(digits: string): void {
    if (!this.peerConnection || !/^[0-9*#]+$/.test(digits)) return;
    const audioSender = this.peerConnection.getSenders().find(sender => sender.track?.kind === 'audio');
    audioSender?.dtmf?.insertDTMF(digits);
  }

  // Set speaker volume (0 to 1)
  public setVolume(volume: number) {
    if (this.remoteAudio) {
      this.remoteAudio.volume = Math.max(0, Math.min(1, volume));
    }
  }

  public getCallId(): string | null {
    return this.callId;
  }

  public getTotalReconnectCount(): number {
    return this.totalReconnectCount;
  }

  // Clean up all streams and close peer connection
  public endCall() {
    // Record final quality report in backend before tearing down
    callQualityMonitor.syncWithBackend(this.totalReconnectCount);
    callQualityMonitor.stop();

    if (this.reconnectTimeoutTimer) clearTimeout(this.reconnectTimeoutTimer);
    if (this.reconnectBackoffTimer) clearTimeout(this.reconnectBackoffTimer);
    this.isReconnecting = false;
    this.reconnectAttempts = 0;

    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }

    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }

    if (this.remoteAudio) {
      this.remoteAudio.srcObject = null;
    }

    this.targetSocketId = null;
    this.callId = null;
    this.isMuted = false;
    this.isInitiator = false;
  }
}

export const webrtcManager = new WebRTCManager();
