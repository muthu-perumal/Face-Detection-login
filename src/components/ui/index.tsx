import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';
import type { AttendanceStatus } from '@shared/types';

export function Button({
  className,
  variant = 'primary',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger' }) {
  return (
    <button
      className={cn(
        'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50',
        variant === 'primary' && 'bg-pine-800 text-white hover:bg-pine-600',
        variant === 'secondary' && 'border border-line bg-white text-ink-900 hover:bg-mist',
        variant === 'ghost' && 'text-ink-800 hover:bg-white',
        variant === 'danger' && 'bg-rose-700 text-white hover:bg-rose-800',
        className,
      )}
      {...props}
    />
  );
}

export function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-1.5 text-sm">
      <span className="font-medium text-ink-800">{label}</span>
      {children}
      {error ? <span className="block text-sm text-rose-700">{error}</span> : null}
    </label>
  );
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        'min-h-11 w-full rounded-xl border border-line bg-white px-3 text-base text-ink-950 outline-none placeholder:text-ink-700/50',
        props.className,
      )}
    />
  );
}

export function SelectInput(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={cn('min-h-11 w-full rounded-xl border border-line bg-white px-3 text-base', props.className)}
    />
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cn('rounded-2xl border border-line bg-white p-4 shadow-card sm:p-5', className)}>{children}</section>;
}

const statusCopy: Record<AttendanceStatus, string> = {
  present: 'Present',
  late: 'Late',
  absent: 'Absent',
  incomplete: 'Incomplete',
  pending_review: 'Pending review',
};

export function StatusBadge({ status }: { status: AttendanceStatus | string }) {
  const key = status as AttendanceStatus;
  return (
    <span
      className={cn(
        'inline-flex rounded-full px-2.5 py-1 text-xs font-semibold',
        key === 'present' && 'bg-teal-50 text-teal-800',
        key === 'late' && 'bg-amber-50 text-amber-800',
        key === 'absent' && 'bg-rose-50 text-rose-800',
        key === 'incomplete' && 'bg-orange-50 text-orange-800',
        key === 'pending_review' && 'bg-slate-100 text-slate-700',
      )}
    >
      {statusCopy[key] || status}
    </span>
  );
}

export function Spinner() {
  return <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-current border-r-transparent" />;
}

export function statusLabel(status: string): string {
  return statusCopy[status as AttendanceStatus] || status;
}
