import React, { useState, useEffect } from 'react';
import { Mic, Volume2, Settings2, CheckCircle2, AlertCircle, Play, X, Headphones, RefreshCw } from 'lucide-react';
import { audioDeviceManager, AudioDeviceInfo } from '../services/audioDevice.js';
import { webrtcManager } from '../services/webrtc.js';

interface AudioDeviceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDeviceChange?: (micId: string, speakerId: string) => void;
}

export const AudioDeviceModal: React.FC<AudioDeviceModalProps> = ({
  isOpen,
  onClose,
  onDeviceChange
}) => {
  const [microphones, setMicrophones] = useState<AudioDeviceInfo[]>([]);
  const [speakers, setSpeakers] = useState<AudioDeviceInfo[]>([]);
  const [selectedMic, setSelectedMic] = useState<string>('default');
  const [selectedSpeaker, setSelectedSpeaker] = useState<string>('default');

  const [micLevel, setMicLevel] = useState<number>(0);
  const [testingMic, setTestingMic] = useState<boolean>(false);
  const [testingSpeaker, setTestingSpeaker] = useState<boolean>(false);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [savedSuccess, setSavedSuccess] = useState<boolean>(false);

  useEffect(() => {
    if (isOpen) {
      loadDevices();
    } else {
      stopTests();
    }
    return () => {
      stopTests();
    };
  }, [isOpen]);

  const loadDevices = async () => {
    try {
      setPermissionError(null);
      // Pre-check permission
      const perm = await audioDeviceManager.checkMicrophonePermission();
      if (perm.state === 'denied') {
        setPermissionError(perm.error || 'Microphone access is blocked.');
      }

      const { microphones: mics, speakers: spks } = await audioDeviceManager.getConnectedDevices();
      setMicrophones(mics);
      setSpeakers(spks);

      const prefMic = audioDeviceManager.getPreferredMicrophoneId();
      const prefSpk = audioDeviceManager.getPreferredSpeakerId();
      setSelectedMic(prefMic);
      setSelectedSpeaker(prefSpk);

      // Start live mic test automatically when modal opens if permission granted
      if (mics.length > 0) {
        startMicTest(prefMic);
      }
    } catch (err: any) {
      setPermissionError(err.message || 'Failed to detect audio devices.');
    }
  };

  const startMicTest = async (deviceId: string) => {
    try {
      setTestingMic(true);
      await audioDeviceManager.startMicrophoneLevelTest(deviceId, (level) => {
        setMicLevel(level);
      });
    } catch (err: any) {
      setTestingMic(false);
      setPermissionError(err.message || 'Could not start microphone test.');
    }
  };

  const stopTests = () => {
    audioDeviceManager.stopMicrophoneLevelTest();
    setTestingMic(false);
    setMicLevel(0);
  };

  const handleMicChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newId = e.target.value;
    setSelectedMic(newId);
    audioDeviceManager.setPreferredMicrophoneId(newId);

    // Restart test on new device
    stopTests();
    startMicTest(newId);

    // If active call in progress, switch track
    try {
      if (webrtcManager.getCallId()) {
        await webrtcManager.switchMicrophone(newId);
      }
    } catch (err) {
      console.warn('Could not switch mic during active call:', err);
    }
  };

  const handleSpeakerChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newId = e.target.value;
    setSelectedSpeaker(newId);
    audioDeviceManager.setPreferredSpeakerId(newId);

    try {
      if (webrtcManager.getCallId()) {
        await webrtcManager.switchSpeaker(newId);
      }
    } catch (err) {
      console.warn('Could not switch speaker during active call:', err);
    }
  };

  const handleTestSpeaker = async () => {
    setTestingSpeaker(true);
    await audioDeviceManager.playSpeakerTestSound(selectedSpeaker);
    setTimeout(() => setTestingSpeaker(false), 800);
  };

  const handleSaveAndClose = () => {
    audioDeviceManager.setPreferredMicrophoneId(selectedMic);
    audioDeviceManager.setPreferredSpeakerId(selectedSpeaker);
    onDeviceChange?.(selectedMic, selectedSpeaker);

    setSavedSuccess(true);
    setTimeout(() => {
      setSavedSuccess(false);
      stopTests();
      onClose();
    }, 400);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="w-full max-w-md bg-white rounded-3xl border border-slate-200 shadow-2xl overflow-hidden text-slate-900">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/50">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-indigo-50 text-indigo-600 border border-indigo-100">
              <Headphones className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-extrabold text-base text-slate-900">Audio & Device Settings</h3>
              <p className="text-xs text-slate-500">Configure your microphone, speaker, and test levels</p>
            </div>
          </div>
          <button
            onClick={() => { stopTests(); onClose(); }}
            className="p-1.5 rounded-xl hover:bg-slate-200/60 text-slate-400 hover:text-slate-700 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5">
          {permissionError && (
            <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-500 mt-0.5" />
              <div>
                <p className="font-bold">Microphone Unavailable</p>
                <p className="mt-0.5 text-[11px] opacity-90">{permissionError}</p>
              </div>
            </div>
          )}

          {/* 1. Microphone Input Device */}
          <div className="space-y-2">
            <label className="flex items-center justify-between text-xs font-bold text-slate-700">
              <span className="flex items-center gap-1.5">
                <Mic className="w-3.5 h-3.5 text-indigo-600" /> Microphone (Audio Input)
              </span>
              <span className="text-[10px] text-slate-400">{microphones.length} detected</span>
            </label>
            <select
              value={selectedMic}
              onChange={handleMicChange}
              className="w-full p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-800 focus:outline-hidden focus:border-indigo-500 focus:bg-white transition-all cursor-pointer"
            >
              {microphones.length === 0 ? (
                <option value="default">Default System Microphone</option>
              ) : (
                microphones.map((m) => (
                  <option key={m.deviceId} value={m.deviceId}>
                    {m.label} {m.isDefault ? '(Default)' : ''}
                  </option>
                ))
              )}
            </select>

            {/* Live Microphone Level Bar */}
            <div className="p-3 rounded-2xl bg-slate-50 border border-slate-100 space-y-1.5">
              <div className="flex items-center justify-between text-[11px] text-slate-500">
                <span>Mic Input Level Test:</span>
                <span className="font-mono text-xs font-bold text-slate-700">
                  {micLevel > 0 ? `${micLevel}%` : 'Speak into mic...'}
                </span>
              </div>
              <div className="w-full h-3 rounded-full bg-slate-200 overflow-hidden p-0.5">
                <div
                  className={`h-full rounded-full transition-all duration-75 ${
                    micLevel > 75 ? 'bg-amber-500' : micLevel > 20 ? 'bg-emerald-500' : 'bg-indigo-500'
                  }`}
                  style={{ width: `${Math.max(4, micLevel)}%` }}
                />
              </div>
            </div>
          </div>

          {/* 2. Speaker Output Device */}
          <div className="space-y-2">
            <label className="flex items-center justify-between text-xs font-bold text-slate-700">
              <span className="flex items-center gap-1.5">
                <Volume2 className="w-3.5 h-3.5 text-indigo-600" /> Speaker / Headphones (Audio Output)
              </span>
              <span className="text-[10px] text-slate-400">{speakers.length} detected</span>
            </label>
            <div className="flex gap-2">
              <select
                value={selectedSpeaker}
                onChange={handleSpeakerChange}
                className="flex-1 p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-800 focus:outline-hidden focus:border-indigo-500 focus:bg-white transition-all cursor-pointer"
              >
                {speakers.map((s) => (
                  <option key={s.deviceId} value={s.deviceId}>
                    {s.label} {s.isDefault ? '(Default)' : ''}
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={handleTestSpeaker}
                disabled={testingSpeaker}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs border border-slate-200 transition-all cursor-pointer disabled:opacity-50"
                title="Play a test chime"
              >
                <Play className={`w-3.5 h-3.5 ${testingSpeaker ? 'animate-bounce text-indigo-600' : ''}`} />
                Test
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 bg-slate-50 border-t border-slate-100">
          <button
            type="button"
            onClick={loadDevices}
            className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-800 cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Re-scan Devices
          </button>

          <button
            type="button"
            onClick={handleSaveAndClose}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs shadow-md shadow-indigo-200 transition-all cursor-pointer"
          >
            {savedSuccess ? (
              <>
                <CheckCircle2 className="w-4 h-4" /> Saved!
              </>
            ) : (
              'Save & Apply'
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

