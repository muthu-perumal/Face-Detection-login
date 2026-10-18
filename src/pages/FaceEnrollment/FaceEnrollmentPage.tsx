import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CONSENT_VERSION } from '@shared/types';
import { faceService } from '@/services/face/faceService';
import { FaceScanner } from '@/components/camera/FaceScanner';
import { Button, Card } from '@/components/ui';

export function FaceEnrollmentPage() {
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: ['face'], queryFn: faceService.status });
  const [accepted, setAccepted] = useState(false);
  const [open, setOpen] = useState(false);
  const remove = useMutation({
    mutationFn: faceService.remove,
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['face'] });
      toast.success(result.message);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <h1 className="text-2xl font-semibold">Face enrollment</h1>
      <Card className="space-y-3 text-sm leading-6 text-ink-800">
        <p>Enrollment stores an encrypted numeric face descriptor. It does not store the camera video or an enrollment photograph.</p>
        <p>{status.data?.disclosure}</p>
        <p>You can delete the template later, subject to company policy, and use manual attendance when that option is enabled.</p>
        <label className="flex items-start gap-3">
          <input className="mt-1 h-5 w-5" type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} />
          <span>I consent to collection of a facial geometry template for attendance, consent version {CONSENT_VERSION}.</span>
        </label>
        <Button disabled={!accepted} onClick={() => setOpen(true)}>{status.data?.enrollment ? 'Re-enroll face' : 'Start enrollment'}</Button>
        {status.data?.enrollment ? <Button variant="danger" disabled={remove.isPending} onClick={() => remove.mutate()}>Delete enrolled face</Button> : null}
      </Card>
      {open ? (
        <div className="fixed inset-0 z-50 bg-ink-950/80 sm:grid sm:place-items-center sm:p-6">
          <div className="sm:w-full sm:max-w-lg">
            <FaceScanner
              title="Enrollment"
              onClose={() => setOpen(false)}
              onSubmit={async (payload) => {
                const result = await faceService.enroll({ ...payload, consentAccepted: true, consentVersion: CONSENT_VERSION });
                await queryClient.invalidateQueries({ queryKey: ['face'] });
                await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
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
