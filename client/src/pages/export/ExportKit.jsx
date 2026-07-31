import { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { ROLES } from '@/lib/constants';
import PageHeader from '@/components/shared/PageHeader';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import Destinations from './Destinations';
import ExchangeRates from './ExchangeRates';

/**
 * Export Settings — the master data behind export-kit leads: destination
 * countries (CIR insurance / part-load freight), full-load container costs and
 * the daily exchange rates. Export kits themselves are built on a lead
 * (Leads → kit type "Export Kit").
 */
export default function ExportKit() {
  const { user } = useAuth();
  const isAdmin = user?.role === ROLES.ADMIN;
  const [tab, setTab] = useState('destinations');

  return (
    <div>
      <PageHeader
        title="Export Settings"
        description="Destinations, container costs and exchange rates used by export-kit leads"
      />

      <Tabs value={tab} onValueChange={setTab} className="mb-4">
        <TabsList>
          <TabsTrigger value="destinations">Destinations</TabsTrigger>
          <TabsTrigger value="fx">Exchange Rates</TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === 'destinations' && <Destinations isAdmin={isAdmin} />}
      {tab === 'fx' && <ExchangeRates isAdmin={isAdmin} />}
    </div>
  );
}
