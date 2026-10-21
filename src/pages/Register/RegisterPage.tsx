import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { registerSchema } from '@shared/schemas';
import { authService } from '@/services/auth/authService';
import { useAuth } from '@/contexts/AuthContext';
import { descriptorFromImage } from '@/services/face/engine';
import { Button, Field, TextInput } from '@/components/ui';
import { readProfilePhoto } from '@/utils/image';

type FormValues = {
  fullName: string;
  employeeId: string;
  email: string;
  department: string;
  designation: string;
  password: string;
  confirmPassword: string;
};

export function RegisterPage() {
  const navigate = useNavigate();
  const { signIn } = useAuth();
  const [avatarData, setAvatarData] = useState<string | null>(null);
  const [faceDescriptor, setFaceDescriptor] = useState<number[] | null>(null);
  const [photoNote, setPhotoNote] = useState('A clear photo of your face is what face sign-in will recognize.');
  const [readingPhoto, setReadingPhoto] = useState(false);
  const form = useForm<FormValues>({ resolver: zodResolver(registerSchema) });

  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-4 py-8">
      <form
        className="space-y-4 rounded-3xl border border-line bg-white p-5 shadow-card"
        onSubmit={form.handleSubmit(async (values) => {
          try {
            const created = await authService.register({ ...values, avatarData, faceDescriptor });
            toast.success(created.message);
            if (!created.pending) {
              await signIn(values.email, values.password);
              navigate('/');
            } else {
              navigate('/login');
            }
          } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Registration failed');
          }
        })}
      >
        <div>
          <h1 className="text-2xl font-semibold">Create your account</h1>
          <p className="mt-1 text-sm text-ink-700">Employee ID and email must be unique. Accounts are employees unless an administrator changes the role.</p>
        </div>
        <Field label="Full name" error={form.formState.errors.fullName?.message}><TextInput {...form.register('fullName')} /></Field>
        <Field label="Employee ID" error={form.formState.errors.employeeId?.message}><TextInput {...form.register('employeeId')} /></Field>
        <Field label="Email" error={form.formState.errors.email?.message}><TextInput type="email" {...form.register('email')} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Department" error={form.formState.errors.department?.message}><TextInput {...form.register('department')} /></Field>
          <Field label="Designation" error={form.formState.errors.designation?.message}><TextInput {...form.register('designation')} /></Field>
        </div>
        <Field label="Password" error={form.formState.errors.password?.message}><TextInput type="password" {...form.register('password')} /></Field>
        <Field label="Confirm password" error={form.formState.errors.confirmPassword?.message}><TextInput type="password" {...form.register('confirmPassword')} /></Field>
        <Field label="Face photo">
          <input
            className="block w-full text-sm"
            type="file"
            accept="image/jpeg,image/png"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              setAvatarData(null);
              setFaceDescriptor(null);
              if (!file) return;
              setReadingPhoto(true);
              setPhotoNote('Looking for a face in that photo…');
              try {
                const image = await loadFile(file);
                const canvas = fittedCanvas(image, 960);
                const descriptor = await descriptorFromImage(canvas);
                setAvatarData(await readProfilePhoto(file));
                setFaceDescriptor(descriptor);
                setPhotoNote('Face found. Face sign-in will use this photo.');
              } catch (error) {
                setPhotoNote('A clear photo of your face is what face sign-in will recognize.');
                toast.error(error instanceof Error ? error.message : 'Could not use that photo');
              } finally {
                setReadingPhoto(false);
              }
            }}
          />
          <span className="mt-1 block text-sm text-ink-700">{photoNote}</span>
        </Field>
        <Button className="w-full" type="submit" disabled={form.formState.isSubmitting || readingPhoto}>Create account</Button>
        <p className="text-sm text-ink-700">Already registered? <Link className="font-semibold text-pine-800" to="/login">Sign in</Link></p>
      </form>
    </div>
  );
}

function loadFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read that photo'));
    };
    image.src = url;
  });
}

function fittedCanvas(image: HTMLImageElement, maxSize: number): HTMLCanvasElement {
  const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not process that photo');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}
