import { useEffect, useState } from 'react';
import { formatClock } from '@shared/attendance';

export function LiveClock({ timeZone, serverTime }: { timeZone: string; serverTime?: string }) {
  const [now, setNow] = useState(() => (serverTime ? new Date(serverTime) : new Date()));
  useEffect(() => {
    if (serverTime) setNow(new Date(serverTime));
  }, [serverTime]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow((current) => new Date(current.getTime() + 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [serverTime]);
  const date = new Intl.DateTimeFormat('en-IN', {
    timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(now);
  return (
    <div>
      <p className="text-3xl font-semibold tracking-tight text-ink-950">{formatClock(now, timeZone)}</p>
      <p className="text-sm text-ink-700">{date} · {timeZone}</p>
    </div>
  );
}
