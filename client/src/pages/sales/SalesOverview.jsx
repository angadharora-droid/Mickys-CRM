import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import api, { apiError } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { ROLES } from '@/lib/constants';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import PageHeader from '@/components/shared/PageHeader';
import StatCard from '@/components/shared/StatCard';
import EmptyState from '@/components/shared/EmptyState';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Boxes, PackageCheck, IndianRupee, Tags, ReceiptText, RefreshCw, ClipboardList, TriangleAlert, BarChart3,
  Settings,
} from 'lucide-react';

export default function SalesOverview() {
  const { user } = useAuth();
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchSummary = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/stock/summary');
      setSummary(data.data);
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  const totals = summary?.totals;
  const lastSync = summary?.lastSync;

  return (
    <div>
      <PageHeader
        title="Sales Overview"
        description={
          lastSync
            ? `Stock synced from Tally ${formatDateTime(lastSync.at)} (${lastSync.itemCount} items${lastSync.by ? ` · by ${lastSync.by}` : ''})`
            : 'Live stock position from Tally'
        }
      >
        <Button asChild variant="outline">
          <Link to="/sales/stock">
            <Boxes className="h-4 w-4" /> View stock
          </Link>
        </Button>
        {/* The bottom tab bar is full at five tabs, so this header is how a
            phone reaches the rest of the module — reports for everyone, and
            settings for an admin. */}
        <Button asChild variant="outline">
          <Link to="/sales/reports">
            <BarChart3 className="h-4 w-4" /> Reports
          </Link>
        </Button>
        {user?.role === ROLES.ADMIN && (
          <Button asChild variant="outline">
            <Link to="/sales/settings">
              <Settings className="h-4 w-4" /> Settings
            </Link>
          </Button>
        )}
      </PageHeader>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
      ) : !lastSync ? (
        <Card>
          <EmptyState
            icon={RefreshCw}
            title="No stock data yet"
            description="Export the Mickys Stock report from Tally as XML and upload it on the Stock page to bring your inventory in."
          >
            <Button asChild>
              <Link to="/sales/stock">Go to Stock page</Link>
            </Button>
          </EmptyState>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <StatCard title="Stock Items" value={totals.items.toLocaleString('en-IN')} icon={Boxes} />
            <StatCard
              title="In Stock"
              value={totals.inStock.toLocaleString('en-IN')}
              hint="Items Tally holds a quantity of"
              icon={PackageCheck}
              tone="success"
            />
            <StatCard
              title="Stock Value in Tally"
              value={formatCurrency(totals.closingValue)}
              hint="Before open orders are taken off"
              icon={IndianRupee}
              tone="gold"
            />
            <StatCard
              title="Committed on Orders"
              value={formatCurrency(totals.reservedValue)}
              hint={`${totals.reservedItems.toLocaleString('en-IN')} item${totals.reservedItems === 1 ? '' : 's'} promised on sales orders`}
              icon={ClipboardList}
              tone="warning"
            />
            <Link to="/sales/stock?availability=short" className="block">
              <StatCard
                title="Short (Oversold)"
                value={totals.shortItems.toLocaleString('en-IN')}
                hint="Sold beyond stock — tap to see them"
                icon={TriangleAlert}
                tone={totals.shortItems > 0 ? 'danger' : 'success'}
              />
            </Link>
            <StatCard title="Stock Groups" value={summary.byGroup.length} icon={Tags} />
          </div>

          <div className="grid gap-4 mt-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-base">Stock by group</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Group</TableHead>
                      <TableHead className="text-right">Items</TableHead>
                      <TableHead className="text-right hidden sm:table-cell">In stock</TableHead>
                      <TableHead className="text-right">Short</TableHead>
                      <TableHead className="text-right hidden sm:table-cell">Closing value</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {summary.byGroup.map((g) => (
                      <TableRow key={g.group}>
                        <TableCell>
                          <Badge variant="secondary">{g.group}</Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{g.items}</TableCell>
                        <TableCell className="text-right tabular-nums hidden sm:table-cell">{g.inStock}</TableCell>
                        <TableCell className={`text-right tabular-nums ${g.shortItems > 0 ? 'text-red-600' : 'text-muted-foreground'}`}>
                          {g.shortItems}
                        </TableCell>
                        <TableCell className="text-right tabular-nums hidden sm:table-cell">{formatCurrency(g.closingValue)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Sales orders</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col items-start gap-3 text-sm text-muted-foreground">
                  <div className="rounded-xl bg-accent/60 ring-1 ring-border p-3">
                    <ReceiptText className="h-6 w-6 text-primary/60" />
                  </div>
                  <p>
                    Every order that has not reached Tally yet holds its items back, so the stock page shows what is
                    genuinely left to sell rather than what Tally still counts.
                  </p>
                  {summary.orphanReservations?.items > 0 && (
                    <p>
                      {summary.orphanReservations.items} ordered item
                      {summary.orphanReservations.items === 1 ? '' : 's'} no longer exist in Tally&rsquo;s stock list,
                      so nothing is being held back for them.
                    </p>
                  )}
                  <Button asChild variant="outline" size="sm">
                    <Link to="/sales/orders">Open Sales Orders</Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
