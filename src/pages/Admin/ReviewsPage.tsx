import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Button, Card } from '@/components/ui';

type Review = {
  id: string;
  full_name: string;
  employee_code: string;
  attendance_date: string;
  requested_action: string;
  reason: string;
  status: string;
  created_at: string;
};

export function ReviewsPage() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ['reviews'], queryFn: () => api<{ reviews: Review[] }>('/admin/reviews') });
  const resolve = useMutation({
    mutationFn: (body: { id: string; decision: 'approved' | 'rejected'; note: string }) =>
      api(`/admin/reviews/${body.id}`, { method: 'POST', body: JSON.stringify({ decision: body.decision, note: body.note }) }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['reviews'] });
      toast.success('Review updated');
    },
    onError: (error: Error) => toast.error(error.message),
  });
  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-semibold">Manual review</h1>
      {query.data?.reviews.map((review) => (
        <Card key={review.id} className="space-y-2">
          <p className="font-semibold">{review.full_name} · {review.employee_code}</p>
          <p className="text-sm text-ink-700">{review.attendance_date} · {review.requested_action} · {review.status}</p>
          <p className="text-sm">{review.reason}</p>
          {review.status === 'pending' ? (
            <div className="flex gap-2">
              <Button onClick={() => resolve.mutate({ id: review.id, decision: 'approved', note: 'Approved by administrator' })}>Approve</Button>
              <Button variant="secondary" onClick={() => resolve.mutate({ id: review.id, decision: 'rejected', note: 'Rejected by administrator' })}>Reject</Button>
            </div>
          ) : null}
        </Card>
      ))}
      {query.data && query.data.reviews.length === 0 ? <p className="text-sm text-ink-700">No reviews yet.</p> : null}
    </div>
  );
}
