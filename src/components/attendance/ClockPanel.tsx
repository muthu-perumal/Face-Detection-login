import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { attendanceService } from '@/services/attendance/attendanceService';
import { FaceScanner } from '@/components/camera/FaceScanner';
import { Button } from '@/components/ui';
import type { AttendanceSettings } from '@shared/types';

export function ClockPanel({
  settings,
  faceEnrolled,
  clockedIn,
  clockedOut,
}: {
  settings: AttendanceSettings;
  faceEnrolled: boolean;
  clockedIn: boolean;
  clockedOut: boolean;
}) {
  const queryClient = useQueryClient();
  const [action, setAction] = useState<'in' | 'out' | null>(null);
  const manual = useMutation({
    mutationFn: (kind: 'in' | 'out') =>
      kind === 'in' ? attendanceService.clockIn({ method: 'manual' }) : attendanceService.clockOut({ method: 'manual' }),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries();
      toast.success(result.message || 'Submitted for review');
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const nextAction = !clockedIn ? 'in' : !clockedOut ? 'out' : null;

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Button
          className="w-full"
          disabled={!nextAction || nextAction !== 'in' || (settings.requireFaceVerification && !faceEnrolled)}
          onClick={() => (settings.requireFaceVerification ? setAction('in') : manual.mutate('in'))}
        >
          Clock In
        </Button>
        <Button
          className="w-full"
          variant="secondary"
          disabled={nextAction !== 'out' || (settings.requireFaceVerification && !faceEnrolled)}
          onClick={() => (settings.requireFaceVerification ? setAction('out') : manual.mutate('out'))}
        >
          Clock Out
        </Button>
      </div>
      {settings.requireFaceVerification && !faceEnrolled ? (
        <p className="text-sm text-ink-700">Enroll a face before using face verification, or request a manual record if your company allows it.</p>
      ) : null}
      {settings.allowManualAttendance && nextAction ? (
        <Button className="w-full" variant="ghost" disabled={manual.isPending} onClick={() => manual.mutate(nextAction)}>
          {settings.requireFaceVerification ? `Request manual clock ${nextAction === 'in' ? 'in' : 'out'}` : `Clock ${nextAction === 'in' ? 'in' : 'out'} without a camera`}
        </Button>
      ) : null}
      {action ? (
        <div className="fixed inset-0 z-50 bg-ink-950/80 sm:grid sm:place-items-center sm:p-6">
          <div className="sm:w-full sm:max-w-lg">
            <FaceScanner
              title={action === 'in' ? 'Clock in' : 'Clock out'}
              onClose={() => setAction(null)}
              onSubmit={async (payload) => {
                const result = action === 'in'
                  ? await attendanceService.clockIn({ method: 'face', ...payload })
                  : await attendanceService.clockOut({ method: 'face', ...payload });
                await queryClient.invalidateQueries();
                toast.success(result.message);
                return result;
              }}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
