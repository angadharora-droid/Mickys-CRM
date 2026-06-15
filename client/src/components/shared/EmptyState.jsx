import { Inbox } from 'lucide-react';

export default function EmptyState({ title = 'No records found', description, icon: Icon = Inbox, children }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="rounded-2xl bg-accent/60 ring-1 ring-border p-4 mb-4">
        <Icon className="h-8 w-8 text-primary/60" />
      </div>
      <h3 className="text-lg font-semibold">{title}</h3>
      {description && <p className="text-sm text-muted-foreground mt-1 max-w-sm">{description}</p>}
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}
