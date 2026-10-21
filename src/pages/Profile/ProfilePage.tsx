import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { profileSchema } from '@shared/schemas';
import { api } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { disclosureText, faceService } from '@/services/face/faceService';
import { Button, Card, Field, TextInput } from '@/components/ui';
import type { PublicUser } from '@shared/types';

export function ProfilePage() {
  const { user, setUser, signOut } = useAuth();
  const face = useQuery({ queryKey: ['face'], queryFn: faceService.status });
  const form = useForm({
    resolver: zodResolver(profileSchema),
    values: {
      fullName: user?.fullName || '',
      department: user?.department || '',
      designation: user?.designation || '',
      currentPassword: '',
      newPassword: '',
    },
  });
  const save = useMutation({
    mutationFn: (values: { fullName: string; department: string; designation: string; currentPassword?: string; newPassword?: string }) =>
      api<{ user: PublicUser }>('/profile', { method: 'PATCH', body: JSON.stringify(values) }),
    onSuccess: (result) => {
      setUser(result.user);
      toast.success('Profile updated');
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <h1 className="text-2xl font-semibold">Profile</h1>
      <Card className="space-y-2">
        <p className="text-sm text-ink-700">Employee ID</p>
        <p className="text-xl font-semibold">{user?.employeeId}</p>
        <p className="text-sm text-ink-700">{user?.email}</p>
      </Card>
      <Card>
        <form className="space-y-4" onSubmit={form.handleSubmit((values) => save.mutate(values))}>
          <Field label="Full name"><TextInput {...form.register('fullName')} /></Field>
          <Field label="Department"><TextInput {...form.register('department')} /></Field>
          <Field label="Designation"><TextInput {...form.register('designation')} /></Field>
          <Field label="Current password"><TextInput type="password" {...form.register('currentPassword')} /></Field>
          <Field label="New password"><TextInput type="password" {...form.register('newPassword')} /></Field>
          <Button type="submit" disabled={save.isPending}>Save profile</Button>
        </form>
      </Card>
      <Card className="space-y-3">
        <h2 className="font-semibold">Face enrollment</h2>
        <p className="text-sm text-ink-700">{face.data?.enrollment ? `Enrolled ${new Date(face.data.enrollment.enrolledAt).toLocaleString()}` : 'No face enrolled.'}</p>
        <p className="text-sm text-ink-700">{disclosureText(face.data?.disclosure)}</p>
        <Link className="inline-flex min-h-11 items-center font-semibold text-pine-800" to="/enroll">Manage face enrollment</Link>
      </Card>
      {user?.role === 'admin' ? (
        <Card className="space-y-2">
          <h2 className="font-semibold">Administration</h2>
          <div className="grid gap-2 text-sm font-semibold text-pine-800">
            <Link to="/admin">Dashboard</Link>
            <Link to="/admin/employees">Employees</Link>
            <Link to="/admin/attendance">Daily attendance</Link>
            <Link to="/admin/reviews">Manual review</Link>
            <Link to="/admin/settings">Settings</Link>
          </div>
        </Card>
      ) : null}
      <Button variant="secondary" onClick={() => void signOut()}>Sign out</Button>
    </div>
  );
}
