import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Button, Card, Field, TextInput } from '@/components/ui';
import type { AttendanceSettings, ReenrollPolicy } from '@shared/types';

const days = [
  [1, 'Mon'],
  [2, 'Tue'],
  [3, 'Wed'],
  [4, 'Thu'],
  [5, 'Fri'],
  [6, 'Sat'],
  [7, 'Sun'],
] as const;

export function SettingsPage() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ['admin-settings'], queryFn: () => api<{ settings: AttendanceSettings }>('/admin/settings') });
  const [form, setForm] = useState<AttendanceSettings | null>(null);
  useEffect(() => {
    if (query.data) setForm(query.data.settings);
  }, [query.data]);
  const save = useMutation({
    mutationFn: (settings: AttendanceSettings) => api('/admin/settings', { method: 'PUT', body: JSON.stringify(settings) }),
    onSuccess: async () => {
      await queryClient.invalidateQueries();
      toast.success('Settings saved. Attendance rules are enforced on the server.');
    },
    onError: (error: Error) => toast.error(error.message),
  });
  if (!form) return <p className="text-sm text-ink-700">Loading settings…</p>;
  const update = (patch: Partial<AttendanceSettings>) => setForm({ ...form, ...patch });
  return (
    <form className="mx-auto max-w-3xl space-y-4" onSubmit={(event) => { event.preventDefault(); save.mutate(form); }}>
      <h1 className="text-2xl font-semibold">Attendance settings</h1>
      <Card className="grid gap-4 md:grid-cols-2">
        <Field label="Company timezone"><TextInput value={form.timezone} onChange={(event) => update({ timezone: event.target.value })} /></Field>
        <Field label="Face distance threshold">
          <TextInput type="number" step="0.01" min="0.2" max="1.2" value={form.faceDistanceThreshold} onChange={(event) => update({ faceDistanceThreshold: Number(event.target.value) })} />
        </Field>
        <Field label="Work start"><TextInput type="time" value={form.workStartTime} onChange={(event) => update({ workStartTime: event.target.value })} /></Field>
        <Field label="Work end"><TextInput type="time" value={form.workEndTime} onChange={(event) => update({ workEndTime: event.target.value })} /></Field>
        <Field label="Grace period (minutes)"><TextInput type="number" value={form.gracePeriodMinutes} onChange={(event) => update({ gracePeriodMinutes: Number(event.target.value) })} /></Field>
        <Field label="Late arrival threshold (minutes)"><TextInput type="number" value={form.lateThresholdMinutes} onChange={(event) => update({ lateThresholdMinutes: Number(event.target.value) })} /></Field>
      </Card>
      <Card>
        <p className="mb-2 text-sm font-medium">Working days</p>
        <div className="flex flex-wrap gap-2">
          {days.map(([value, label]) => {
            const active = form.workingDays.includes(value);
            return (
              <button
                key={value}
                type="button"
                className={`min-h-11 rounded-xl px-3 text-sm font-semibold ${active ? 'bg-pine-800 text-white' : 'bg-mist text-ink-800'}`}
                onClick={() => update({ workingDays: active ? form.workingDays.filter((day) => day !== value) : [...form.workingDays, value].sort() })}
              >
                {label}
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-sm text-ink-700">An arrival after the start time plus the grace period is marked late. The distance threshold is an uncalibrated face-api descriptor distance, not an identity probability.</p>
      </Card>
      <Card className="space-y-3 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" checked={form.allowManualAttendance} onChange={(event) => update({ allowManualAttendance: event.target.checked })} /> Allow manual attendance</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={form.requireFaceVerification} onChange={(event) => update({ requireFaceVerification: event.target.checked })} /> Require face verification</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={form.requireAdminApproval} onChange={(event) => update({ requireAdminApproval: event.target.checked })} /> Require administrator approval for new accounts</label>
        <Field label="Face re-enrollment">
          <select className="min-h-11 w-full rounded-xl border border-line px-3" value={form.faceReenrollPolicy} onChange={(event) => update({ faceReenrollPolicy: event.target.value as ReenrollPolicy })}>
            <option value="self_service">Employees can re-enroll</option>
            <option value="admin_only">Administrator reset only</option>
            <option value="disabled">Re-enrollment disabled</option>
          </select>
        </Field>
      </Card>
      <Button type="submit" disabled={save.isPending}>Save settings</Button>
    </form>
  );
}
