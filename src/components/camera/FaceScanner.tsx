import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, RefreshCw, SwitchCamera, X } from 'lucide-react';
import type { ChallengeInstruction, LandmarkSample } from '@shared/types';
import { detectFaces, loadFaceEngine, type DetectedFace } from '@/services/face/engine';
import { Button } from '@/components/ui';
import { VERIFICATION_DISCLOSURE } from '@shared/types';

type ScanState =
  | { kind: 'initializing' | 'permission' | 'error' | 'submitting' | 'success' | 'failed'; message: string }
  | { kind: 'position'; message: string; tone: 'wait' | 'good' }
  | { kind: 'challenge'; message: string; instruction: ChallengeInstruction };

type Payload = { challengeId: string; samples: number[][]; landmarks: LandmarkSample[] };

export function FaceScanner({
  title,
  onSubmit,
  onClose,
  getChallenge,
}: {
  title: string;
  onSubmit: (payload: Payload) => Promise<{ message: string }>;
  onClose: () => void;
  getChallenge?: () => Promise<{ challengeId: string; instruction: ChallengeInstruction; prompt: string }>;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<ScanState>({ kind: 'initializing', message: 'Starting camera' });
  const [mirrored, setMirrored] = useState(true);
  const mirroredRef = useRef(true);
  const [canSwitch, setCanSwitch] = useState(false);
  const [deviceIndex, setDeviceIndex] = useState(0);
  const [session, setSession] = useState(0);
  const submitRef = useRef(onSubmit);
  submitRef.current = onSubmit;
  const challengeLoader = useRef(getChallenge);
  challengeLoader.current = getChallenge;
  const retryRef = useRef<() => void>(() => {});

  useEffect(() => {
    const videoElement = videoRef.current;
    if (!videoElement) return;
    const video: HTMLVideoElement = videoElement;
    let cancelled = false;
    let stream: MediaStream | null = null;
    let frame = 0;
    let phase: 'position' | 'challenge' | 'capture' | 'hold' = 'position';
    let stableSince = 0;
    let last = 0;
    let lastDescriptor = 0;
    let challenge: { challengeId: string; instruction: ChallengeInstruction; prompt: string } | null = null;
    let challengeStarted = 0;
    let captureStarted = 0;
    const landmarks: LandmarkSample[] = [];
    const samples: number[][] = [];

    const stopStream = () => {
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
      video.srcObject = null;
    };

    retryRef.current = () => {
      phase = 'position';
      stableSince = 0;
      challenge = null;
      landmarks.length = 0;
      samples.length = 0;
      setState({ kind: 'position', tone: 'wait', message: 'Position your face inside the oval' });
    };

    const loop = (time: number) => {
      if (cancelled) return;
      frame = requestAnimationFrame(loop);
      if (phase === 'hold' || video.readyState < 2 || time - last < 140) return;
      last = time;
      void scan(time);
    };

    async function scan(time: number) {
      const faces = await detectFaces(video);
      if (cancelled || phase === 'hold') return;
      if (faces.length !== 1) {
        stableSince = 0;
        setState({
          kind: 'position',
          tone: 'wait',
          message: faces.length === 0 ? 'Position your face inside the oval' : 'Only one face should be in the frame',
        });
        return;
      }
      const face = faces[0];
      if (phase === 'position') {
        const quality = faceQuality(video, face);
        if (!quality.ok) {
          stableSince = 0;
          setState({ kind: 'position', tone: 'wait', message: quality.message });
          return;
        }
        if (!stableSince) stableSince = time;
        setState({ kind: 'position', tone: 'good', message: 'Face detected. Hold still.' });
        if (time - stableSince < 700) return;
        phase = 'hold';
        try {
          const next = challengeLoader.current
            ? await challengeLoader.current()
            : await (await import('@/services/face/faceService')).faceService.challenge();
          if (cancelled) return;
          challenge = next;
          challengeStarted = performance.now();
          landmarks.length = 0;
          samples.length = 0;
          phase = 'challenge';
          setState({ kind: 'challenge', message: next.prompt, instruction: next.instruction });
        } catch (error) {
          phase = 'position';
          setState({ kind: 'failed', message: error instanceof Error ? error.message : 'Could not start verification.' });
        }
        return;
      }
      if (!challenge) return;
      if (phase === 'challenge') {
        landmarks.push(toLandmark(video, face, mirroredRef.current));
        if (performance.now() - challengeStarted < 2400) return;
        if (landmarks.length < 8) {
          phase = 'hold';
          setState({ kind: 'failed', message: 'The face was not stable enough. Look at the camera and follow the arrow.' });
          return;
        }
        phase = 'capture';
        captureStarted = performance.now();
        samples.length = 0;
        setState({ kind: 'position', tone: 'good', message: 'Hold still while your face is checked.' });
        return;
      }
      if (time - lastDescriptor > 180 && samples.length < 5) {
        samples.push(Array.from(face.descriptor));
        lastDescriptor = time;
      }
      if (samples.length < 4 && performance.now() - captureStarted < 1800) return;
      phase = 'hold';
      if (samples.length < 3) {
        setState({ kind: 'failed', message: 'Hold still for a moment so your face can be checked.' });
        return;
      }
      setState({ kind: 'submitting', message: 'Checking the face template' });
      try {
        const result = await submitRef.current({ challengeId: challenge.challengeId, samples, landmarks });
        stopStream();
        cancelAnimationFrame(frame);
        setState({ kind: 'success', message: result.message });
      } catch (error) {
        setState({ kind: 'failed', message: error instanceof Error ? error.message : 'Verification failed' });
      }
    }

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setState({ kind: 'error', message: 'This browser cannot open a camera. Use Android Chrome, iPhone Safari, or a current desktop browser over HTTPS.' });
        return;
      }
      try {
        setState({ kind: 'initializing', message: 'Starting camera' });
        const listed = await navigator.mediaDevices.enumerateDevices();
        const cameras = listed.filter((device) => device.kind === 'videoinput');
        setCanSwitch(cameras.length > 1);
        const chosen = cameras[deviceIndex];
        const rear = /back|rear|environment/i.test(chosen?.label || '');
        mirroredRef.current = !rear;
        setMirrored(!rear);
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: chosen?.deviceId
            ? { deviceId: { exact: chosen.deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
            : { facingMode: rear ? 'environment' : 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        });
        if (cancelled) {
          stopStream();
          return;
        }
        video.srcObject = stream;
        video.muted = true;
        await video.play();
        setState({ kind: 'initializing', message: 'Loading face detection' });
        await loadFaceEngine();
        if (cancelled) return;
        setState({ kind: 'position', tone: 'wait', message: 'Position your face inside the oval' });
        frame = requestAnimationFrame(loop);
      } catch (error) {
        const name = error instanceof DOMException ? error.name : '';
        if (name === 'NotAllowedError' || name === 'SecurityError') {
          setState({ kind: 'permission', message: 'Camera permission is blocked. Allow camera access in the browser settings, then retry.' });
        } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
          setState({ kind: 'error', message: 'No usable camera was found on this device.' });
        } else if (name === 'NotReadableError') {
          setState({ kind: 'error', message: 'The camera is busy in another app. Close it and retry.' });
        } else {
          setState({ kind: 'error', message: error instanceof Error ? error.message : 'The camera could not be opened.' });
        }
      }
    }

    void start();
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      stopStream();
    };
  }, [deviceIndex, session]);

  const arrow = state.kind === 'challenge'
    ? state.instruction === 'turn_left'
      ? <ArrowLeft />
      : state.instruction === 'turn_right'
        ? <ArrowRight />
        : <ArrowDown />
    : null;

  return (
    <div className="relative flex h-[100dvh] flex-col bg-ink-950 text-white sm:h-[min(760px,92dvh)] sm:overflow-hidden sm:rounded-3xl">
      <div className="flex items-center justify-between px-4 py-3">
        <div>
          <p className="text-sm text-white/60">{title}</p>
          <p className="text-base font-semibold">Face check</p>
        </div>
        <button className="grid h-11 w-11 place-items-center rounded-full bg-white/10" onClick={onClose} aria-label="Close camera">
          <X />
        </button>
      </div>
      <div className="relative mx-4 min-h-0 flex-1 overflow-hidden rounded-3xl bg-black">
        <video ref={videoRef} autoPlay muted playsInline className={`h-full w-full object-cover ${mirrored ? '-scale-x-100' : ''}`} />
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className={`scan-mask h-[68%] w-[74%] max-w-[290px] rounded-[50%] border-2 ${state.kind === 'position' && state.tone === 'good' ? 'border-teal-300' : 'border-white/90'}`} />
        </div>
        {arrow ? <div className="absolute left-1/2 top-6 -translate-x-1/2 rounded-full bg-white/90 p-3 text-ink-950">{arrow}</div> : null}
      </div>
      <div className="space-y-3 px-4 py-4">
        <p className="min-h-12 text-center text-base" aria-live="polite">{state.message}</p>
        <p className="text-center text-xs leading-5 text-white/60">{VERIFICATION_DISCLOSURE.summary}</p>
        <div className="grid grid-cols-2 gap-2">
          {canSwitch ? (
            <Button variant="secondary" onClick={() => setDeviceIndex((value) => value + 1)}>
              <SwitchCamera size={16} /> Switch camera
            </Button>
          ) : <span />}
          {state.kind === 'failed' || state.kind === 'error' || state.kind === 'permission' ? (
            <Button onClick={() => (state.kind === 'failed' ? retryRef.current() : setSession((value) => value + 1))}>
              <RefreshCw size={16} /> Retry
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function faceQuality(video: HTMLVideoElement, face: DetectedFace): { ok: boolean; message: string } {
  const width = face.box.width / video.videoWidth;
  const centerX = (face.box.x + face.box.width / 2) / video.videoWidth;
  const centerY = (face.box.y + face.box.height / 2) / video.videoHeight;
  if (width < 0.22) return { ok: false, message: 'Move a little closer to the camera' };
  if (width > 0.78) return { ok: false, message: 'Move a little farther from the camera' };
  if (Math.abs(centerX - 0.5) > 0.18 || Math.abs(centerY - 0.48) > 0.2) return { ok: false, message: 'Center your face inside the oval' };
  const brightness = sampleBrightness(video, face.box);
  if (brightness < 45) return { ok: false, message: 'The lighting is too dark. Face a window or lamp.' };
  if (brightness > 220) return { ok: false, message: 'The lighting is too bright. Reduce backlight.' };
  return { ok: true, message: 'Face detected' };
}

function sampleBrightness(video: HTMLVideoElement, box: DetectedFace['box']): number {
  const canvas = document.createElement('canvas');
  canvas.width = 24;
  canvas.height = 24;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return 128;
  context.drawImage(video, box.x, box.y, box.width, box.height, 0, 0, 24, 24);
  const pixels = context.getImageData(0, 0, 24, 24).data;
  let total = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    total += 0.2126 * pixels[index] + 0.7152 * pixels[index + 1] + 0.0722 * pixels[index + 2];
  }
  return total / (pixels.length / 4);
}

function toLandmark(video: HTMLVideoElement, face: DetectedFace, mirrored: boolean): LandmarkSample {
  const nose = averagePoint(face.landmarks.getNose());
  const left = averagePoint(face.landmarks.getLeftEye());
  const right = averagePoint(face.landmarks.getRightEye());
  const rawX = nose.x / video.videoWidth;
  return {
    noseX: mirrored ? 1 - rawX : rawX,
    noseY: nose.y / video.videoHeight,
    eyeDX: Math.abs(right.x - left.x) / video.videoWidth,
    t: Date.now(),
  };
}

function averagePoint(points: Array<{ x: number; y: number }>) {
  const x = points.reduce((sum, point) => sum + point.x, 0) / points.length;
  const y = points.reduce((sum, point) => sum + point.y, 0) / points.length;
  return { x, y };
}
