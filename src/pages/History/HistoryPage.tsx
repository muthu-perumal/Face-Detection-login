import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { eachDate, formatClock, formatDuration, isoWeekday, monthBounds } from '@shared/attendance';
import { attendanceService } from '@/services/attendance/attendanceService';
import { Card, SelectInput, StatusBadge, TextInput } from '@/components/ui';
import { cn } from '@/lib/cn';

export function HistoryPage() {
  const now = new Date();
  const [month, setMonth] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
  const [status, setStatus] = useState('');
  const [year, monthNumber] = month.split('-').map(Number);
  const bounds = monthBounds(year, monthNumber);
  const query = useQuery({
    queryKey: ['history', bounds.from, bounds.to, status],
    queryFn: () => attendanceService.history(bounds.from, bounds.to, status),
  });
  const cells = useMemo(() => {
    const dates = eachDate(bounds.from, bounds.to);
    return { lead: isoWeekday(bounds.from) - 1, dates };
  }, [bounds.from, bounds.to]);
  const byDate = new Map(query.data?.records.map((record) => [record.attendanceDate, record]));
  const timeZone = query.data?.settings.timezone || 'Asia/Kolkata';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-semibold">History</h1>
        <div className="flex gap-2">
          <TextInput type="month" value={month} onChange={(event) => setMonth(event.target.value)} className="w-40" />
          <SelectInput value={status} onChange={(event) => setStatus(event.target.value)} className="w-40">
            <option value="">All statuses</option>
            <option value="present">Present</option>
            <option value="late">Late</option>
            <option value="absent">Absent</option>
            <option value="incomplete">Incomplete</option>
            <option value="pending_review">Pending review</option>
          </SelectInput>
        </div>
      </div>
      <Card>
        <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-ink-700">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => <span key={day}>{day}</span>)}
        </div>
        <div className="mt-2 grid grid-cols-7 gap-1">
          {Array.from({ length: cells.lead }, (_, index) => <span key={`lead-${index}`} />)}
          {cells.dates.map((date) => {
            const record = byDate.get(date);
            return (
              <div key={date} className={cn('rounded-lg px-1 py-2 text-center text-xs', record ? 'bg-teal-50 text-teal-900' : 'bg-mist text-ink-700')}>
                <div className="font-semibold">{Number(date.slice(8))}</div>
                <div className="truncate">{record ? record.displayStatus.replace('_', ' ') : ''}</div>
              </div>
            );
          })}
        </div>
      </Card>
      <div className="space-y-2">
        {query.data?.records.map((record) => (
          <Card key={record.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div>
              <p className="font-medium">{record.attendanceDate}</p>
              <p className="text-sm text-ink-700">
                {record.clockInAt ? formatClock(new Date(record.clockInAt), timeZone) : '—'} – {record.clockOutAt ? formatClock(new Date(record.clockOutAt), timeZone) : '—'}
              </p>
            </div>
            <p className="text-sm font-medium">{formatDuration(record.totalMinutes)}</p>
            <StatusBadge status={record.displayStatus} />
          </Card>
        ))}
        {query.data && query.data.records.length === 0 ? <p className="text-sm text-ink-700">No records in this range.</p> : null}
      </div>
    </div>
  );
}
