import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '@/lib/api';
import { StatCard } from '@/components/dashboard/StatCard';
import { Card } from '@/components/ui';

type Summary = {
  totalEmployees: number;
  activeEmployees: number;
  presentToday: number;
  lateToday: number;
  absentToday: number;
  yetToClockIn: number;
  clockedIn: number;
  pendingReviews: number;
  incompleteToday: number;
  series: Array<{ date: string; present: number; late: number; incomplete: number }>;
};

export function AdminHomePage() {
  const query = useQuery({ queryKey: ['admin-summary'], queryFn: () => api<Summary>('/admin/summary') });
  if (!query.data) return <p className="text-sm text-ink-700">Loading organization attendance…</p>;
  const data = query.data;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Organization</h1>
        <div className="flex flex-wrap gap-3 text-sm font-semibold text-pine-800">
          <Link to="/admin/employees">Employees</Link>
          <Link to="/admin/attendance">Today</Link>
          <Link to="/admin/reviews">Reviews ({data.pendingReviews})</Link>
          <Link to="/admin/settings">Settings</Link>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Employees" value={data.totalEmployees} hint={`${data.activeEmployees} active`} />
        <StatCard label="Present today" value={data.presentToday} />
        <StatCard label="Late today" value={data.lateToday} />
        <StatCard label={data.absentToday ? 'Absent today' : 'Yet to clock in'} value={data.absentToday || data.yetToClockIn} />
        <StatCard label="Clocked in now" value={data.clockedIn} />
        <StatCard label="Incomplete" value={data.incompleteToday} />
        <StatCard label="Pending review" value={data.pendingReviews} />
      </div>
      <Card>
        <h2 className="mb-4 font-semibold">Last 14 days</h2>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.series.map((item) => ({ ...item, label: item.date.slice(5) }))}>
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Legend />
              <Bar dataKey="present" stackId="a" fill="#115e59" />
              <Bar dataKey="late" stackId="a" fill="#d97706" />
              <Bar dataKey="incomplete" stackId="a" fill="#ea580c" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}
