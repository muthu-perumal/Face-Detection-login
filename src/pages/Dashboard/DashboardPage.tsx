import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatClock, formatDuration } from '@shared/attendance';
import { CONSENT_VERSION } from '@shared/types';
import { attendanceService } from '@/services/attendance/attendanceService';
import { descriptorFromImage } from '@/services/face/engine';
import { faceService } from '@/services/face/faceService';
import { useAuth } from '@/contexts/AuthContext';
import { ClockPanel } from '@/components/attendance/ClockPanel';
import { LiveClock } from '@/components/dashboard/LiveClock';
import { StatCard } from '@/components/dashboard/StatCard';
import { Card, StatusBadge } from '@/components/ui';

export function DashboardPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const photoTried = useRef(false);
  const query = useQuery({ queryKey: ['dashboard'], queryFn: attendanceService.dashboard });
  useEffect(() => {
    if (photoTried.current || !query.data || query.data.faceEnrolled || !user?.avatarData) return;
    photoTried.current = true;
    const avatar = user.avatarData;
    void (async () => {
      try {
        const image = await loadDataUrl(avatar);
        const descriptor = await descriptorFromImage(image);
        await faceService.enrollPhoto({ consentAccepted: true, consentVersion: CONSENT_VERSION, descriptor });
        await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
        await queryClient.invalidateQueries({ queryKey: ['face'] });
        toast.success('Your profile photo can now be used for face sign-in.');
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'That profile photo could not be used for face sign-in.');
      }
    })();
  }, [query.data, queryClient, user]);
  if (query.isLoading) return <p className="text-sm text-ink-700">Loading today…</p>;
  if (query.isError || !query.data) return <p className="text-sm text-rose-700">{query.error instanceof Error ? query.error.message : 'Could not load the dashboard.'}</p>;
  const data = query.data;
  const record = data.todayRecord;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-ink-700">Welcome back</p>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{user?.fullName}</h1>
          <p className="text-sm text-ink-700">{user?.employeeId} · {user?.department}</p>
        </div>
        <LiveClock timeZone={data.settings.timezone} serverTime={data.serverTime} />
      </div>
      <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <Card className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Today</h2>
            {record ? <StatusBadge status={record.displayStatus} /> : <StatusBadge status="absent" />}
          </div>
          <dl className="grid grid-cols-3 gap-3 text-sm">
            <div><dt className="text-ink-700">Clock in</dt><dd className="font-semibold">{record?.clockInAt ? formatClock(new Date(record.clockInAt), data.settings.timezone) : '—'}</dd></div>
            <div><dt className="text-ink-700">Clock out</dt><dd className="font-semibold">{record?.clockOutAt ? formatClock(new Date(record.clockOutAt), data.settings.timezone) : '—'}</dd></div>
            <div><dt className="text-ink-700">Worked</dt><dd className="font-semibold">{formatDuration(record?.totalMinutes)}</dd></div>
          </dl>
          <ClockPanel
            settings={data.settings}
            faceEnrolled={data.faceEnrolled}
            clockedIn={Boolean(record?.clockInAt)}
            clockedOut={Boolean(record?.clockOutAt)}
          />
          {data.reviews.length ? <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">You have {data.reviews.length} attendance request(s) waiting for review.</p> : null}
        </Card>
        <Card>
          <h2 className="text-lg font-semibold">This month</h2>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <StatCard label="Present" value={data.month.present} />
            <StatCard label="Late" value={data.month.late} />
            <StatCard label="Absent" value={data.month.absent} />
            <StatCard label="Hours" value={formatDuration(data.month.workedMinutes)} />
          </div>
        </Card>
      </div>
      <Card>
        <h2 className="mb-4 text-lg font-semibold">Hours this month</h2>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.series.map((item) => ({ ...item, label: item.date.slice(8) }))}>
              <XAxis dataKey="label" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip />
              <Bar dataKey="minutes" fill="#115e59" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <Card>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Recent records</h2>
          <Link className="text-sm font-semibold text-pine-800" to="/history">View history</Link>
        </div>
        <div className="space-y-2">
          {data.recent.length === 0 ? <p className="text-sm text-ink-700">No attendance yet.</p> : data.recent.map((item) => (
            <div key={item.id} className="flex items-center justify-between gap-3 rounded-xl bg-mist px-3 py-2 text-sm">
              <span>{item.attendanceDate}</span>
              <StatusBadge status={item.displayStatus} />
              <span>{formatDuration(item.totalMinutes)}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function loadDataUrl(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not read the saved profile photo'));
    image.src = url;
  });
}
