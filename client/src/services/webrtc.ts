import { getSocket } from './socket';
import { callQualityMonitor, CallQualityStats } from './callQuality';
import { audioDeviceManager } from './audioDevice';

export interface WebRTCCallbacks {
  onQualityChange?: (stats: CallQualityStats) => void;
  onReconnecting?: (attempt: number, maxAttempts: number, message?: string) => void;
  onReconnected?: (message?: string) => void;
  onReconnectFailed?: (message: string) => void;
  onConnectionStateChange?: (state: string) => void;
  onDeviceError?: (deviceType: 'microphone' | 'speaker', status: 'error' | 'restored', message: string) => void;
  onAiFallback?: (serviceType: 'stt' | 'llm' | 'tts', message: string) => void;
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
  // Call Recording Properties
  private mediaRecorder: MediaRecorder | null = null;
  private recordedChunks: Blob[] = [];
  private recordingStartTime: number | null = null;
  private isRecording: boolean = false;
  private recordingConsent: 'granted' | 'declined' | 'not_requested' = 'not_requested';
  private remoteStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private recordingDestination: MediaStreamAudioDestinationNode | null = null;
  private localAudioSource: MediaStreamAudioSourceNode | null = null;
  private remoteAudioSource: MediaStreamAudioSourceNode | null = null;
  private pendingCandidates: RTCIceCandidateInit[] = [];


  // Reconnection management
  private isReconnecting: boolean = false;
  private reconnectAttempts: number = 0;
  private totalReconnectCount: number = 0;
  private readonly maxReconnectAttempts: number = 3;
  private reconnectTimeoutTimer: any = null;
  private reconnectBackoffTimer: any = null;
  private healthReportTimer: any = null;

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
      if (!audio.src && !audio.srcObject) {
        audio.src = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';
      }
      audio.play().then(() => {
        if (audio.src && audio.src.startsWith('data:audio/wav')) {
          audio.removeAttribute('src');
        }
      }).catch(() => {
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

      // Detect hardware device addition / removal (e.g. headset unplugged)
      if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
        navigator.mediaDevices.addEventListener('devicechange', async () => {
          console.log('[WebRTC] Audio device change detected.');
          if (this.callId && this.peerConnection) {
            await this.verifyAndRecoverAudioDevices();
          }
        });
      }
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
        if (!data.isReconnect && this.peerConnection) {
          try {
            this.peerConnection.close();
          } catch (err) {
            console.debug('[WebRTC] Cleaned previous connection on incoming offer:', err);
          }
          this.peerConnection = null;
        }

        await this.initPeerConnection();
        await this.peerConnection!.setRemoteDescription(new RTCSessionDescription(data.offer));
        await this.flushPendingCandidates();

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
      if (this.peerConnection && this.peerConnection.signalingState !== 'closed') {
        try {
          await this.peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
          await this.flushPendingCandidates();
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
      if (!data.candidate) return;
      if (this.peerConnection && this.peerConnection.remoteDescription && this.peerConnection.remoteDescription.type) {
        try {
          await this.peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch (err) {
          console.error('[WebRTC] Error adding ICE candidate:', err);
        }
      } else {
        this.pendingCandidates.push(data.candidate);
      }
    });

    // Handle peer reconnect notification with user-friendly messages
    socket.on('call:reconnecting', (data: { callId: string; attempt?: number; maxAttempts?: number; reason?: string; userMessage?: string }) => {
      if (this.callId === data.callId && !this.isReconnecting) {
        console.log('[WebRTC] Remote peer reported reconnection:', data.reason);
        this.isReconnecting = true;
        callQualityMonitor.setConnectionState('reconnecting', data.attempt || 1);
        this.callbacks.onReconnecting?.(data.attempt || 1, data.maxAttempts || this.maxReconnectAttempts, data.userMessage);
      }
    });

    // Handle peer reconnected notification
    socket.on('call:reconnected', (data: { callId: string; userMessage?: string }) => {
      if (this.callId === data.callId) {
        console.log('[WebRTC] Remote peer reported reconnected');
        this.handleReconnectionSuccess(data.userMessage);
      }
    });

    // Handle audio input/output device failure or recovery notification
    socket.on('call:device_error', (data: { callId: string; deviceType: 'microphone' | 'speaker'; status: 'error' | 'restored'; userMessage?: string }) => {
      if (this.callId === data.callId) {
        this.callbacks.onDeviceError?.(data.deviceType, data.status, data.userMessage || 'Audio device status updated.');
      }
    });

    // Handle intelligent AI fallback notification
    socket.on('call:ai_fallback_triggered', (data: { callId: string; serviceType: 'stt' | 'llm' | 'tts'; userMessage?: string }) => {
      if (this.callId === data.callId) {
        this.callbacks.onAiFallback?.(data.serviceType, data.userMessage || 'AI service temporarily unavailable.');
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
    if (this.localStream.getAudioTracks().length > 0) {
      this.bindTrackListeners(this.localStream.getAudioTracks()[0]);
    }
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
      this.bindTrackListeners(newAudioTrack);
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

  // Bind track lifecycle listeners for hardware disconnection and mute detection
  private bindTrackListeners(track: MediaStreamTrack) {
    track.onended = () => {
      console.warn('[WebRTC] Local microphone track ended abruptly!');
      this.handleDeviceFailure('microphone', 'Microphone access is unavailable. Please check your microphone permissions.');
      // Attempt automatic microphone stream recovery
      setTimeout(() => this.verifyAndRecoverAudioDevices(), 800);
    };

    track.onmute = () => {
      console.warn('[WebRTC] Local microphone track muted by hardware or OS.');
      this.handleDeviceFailure('microphone', 'Microphone is currently muted or blocked by your system.');
    };

    track.onunmute = () => {
      console.log('[WebRTC] Local microphone track unmuted.');
      this.handleDeviceRestored('microphone');
    };
  }

  // Verify and recover audio devices dynamically
  public async verifyAndRecoverAudioDevices(): Promise<void> {
    if (!this.callId || !this.peerConnection) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const hasMic = devices.some(d => d.kind === 'audioinput');

      if (!hasMic) {
        console.warn('[WebRTC] No microphone device detected!');
        this.handleDeviceFailure('microphone', 'Microphone access is unavailable. Please check your microphone permissions.');
        return;
      }

      // Check if current local audio track is active
      const currentTrack = this.localStream?.getAudioTracks()[0];
      if (!currentTrack || currentTrack.readyState === 'ended' || !currentTrack.enabled) {
        console.warn('[WebRTC] Local microphone track ended or unavailable. Attempting auto-recovery...');
        this.handleDeviceFailure('microphone', 'Restoring audio connection...');

        const preferredMic = audioDeviceManager.getPreferredMicrophoneId();
        const newStream = await audioDeviceManager.requestMicrophoneAccess(preferredMic);
        const newTrack = newStream.getAudioTracks()[0];

        const senders = this.peerConnection.getSenders();
        const audioSender = senders.find(s => s.track && s.track.kind === 'audio');
        if (audioSender && newTrack) {
          await audioSender.replaceTrack(newTrack);
        }

        if (this.localStream) {
          this.localStream.getTracks().forEach(t => t.stop());
        }
        this.localStream = newStream;
        newTrack.enabled = !this.isMuted;
        this.bindTrackListeners(newTrack);

        console.log('[WebRTC] Microphone track successfully recovered and replaced.');
        this.handleDeviceRestored('microphone');
      }
    } catch (err) {
      console.warn('[WebRTC] Error during device verification/recovery:', err);
    }
  }

  private handleDeviceFailure(deviceType: 'microphone' | 'speaker', message: string) {
    const socket = getSocket();
    socket.emit('call:device_error', {
      callId: this.callId,
      deviceType,
      status: 'error',
      details: message
    });
    this.callbacks.onDeviceError?.(deviceType, 'error', message);
  }

  private handleDeviceRestored(deviceType: 'microphone' | 'speaker') {
    const socket = getSocket();
    socket.emit('call:device_error', {
      callId: this.callId,
      deviceType,
      status: 'restored'
    });
    this.callbacks.onDeviceError?.(deviceType, 'restored', 'Audio device successfully restored.');
  }

  // Drain buffered ICE candidates after remote description is set
  private async flushPendingCandidates(): Promise<void> {
    if (!this.peerConnection || !this.peerConnection.remoteDescription) return;
    while (this.pendingCandidates.length > 0) {
      const candidate = this.pendingCandidates.shift();
      if (candidate) {
        try {
          await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (err) {
          console.warn('[WebRTC] Error draining queued ICE candidate:', err);
        }
      }
    }
  }

  // Initialize RTCPeerConnection
  private async initPeerConnection(): Promise<RTCPeerConnection> {
    if (this.peerConnection && this.peerConnection.connectionState !== 'closed' && this.peerConnection.signalingState !== 'closed') {
      return this.peerConnection;
    }

    if (this.peerConnection) {
      try {
        this.peerConnection.close();
      } catch (err) {
        console.debug('[WebRTC] Resetting closed peer connection:', err);
      }
      this.peerConnection = null;
    }

    if (!this.iceServersLoaded) {
      await this.loadIceServers();
    }

    this.peerConnection = new RTCPeerConnection(this.rtcConfig);

    // Add local tracks
    const stream = await this.getMicrophoneStream();
    if (!this.peerConnection || this.peerConnection.connectionState === 'closed') {
      return this.peerConnection!;
    }
    const senders = this.peerConnection.getSenders();
    stream.getTracks().forEach(track => {
      const alreadyAdded = senders.some(s => s.track && s.track.id === track.id);
      if (!alreadyAdded) {
        this.peerConnection!.addTrack(track, stream);
      }
    });

    // On remote track received
    this.peerConnection.ontrack = (event) => {
      console.log('[WebRTC] Received remote audio stream track');
      const stream = (event.streams && event.streams[0]) ? event.streams[0] : new MediaStream([event.track]);
      this.remoteStream = stream;
      if (this.recordingConsent === 'granted' && !this.isRecording) {
        this.startRecording();
      } else if (this.isRecording && this.audioContext && this.recordingDestination) {
        try {
          if (this.remoteAudioSource) {
            this.remoteAudioSource.disconnect();
          }
          this.remoteAudioSource = this.audioContext.createMediaStreamSource(stream);
          this.remoteAudioSource.connect(this.recordingDestination);
          console.log('[WebRTC Recording] Connected transferred remote stream to active recording.');
        } catch (err) {
          console.warn('[WebRTC Recording] Could not attach remote stream to active recording:', err);
        }
      }
      const audio = this.getAudioElement();
      audio.srcObject = stream;
      audio.play().catch(e => console.warn('[WebRTC] Audio auto-play blocked by browser:', e));
      event.track.onunmute = () => {
        audio.play().catch(() => {});
      };
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
        if (this.recordingConsent === 'granted') this.startRecording();
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
  private handleReconnectionSuccess(message?: string) {
    if (!this.isReconnecting && this.reconnectAttempts === 0) return;

    const userMessage = message || 'Connection restored! Live voice resumed.';
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
    this.callbacks.onReconnected?.(userMessage);

    const socket = getSocket();
    socket.emit('call:reconnected', { callId: this.callId, userMessage });

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
    this.pendingCandidates = [];

    if (this.peerConnection) {
      try {
        this.peerConnection.close();
      } catch (err) {
        console.debug('[WebRTC] Resetting closed peer connection:', err);
      }
      this.peerConnection = null;
    }

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

    // Periodic live call health telemetry reporting (every 3 seconds)
    if (this.healthReportTimer) clearInterval(this.healthReportTimer);
    this.healthReportTimer = setInterval(() => {
      if (this.callId && this.peerConnection && this.peerConnection.connectionState !== 'closed') {
        const stats = callQualityMonitor.getCurrentStats();
        const sk = getSocket();
        sk.emit('call:health_report', {
          callId: this.callId,
          webrtcState: this.peerConnection.connectionState,
          iceState: this.peerConnection.iceConnectionState,
          latencyMs: stats.latency,
          packetLoss: stats.packetLoss,
          jitterMs: stats.jitter,
          audioDeviceStatus: 'healthy',
          reconnectAttempts: this.totalReconnectCount
        });
      }
    }, 3000);
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

  public setCallId(id: string | null): void {
    this.callId = id;
  }

  public getCallId(): string | null {
    return this.callId;
  }

  public getTotalReconnectCount(): number {
    return this.totalReconnectCount;
  }

  // Clean up all streams and close peer connection
  
  // Start high-fidelity bidirectional WebRTC call recording
  public setRecordingConsent(consent: 'granted' | 'declined' | 'not_requested'): void {
    this.recordingConsent = consent;
  }

  public startRecording(): void {
    if (this.recordingConsent !== 'granted' || this.isRecording || !this.callId) return;
    try {
      if (typeof window === 'undefined' || typeof MediaRecorder === 'undefined') return;
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;

      if (!this.audioContext || this.audioContext.state === 'closed') {
        this.audioContext = new AudioCtx();
      }
      if (this.audioContext.state === 'suspended') {
        this.audioContext.resume().catch(() => {});
      }

      this.recordingDestination = this.audioContext.createMediaStreamDestination();
      const dest = this.recordingDestination;

      // 1. Connect local microphone audio track to recording mixer
      if (this.localStream && this.localStream.getAudioTracks().length > 0) {
        try {
          this.localAudioSource = this.audioContext.createMediaStreamSource(this.localStream);
          this.localAudioSource.connect(dest);
          console.log('[WebRTC Recording] Local microphone connected to recording stream.');
        } catch (e) {
          console.warn('[WebRTC Recording] Could not mix local track:', e);
        }
      }

      // 2. Connect remote peer audio track (human agent/specialist) to recording mixer
      if (this.remoteStream && this.remoteStream.getAudioTracks().length > 0) {
        try {
          this.remoteAudioSource = this.audioContext.createMediaStreamSource(this.remoteStream);
          this.remoteAudioSource.connect(dest);
          console.log('[WebRTC Recording] Remote peer audio connected to recording stream.');
        } catch (e) {
          console.warn('[WebRTC Recording] Could not mix remote track:', e);
        }
      }

      let mimeType = 'audio/webm;codecs=opus';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/ogg';
      }

      this.recordedChunks = [];
      this.mediaRecorder = new MediaRecorder(dest.stream, { mimeType });
      this.mediaRecorder.ondataavailable = (event: BlobEvent) => {
        if (event.data && event.data.size > 0) {
          this.recordedChunks.push(event.data);
        }
      };
      this.mediaRecorder.start(1000);
      this.recordingStartTime = Date.now();
      this.isRecording = true;
      console.log(`[WebRTC Recording] Bidirectional call recording started for ${this.callId} (${mimeType})`);
    } catch (err) {
      console.warn('[WebRTC Recording] Could not start recording:', err);
    }
  }

  /**
   * Mix an HTMLAudioElement (AI agent TTS voice) into the recording stream
   * so it is captured simultaneously with the user's microphone.
   * Also connects to speaker output so the user hears the AI in real time.
   */
  public mixAudioElement(audioElement: HTMLAudioElement): boolean {
    if (!this.isRecording || !this.audioContext || !this.recordingDestination) {
      return false;
    }

    try {
      if (this.audioContext.state === 'suspended') {
        this.audioContext.resume().catch(() => {});
      }

      if ((audioElement as any).__kairaMediaSourceConnected) {
        return true;
      }

      // Allow cross-origin audio streaming through Web Audio API
      audioElement.crossOrigin = 'anonymous';

      const aiSource = this.audioContext.createMediaElementSource(audioElement);
      (audioElement as any).__kairaMediaSourceConnected = true;

      const aiGain = this.audioContext.createGain();
      aiGain.gain.value = audioElement.volume !== undefined ? audioElement.volume : 1.0;

      audioElement.addEventListener('volumechange', () => {
        if (aiGain && typeof audioElement.volume === 'number') {
          aiGain.gain.value = audioElement.volume;
        }
      });

      // 1. Connect to recording destination (MediaRecorder captures AI agent voice)
      aiSource.connect(aiGain);
      aiGain.connect(this.recordingDestination);

      // 2. Connect to system audio destination (speakers) so customer hears the AI live
      aiGain.connect(this.audioContext.destination);

      // Clean up Web Audio node connections when element finishes playing
      const onEndOrError = () => {
        audioElement.removeEventListener('ended', onEndOrError);
        audioElement.removeEventListener('error', onEndOrError);
        try {
          aiGain.disconnect();
          aiSource.disconnect();
        } catch { }
      };
      audioElement.addEventListener('ended', onEndOrError);
      audioElement.addEventListener('error', onEndOrError);

      console.log('[WebRTC Recording] Successfully mixed AI agent voice into recording destination.');
      return true;
    } catch (err) {
      console.warn('[WebRTC Recording] Could not mix AI voice element into recording:', err);
      return false;
    }
  }

  private async reportRecordingUploadFailure(callId: string, reason: string): Promise<void> {
    try {
      const token = this.authToken || localStorage.getItem('kaira_token') || localStorage.getItem('token');
      if (!token) return;
      await fetch(`/api/calls/${encodeURIComponent(callId)}/quality-events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          eventType: 'recording_upload_failure',
          details: reason.slice(0, 500)
        })
      });
    } catch (err) {
      console.warn('[WebRTC Recording] Could not report upload failure:', err);
    }
  }

  // Stop recording and upload to backend
  public async stopAndUploadRecording(): Promise<void> {
    if (!this.isRecording || !this.mediaRecorder) return;
    const currentCallId = this.callId;
    const consentStatus = this.recordingConsent;
    const duration = this.recordingStartTime ? Math.round((Date.now() - this.recordingStartTime) / 1000) : 0;
    this.isRecording = false;

    return new Promise<void>((resolve) => {
      this.mediaRecorder!.onstop = async () => {
        try {
          if (consentStatus === 'granted' && this.recordedChunks.length > 0 && currentCallId) {
            const mimeType = this.mediaRecorder?.mimeType || 'audio/webm';
            const blob = new Blob(this.recordedChunks, { type: mimeType });
            console.log(`[WebRTC Recording] Uploading recording for call ${currentCallId}: ${blob.size} bytes, ${duration}s`);
            
            const formData = new FormData();
            formData.append('audio', blob, `${currentCallId}.webm`);
            formData.append('callId', currentCallId);
            formData.append('duration', String(duration));
            formData.append('consentStatus', consentStatus);
            formData.append('mimeType', mimeType);

            const token = this.authToken || localStorage.getItem('kaira_token') || localStorage.getItem('token');
            const headers: Record<string, string> = {};
            if (token) headers['Authorization'] = `Bearer ${token}`;

            // Upload recording to /api/calls/:callId/recording
            let res: Response | null = null;
            try {
              res = await fetch(`/api/calls/${currentCallId}/recording`, {
                method: 'POST',
                headers,
                body: formData
              });
              if (!res.ok) {
                await this.reportRecordingUploadFailure(currentCallId, `HTTP ${res.status}`);
              }
            } catch (err) {
              await this.reportRecordingUploadFailure(currentCallId, String(err));
              console.warn('[WebRTC Recording] /api/calls/recording error:', err);
            }

            if (res && res.ok) {
              const data = await res.json();
              console.log('[WebRTC Recording] Upload succeeded:', data);
            }
          }
        } catch (err) {
          console.warn('[WebRTC Recording] Upload error:', err);
        } finally {
          this.recordedChunks = [];
          this.mediaRecorder = null;
          if (this.audioContext && this.audioContext.state !== 'closed') {
            this.audioContext.close().catch(() => {});
            this.audioContext = null;
          }
          resolve();
        }
      };

      try {
        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
          this.mediaRecorder.stop();
        } else {
          resolve();
        }
      } catch (err) {
        console.debug('[WebRTC] MediaRecorder stop fallback:', err);
        resolve();
      }
    });
  }

  public getIsRecording(): boolean {
    return this.isRecording;
  }

  public endCall() {
    this.stopAndUploadRecording().catch(() => {});
    if (this.remoteStream) {
      this.remoteStream.getTracks().forEach(track => track.stop());
      this.remoteStream = null;
    }
    // Record final quality report in backend before tearing down
    callQualityMonitor.syncWithBackend(this.totalReconnectCount);
    callQualityMonitor.stop();

    if (this.reconnectTimeoutTimer) clearTimeout(this.reconnectTimeoutTimer);
    if (this.reconnectBackoffTimer) clearTimeout(this.reconnectBackoffTimer);
    if (this.healthReportTimer) {
      clearInterval(this.healthReportTimer);
      this.healthReportTimer = null;
    }
    this.isReconnecting = false;
    this.reconnectAttempts = 0;
    this.pendingCandidates = [];

    if (this.peerConnection) {
      try {
        this.peerConnection.close();
      } catch (err) {
        console.debug('[WebRTC] Resetting closed peer connection on end:', err);
      }
      this.peerConnection = null;
    }

    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }

    if (this.remoteAudio) {
      try {
        this.remoteAudio.pause();
      } catch (err) {
        console.debug('[WebRTC] Remote audio pause fallback:', err);
      }
      this.remoteAudio.srcObject = null;
    }

    this.targetSocketId = null;
    this.callId = null;
    this.isMuted = false;
    this.isInitiator = false;
    this.recordingConsent = 'not_requested';
  }
}

export const webrtcManager = new WebRTCManager();
