import { useQuery } from '@tanstack/react-query';
import { formatClock, formatDuration } from '@shared/attendance';
import { attendanceService } from '@/services/attendance/attendanceService';
import { ClockPanel } from '@/components/attendance/ClockPanel';
import { Card, StatusBadge } from '@/components/ui';

export function AttendancePage() {
  const query = useQuery({ queryKey: ['dashboard'], queryFn: attendanceService.dashboard });
  if (query.isLoading || !query.data) return <p className="text-sm text-ink-700">Loading attendance…</p>;
  const { todayRecord: record, settings } = query.data;
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <h1 className="text-2xl font-semibold">Attendance</h1>
      <Card className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm text-ink-700">{query.data.today}</p>
          <StatusBadge status={record?.displayStatus || 'absent'} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <p><span className="block text-sm text-ink-700">Clock in</span><span className="text-xl font-semibold">{record?.clockInAt ? formatClock(new Date(record.clockInAt), settings.timezone) : '—'}</span></p>
          <p><span className="block text-sm text-ink-700">Clock out</span><span className="text-xl font-semibold">{record?.clockOutAt ? formatClock(new Date(record.clockOutAt), settings.timezone) : '—'}</span></p>
        </div>
        <p className="text-sm text-ink-700">Total working time <span className="font-semibold text-ink-950">{formatDuration(record?.totalMinutes)}</span></p>
        <ClockPanel settings={settings} faceEnrolled={query.data.faceEnrolled} clockedIn={Boolean(record?.clockInAt)} clockedOut={Boolean(record?.clockOutAt)} />
      </Card>
    </div>
  );
}
