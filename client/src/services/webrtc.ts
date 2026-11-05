import { getSocket } from './socket.js';

export class WebRTCManager {
  private peerConnection: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private remoteAudio: HTMLAudioElement | null = null;
  private targetSocketId: string | null = null;
  private callId: string | null = null;
  private isMuted: boolean = false;

  private rtcConfig: RTCConfiguration = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ]
  };

  constructor() {
    this.setupSocketListeners();
  }

  // Ensure remote audio element exists
  private getAudioElement(): HTMLAudioElement {
    if (!this.remoteAudio) {
      this.remoteAudio = new Audio();
      this.remoteAudio.autoplay = true;
      document.body.appendChild(this.remoteAudio);
    }
    return this.remoteAudio;
  }

  private setupSocketListeners() {
    const socket = getSocket();

    // Handle incoming WebRTC offer
    socket.on('webrtc:offer', async (data: { sender: string; offer: RTCSessionDescriptionInit; callId: string }) => {
      console.log('[WebRTC] Received offer from', data.sender);
      this.targetSocketId = data.sender;
      this.callId = data.callId;

      await this.initPeerConnection();
      await this.peerConnection!.setRemoteDescription(new RTCSessionDescription(data.offer));

      const answer = await this.peerConnection!.createAnswer();
      await this.peerConnection!.setLocalDescription(answer);

      socket.emit('webrtc:answer', {
        target: data.sender,
        answer,
        callId: data.callId
      });
    });

    // Handle incoming WebRTC answer
    socket.on('webrtc:answer', async (data: { sender: string; answer: RTCSessionDescriptionInit; callId: string }) => {
      console.log('[WebRTC] Received answer from', data.sender);
      if (this.peerConnection) {
        await this.peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
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
  }

  // Request user microphone permission and store local audio stream
  public async getMicrophoneStream(): Promise<MediaStream> {
    if (this.localStream) return this.localStream;
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        },
        video: false
      });
      return this.localStream;
    } catch (err) {
      console.error('[WebRTC] Failed to access microphone:', err);
      throw err;
    }
  }

  // Initialize RTCPeerConnection
  private async initPeerConnection(): Promise<RTCPeerConnection> {
    if (this.peerConnection) return this.peerConnection;

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
      if (event.candidate && this.callId) {
        const socket = getSocket();
        socket.emit('webrtc:ice-candidate', {
          target: this.targetSocketId,
          candidate: event.candidate,
          callId: this.callId
        });
      }
    };

    this.peerConnection.onconnectionstatechange = () => {
      console.log('[WebRTC] Connection state:', this.peerConnection?.connectionState);
    };

    return this.peerConnection;
  }

  // Start outgoing call to peer (create offer)
  public async startCall(targetSocketId: string, callId: string) {
    this.targetSocketId = targetSocketId;
    this.callId = callId;

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

  // Set speaker volume (0 to 1)
  public setVolume(volume: number) {
    if (this.remoteAudio) {
      this.remoteAudio.volume = Math.max(0, Math.min(1, volume));
    }
  }

  // Clean up all streams and close peer connection
  public endCall() {
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
  }
}

export const webrtcManager = new WebRTCManager();
