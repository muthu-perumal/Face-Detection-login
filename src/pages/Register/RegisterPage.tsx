import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { registerSchema } from '@shared/schemas';
import { authService } from '@/services/auth/authService';
import { useAuth } from '@/contexts/AuthContext';
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
  const form = useForm<FormValues>({ resolver: zodResolver(registerSchema) });

  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-4 py-8">
      <form
        className="space-y-4 rounded-3xl border border-line bg-white p-5 shadow-card"
        onSubmit={form.handleSubmit(async (values) => {
          try {
            const created = await authService.register({ ...values, avatarData });
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
        <Field label="Profile photo, optional">
          <input
            className="block w-full text-sm"
            type="file"
            accept="image/jpeg,image/png"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              try {
                setAvatarData(await readProfilePhoto(file));
              } catch (error) {
                toast.error(error instanceof Error ? error.message : 'Could not use that photo');
              }
            }}
          />
        </Field>
        <Button className="w-full" type="submit" disabled={form.formState.isSubmitting}>Create account</Button>
        <p className="text-sm text-ink-700">Already registered? <Link className="font-semibold text-pine-800" to="/login">Sign in</Link></p>
      </form>
    </div>
  );
}
