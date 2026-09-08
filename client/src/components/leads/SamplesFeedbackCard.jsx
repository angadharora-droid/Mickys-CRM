import { useState } from 'react';
import { formatDate, formatDateTime, todayInput } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import { FlaskConical, MessageSquareQuote, Plus, Trash2, Loader2 } from 'lucide-react';

/**
 * Samples given + feedback taken — the two score-card milestones the CRM
 * had no record of. Each is a dated log on the lead; the first entry earns
 * the points. `onAddSample`, `onDeleteSample`, `onAddFeedback`,
 * `onDeleteFeedback` return promises; `action` is the page's busy key.
 */
export default function SamplesFeedbackCard({
  lead, user, action, onAddSample, onDeleteSample, onAddFeedback, onDeleteFeedback,
}) {
  const [sampleForm, setSampleForm] = useState({ givenOn: todayInput(), products: '', note: '' });
  const [feedbackForm, setFeedbackForm] = useState({ takenOn: todayInput(), note: '' });
  const [confirm, setConfirm] = useState(null); // { kind: 'sample' | 'feedback', id }

  const isAdmin = user?.role === 'admin';
  const canDelete = (entry) => isAdmin || String(entry.createdBy?._id || entry.createdBy || '') === String(user?._id || '');
  const samples = [...(lead.samples || [])].sort((a, b) => new Date(b.givenOn) - new Date(a.givenOn));
  const feedbacks = [...(lead.feedbacks || [])].sort((a, b) => new Date(b.takenOn) - new Date(a.takenOn));

  const addSample = () =>
    onAddSample({ givenOn: sampleForm.givenOn, products: sampleForm.products.trim(), note: sampleForm.note.trim() })
      .then(() => setSampleForm({ givenOn: todayInput(), products: '', note: '' }))
      .catch(() => {});

  const addFeedback = () =>
    onAddFeedback({ takenOn: feedbackForm.takenOn, note: feedbackForm.note.trim() })
      .then(() => setFeedbackForm({ takenOn: todayInput(), note: '' }))
      .catch(() => {});

  const runDelete = () => {
    const { kind, id } = confirm;
    const p = kind === 'sample' ? onDeleteSample(id) : onDeleteFeedback(id);
    p.then(() => setConfirm(null)).catch(() => {});
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-muted-foreground" /> Samples &amp; Feedback
          </span>
          {(samples.length > 0 || feedbacks.length > 0) && (
            <Badge variant="secondary">
              {[
                samples.length ? `${samples.length} sample${samples.length === 1 ? '' : 's'}` : '',
                feedbacks.length ? `${feedbacks.length} feedback` : '',
              ].filter(Boolean).join(' · ')}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-6 lg:grid-cols-2">
        {/* Samples given */}
        <div className="space-y-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <FlaskConical className="h-3.5 w-3.5" /> Samples given
          </p>
          <div className="space-y-2 rounded-lg border p-3">
            <div className="grid gap-2 sm:grid-cols-[150px_1fr]">
              <div className="space-y-1.5">
                <Label>Given on</Label>
                <Input type="date" value={sampleForm.givenOn} onChange={(e) => setSampleForm((f) => ({ ...f, givenOn: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Products</Label>
                <Input
                  placeholder="e.g. Makhani Gravy 1kg, Ginger Garlic Paste"
                  value={sampleForm.products}
                  onChange={(e) => setSampleForm((f) => ({ ...f, products: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Note (optional)</Label>
              <Input
                placeholder="Who received them, what to check next…"
                value={sampleForm.note}
                onChange={(e) => setSampleForm((f) => ({ ...f, note: e.target.value }))}
              />
            </div>
            <div className="flex justify-end">
              <Button size="sm" onClick={addSample} disabled={!sampleForm.givenOn || action === 'sample-add'}>
                {action === 'sample-add' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Log samples given
              </Button>
            </div>
          </div>
          {samples.length === 0 ? (
            <p className="text-sm text-muted-foreground">No samples logged yet.</p>
          ) : (
            <ul className="space-y-2">
              {samples.map((s) => (
                <li key={s._id} className="flex items-start justify-between gap-3 rounded-lg border p-3">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-muted-foreground">Given {formatDate(s.givenOn)}</p>
                    {s.products && <p className="mt-0.5 text-sm font-medium break-words">{s.products}</p>}
                    {s.note && <p className="mt-0.5 text-sm whitespace-pre-wrap break-words">{s.note}</p>}
                    <p className="mt-1 text-xs text-muted-foreground">
                      {s.createdBy?.name || 'Unknown'} · logged {formatDateTime(s.createdAt)}
                    </p>
                  </div>
                  {canDelete(s) && (
                    <Button
                      variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-destructive" title="Delete"
                      onClick={() => setConfirm({ kind: 'sample', id: s._id })}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Feedback taken */}
        <div className="space-y-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <MessageSquareQuote className="h-3.5 w-3.5" /> Feedback taken
          </p>
          <div className="space-y-2 rounded-lg border p-3">
            <div className="space-y-1.5">
              <Label>Taken on</Label>
              <Input
                type="date" className="sm:w-[150px]" value={feedbackForm.takenOn}
                onChange={(e) => setFeedbackForm((f) => ({ ...f, takenOn: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>What the client said *</Label>
              <Textarea
                rows={3}
                placeholder="Their view on the samples, prices, packaging…"
                value={feedbackForm.note}
                onChange={(e) => setFeedbackForm((f) => ({ ...f, note: e.target.value }))}
              />
            </div>
            <div className="flex justify-end">
              <Button size="sm" onClick={addFeedback} disabled={!feedbackForm.note.trim() || !feedbackForm.takenOn || action === 'feedback-add'}>
                {action === 'feedback-add' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Log feedback
              </Button>
            </div>
          </div>
          {feedbacks.length === 0 ? (
            <p className="text-sm text-muted-foreground">No feedback logged yet.</p>
          ) : (
            <ul className="space-y-2">
              {feedbacks.map((f) => (
                <li key={f._id} className="flex items-start justify-between gap-3 rounded-lg border p-3">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-muted-foreground">Taken {formatDate(f.takenOn)}</p>
                    <p className="mt-0.5 text-sm whitespace-pre-wrap break-words">{f.note}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {f.createdBy?.name || 'Unknown'} · logged {formatDateTime(f.createdAt)}
                    </p>
                  </div>
                  {canDelete(f) && (
                    <Button
                      variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-destructive" title="Delete"
                      onClick={() => setConfirm({ kind: 'feedback', id: f._id })}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>

      <ConfirmDialog
        open={Boolean(confirm)}
        onOpenChange={(o) => { if (!o) setConfirm(null); }}
        title={confirm?.kind === 'sample' ? 'Delete this samples record?' : 'Delete this feedback?'}
        description="It will be removed from the lead and its score card recalculated."
        confirmLabel="Delete"
        loading={action === 'sample-del' || action === 'feedback-del'}
        onConfirm={runDelete}
      />
    </Card>
  );
}
