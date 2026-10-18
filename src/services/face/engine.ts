type FaceApi = typeof import('@vladmandic/face-api');

export type DetectedFace = {
  box: { x: number; y: number; width: number; height: number };
  landmarks: {
    getNose(): Array<{ x: number; y: number }>;
    getLeftEye(): Array<{ x: number; y: number }>;
    getRightEye(): Array<{ x: number; y: number }>;
  };
  descriptor: Float32Array;
};

let loading: Promise<FaceApi> | null = null;

export function loadFaceEngine(): Promise<FaceApi> {
  if (!loading) {
    loading = (async () => {
      const faceapi = await import('@vladmandic/face-api');
      const tf = faceapi.tf as unknown as { setBackend(name: string): Promise<boolean>; ready(): Promise<void> };
      try {
        await tf.setBackend('webgl');
        await tf.ready();
      } catch {
        await tf.setBackend('cpu');
        await tf.ready();
      }
      const sources = ['/models', 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/model'];
      let lastError: unknown;
      for (const source of sources) {
        try {
          await faceapi.nets.tinyFaceDetector.loadFromUri(source);
          await faceapi.nets.faceLandmark68Net.loadFromUri(source);
          await faceapi.nets.faceRecognitionNet.loadFromUri(source);
          return faceapi;
        } catch (error) {
          lastError = error;
        }
      }
      loading = null;
      throw lastError instanceof Error ? lastError : new Error('Face models could not be loaded.');
    })();
  }
  return loading;
}

export async function detectFaces(video: HTMLVideoElement): Promise<DetectedFace[]> {
  const faceapi = await loadFaceEngine();
  const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.45 });
  const found = await faceapi.detectAllFaces(video, options).withFaceLandmarks().withFaceDescriptors();
  return found.map((face) => ({
    box: face.detection.box,
    landmarks: face.landmarks,
    descriptor: face.descriptor,
  }));
}
