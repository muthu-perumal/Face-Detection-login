import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { adminCreateUserSchema } from '@shared/schemas';
import { api } from '@/lib/api';
import { Button, Card, Field, SelectInput, TextInput } from '@/components/ui';
import type { PublicUser } from '@shared/types';

type CreateValues = {
  fullName: string;
  employeeId: string;
  email: string;
  department: string;
  designation: string;
  password: string;
  confirmPassword: string;
  role: 'employee' | 'admin';
};

type Employee = PublicUser & { createdAt: string; faceEnrolled: boolean };

export function EmployeesPage() {
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const queryClient = useQueryClient();
  const form = useForm<CreateValues>({
    resolver: zodResolver(adminCreateUserSchema),
    defaultValues: {
      fullName: '',
      employeeId: '',
      email: '',
      department: '',
      designation: '',
      password: '',
      confirmPassword: '',
      role: 'employee',
    },
  });
  const query = useQuery({
    queryKey: ['employees', q],
    queryFn: () => api<{ employees: Employee[] }>(`/admin/employees?q=${encodeURIComponent(q)}`),
  });
  const update = useMutation({
    mutationFn: (body: { id: string; status?: string; role?: string }) =>
      api(`/admin/employees/${body.id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['employees'] });
      toast.success('Employee updated');
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const removeFace = useMutation({
    mutationFn: (id: string) => api(`/admin/employees/${id}/face`, { method: 'DELETE' }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['employees'] });
      toast.success('Face enrollment removed');
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const create = useMutation({
    mutationFn: (values: CreateValues) => api('/admin/employees', { method: 'POST', body: JSON.stringify(values) }),
    onSuccess: async () => {
      form.reset();
      setCreating(false);
      await queryClient.invalidateQueries({ queryKey: ['employees'] });
      toast.success('Account created. They can sign in now.');
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Employees</h1>
        <div className="flex flex-wrap gap-2">
          <TextInput className="max-w-xs" placeholder="Search name, email, or ID" value={q} onChange={(event) => setQ(event.target.value)} />
          <Button type="button" onClick={() => setCreating((open) => !open)}>{creating ? 'Close' : 'Create user'}</Button>
        </div>
      </div>
      {creating ? (
        <Card>
          <form className="grid gap-4 sm:grid-cols-2" onSubmit={form.handleSubmit((values) => create.mutate(values))}>
            <Field label="Full name" error={form.formState.errors.fullName?.message}><TextInput {...form.register('fullName')} /></Field>
            <Field label="Employee ID" error={form.formState.errors.employeeId?.message}><TextInput {...form.register('employeeId')} /></Field>
            <Field label="Email" error={form.formState.errors.email?.message}><TextInput type="email" {...form.register('email')} /></Field>
            <Field label="Department" error={form.formState.errors.department?.message}><TextInput {...form.register('department')} /></Field>
            <Field label="Designation" error={form.formState.errors.designation?.message}><TextInput {...form.register('designation')} /></Field>
            <Field label="Role" error={form.formState.errors.role?.message}>
              <SelectInput {...form.register('role')}>
                <option value="employee">Employee</option>
                <option value="admin">Admin</option>
              </SelectInput>
            </Field>
            <Field label="Password" error={form.formState.errors.password?.message}><TextInput type="password" {...form.register('password')} /></Field>
            <Field label="Confirm password" error={form.formState.errors.confirmPassword?.message}><TextInput type="password" {...form.register('confirmPassword')} /></Field>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={create.isPending}>Create account</Button>
            </div>
          </form>
        </Card>
      ) : null}
      <div className="space-y-3">
        {query.data?.employees.map((employee) => (
          <Card key={employee.id} className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-semibold">{employee.fullName}</p>
              <p className="text-sm text-ink-700">{employee.employeeId} · {employee.email}</p>
              <p className="text-sm text-ink-700">{employee.department} · {employee.designation} · {employee.role} · {employee.status}</p>
              <p className="text-sm text-ink-700">{employee.faceEnrolled ? 'Face enrolled' : 'Face not enrolled'}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {employee.status !== 'active' ? <Button onClick={() => update.mutate({ id: employee.id, status: 'active' })}>Approve</Button> : null}
              {employee.status === 'active' ? <Button variant="secondary" onClick={() => update.mutate({ id: employee.id, status: 'suspended' })}>Suspend</Button> : null}
              <Button variant="secondary" onClick={() => update.mutate({ id: employee.id, role: employee.role === 'admin' ? 'employee' : 'admin' })}>
                Make {employee.role === 'admin' ? 'employee' : 'admin'}
              </Button>
              {employee.faceEnrolled ? <Button variant="danger" onClick={() => removeFace.mutate(employee.id)}>Remove face</Button> : null}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
