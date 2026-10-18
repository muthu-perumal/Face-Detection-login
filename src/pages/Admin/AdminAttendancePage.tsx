import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { formatClock, formatDuration, zonedTimeToIso } from '@shared/attendance';
import { api, getToken } from '@/lib/api';
import { Button, Card, Field, SelectInput, StatusBadge, TextInput } from '@/components/ui';
import type { AttendanceRecord, AttendanceStatus } from '@shared/types';

type Row = { date: string; records: AttendanceRecord[] };

export function AdminAttendancePage() {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [from, setFrom] = useState(today.slice(0, 8) + '01');
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['admin-attendance', date],
    queryFn: () => api<Row>(`/admin/attendance?date=${date}`),
  });
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api<{ settings: { timezone: string } }>('/settings') });
  const correct = useMutation({
    mutationFn: (body: unknown) => api('/admin/attendance', { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin-attendance'] });
      toast.success('Attendance corrected');
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const timeZone = settings.data?.settings.timezone || 'Asia/Kolkata';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Daily attendance</h1>
        <div className="flex gap-2">
          <TextInput type="date" value={date} onChange={(event) => setDate(event.target.value)} className="w-40" />
          <TextInput type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="w-40" />
          <Button
            type="button"
            onClick={async () => {
              const response = await fetch(`/api/admin/export?from=${from}&to=${date}`, {
                headers: { authorization: `Bearer ${getToken() || ''}` },
              });
              if (!response.ok) {
                toast.error('Could not export the report');
                return;
              }
              const blob = await response.blob();
              const url = URL.createObjectURL(blob);
              const link = document.createElement('a');
              link.href = url;
              link.download = `attendance-${from}-to-${date}.csv`;
              link.click();
              URL.revokeObjectURL(url);
            }}
          >
            Export CSV
          </Button>
        </div>
      </div>
      <div className="space-y-3">
        {query.data?.records.map((record) => (
          <Card key={record.id} className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-semibold">{record.fullName}</p>
                <p className="text-sm text-ink-700">{record.employeeCode} · {record.department}</p>
              </div>
              <StatusBadge status={record.displayStatus} />
            </div>
            <p className="text-sm">
              {record.clockInAt ? formatClock(new Date(record.clockInAt), timeZone) : '—'} – {record.clockOutAt ? formatClock(new Date(record.clockOutAt), timeZone) : '—'} · {formatDuration(record.totalMinutes)}
            </p>
            <CorrectionForm
              employeeId={record.employeeId}
              date={record.attendanceDate}
              timeZone={timeZone}
              onSave={(body) => correct.mutate(body)}
            />
          </Card>
        ))}
        {query.data && query.data.records.length === 0 ? <p className="text-sm text-ink-700">No attendance stored for this date. Add a correction from an employee record if needed.</p> : null}
      </div>
    </div>
  );
}

function CorrectionForm({
  employeeId,
  date,
  timeZone,
  onSave,
}: {
  employeeId: string;
  date: string;
  timeZone: string;
  onSave: (body: unknown) => void;
}) {
  const [clockIn, setClockIn] = useState('09:00');
  const [clockOut, setClockOut] = useState('');
  const [status, setStatus] = useState<AttendanceStatus>('present');
  const [note, setNote] = useState('');
  return (
    <form
      className="grid gap-3 md:grid-cols-5"
      onSubmit={(event) => {
        event.preventDefault();
        onSave({
          employeeId,
          attendanceDate: date,
          clockInAt: clockIn ? zonedTimeToIso(date, clockIn, timeZone) : null,
          clockOutAt: clockOut ? zonedTimeToIso(date, clockOut, timeZone) : null,
          status,
          note,
        });
      }}
    >
      <Field label="Clock in"><TextInput type="time" value={clockIn} onChange={(event) => setClockIn(event.target.value)} /></Field>
      <Field label="Clock out"><TextInput type="time" value={clockOut} onChange={(event) => setClockOut(event.target.value)} /></Field>
      <Field label="Status">
        <SelectInput value={status} onChange={(event) => setStatus(event.target.value as AttendanceStatus)}>
          <option value="present">Present</option>
          <option value="late">Late</option>
          <option value="absent">Absent</option>
          <option value="incomplete">Incomplete</option>
          <option value="pending_review">Pending review</option>
        </SelectInput>
      </Field>
      <Field label="Reason"><TextInput value={note} onChange={(event) => setNote(event.target.value)} /></Field>
      <div className="flex items-end"><Button type="submit">Save correction</Button></div>
    </form>
  );
}
