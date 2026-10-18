import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { ScanFace } from 'lucide-react';
import { loginSchema } from '@shared/schemas';
import type { PublicUser } from '@shared/types';
import { useAuth } from '@/contexts/AuthContext';
import { api } from '@/lib/api';
import { Brand } from '@/components/layout/AppShell';
import { FaceScanner } from '@/components/camera/FaceScanner';
import { Button, Field, TextInput } from '@/components/ui';

type FormValues = { email: string; password: string };

export function LoginPage() {
  const { signIn, acceptSession } = useAuth();
  const navigate = useNavigate();
  const [face, setFace] = useState(false);
  const form = useForm<FormValues>({ resolver: zodResolver(loginSchema), defaultValues: { email: '', password: '' } });

  if (face) {
    return (
      <FaceScanner
        title="Sign in with your face"
        getChallenge={() => api('/auth/face/challenge', { method: 'POST' })}
        onClose={() => setFace(false)}
        onSubmit={async (payload) => {
          const result = await api<{ token: string; user: PublicUser; message: string }>('/auth/face', {
            method: 'POST',
            body: JSON.stringify(payload),
          });
          acceptSession(result.token, result.user);
          toast.success(result.message);
          navigate('/');
          return { message: result.message };
        }}
      />
    );
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <section className="hidden bg-ink-950 p-10 text-white lg:flex lg:flex-col lg:justify-between">
        <Brand />
        <div className="max-w-md">
          <h1 className="text-4xl font-semibold tracking-tight">Sign in with a password, or with the face you enrolled.</h1>
          <p className="mt-4 text-white/70">A recognized face signs you in and clocks you in. Scanning again the same day clocks you out.</p>
        </div>
        <p className="text-sm text-white/50">Asia/Kolkata by default · server-recorded times</p>
      </section>
      <section className="flex items-center justify-center px-4 py-10">
        <form
          className="w-full max-w-md space-y-5"
          onSubmit={form.handleSubmit(async (values) => {
            try {
              await signIn(values.email, values.password);
              navigate('/');
            } catch (error) {
              toast.error(error instanceof Error ? error.message : 'Sign in failed');
            }
          })}
        >
          <div className="lg:hidden"><Brand dark /></div>
          <div>
            <h2 className="text-2xl font-semibold">Sign in</h2>
            <p className="mt-1 text-sm text-ink-700">Use your email and password, or the face enrolled on your account.</p>
          </div>
          <Field label="Email" error={form.formState.errors.email?.message}>
            <TextInput type="email" autoComplete="username" {...form.register('email')} />
          </Field>
          <Field label="Password" error={form.formState.errors.password?.message}>
            <TextInput type="password" autoComplete="current-password" {...form.register('password')} />
          </Field>
          <Button className="w-full" type="submit" disabled={form.formState.isSubmitting}>Sign in</Button>
          <Button className="w-full" type="button" variant="secondary" onClick={() => setFace(true)}>
            <ScanFace size={18} /> Sign in with face
          </Button>
          <p className="text-sm text-ink-700">A face scan clocks you in. If you already clocked in today, the next scan clocks you out.</p>
          <p className="text-sm text-ink-700">New employee? <Link className="font-semibold text-pine-800" to="/register">Create an account</Link></p>
        </form>
      </section>
    </div>
  );
}
