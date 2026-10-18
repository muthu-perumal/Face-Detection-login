import { mkdir, writeFile, access } from 'fs/promises';
import path from 'path';

const version = '1.7.15';
const base = `https://cdn.jsdelivr.net/npm/@vladmandic/face-api@${version}/model`;
const files = [
  'tiny_face_detector_model-weights_manifest.json',
  'tiny_face_detector_model.bin',
  'face_landmark_68_model-weights_manifest.json',
  'face_landmark_68_model.bin',
  'face_recognition_model-weights_manifest.json',
  'face_recognition_model.bin',
];

const directory = path.join(process.cwd(), 'public', 'models');
await mkdir(directory, { recursive: true });

for (const file of files) {
  const target = path.join(directory, file);
  try {
    await access(target);
    console.log(`exists ${file}`);
    continue;
  } catch {
    /* download */
  }
  const response = await fetch(`${base}/${file}`);
  if (!response.ok) throw new Error(`Failed to download ${file}: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(target, bytes);
  console.log(`saved ${file} (${bytes.length} bytes)`);
}
