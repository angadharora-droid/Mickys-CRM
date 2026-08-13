import PageHeader from '@/components/shared/PageHeader';
import EmptyState from '@/components/shared/EmptyState';
import { Card } from '@/components/ui/card';
import { ReceiptText } from 'lucide-react';

export default function SalesOrders() {
  return (
    <div>
      <PageHeader title="Sales Orders" description="Create and track sales orders against live Tally stock" />
      <Card>
        <EmptyState
          icon={ReceiptText}
          title="No sales orders yet"
          description="Order creation is the next step in this module — you'll build orders from in-stock items with live quantities from Tally."
        />
      </Card>
    </div>
  );
}
