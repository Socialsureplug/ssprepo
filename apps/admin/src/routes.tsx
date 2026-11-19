import { lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import { Spinner } from '@app/ui';
import { RequireStaff } from './lib';
import { AdminLayout } from './AdminLayout';
import LoginPage from './pages/LoginPage';

const Overview = lazy(() => import('./pages/OverviewPage'));
const Merchants = lazy(() => import('./pages/MerchantsPage'));
const MerchantDetail = lazy(() => import('./pages/MerchantDetailPage'));
const Transactions = lazy(() => import('./pages/TransactionsPage'));
const TransactionDetail = lazy(() => import('./pages/TransactionDetailPage'));
const PaymentLinks = lazy(() => import('./pages/money').then((m) => ({ default: m.PaymentLinksPage })));
const Balances = lazy(() => import('./pages/money').then((m) => ({ default: m.BalancesPage })));
const Settlements = lazy(() => import('./pages/money').then((m) => ({ default: m.SettlementsPage })));
const Withdrawals = lazy(() => import('./pages/money').then((m) => ({ default: m.WithdrawalsPage })));
const Refunds = lazy(() => import('./pages/money').then((m) => ({ default: m.RefundsPage })));
const Providers = lazy(() => import('./pages/platform').then((m) => ({ default: m.ProvidersPage })));
const Fees = lazy(() => import('./pages/platform').then((m) => ({ default: m.FeesPage })));
const Reconciliation = lazy(() => import('./pages/platform').then((m) => ({ default: m.ReconciliationPage })));
const Risk = lazy(() => import('./pages/platform').then((m) => ({ default: m.RiskPage })));
const ApiLogs = lazy(() => import('./pages/platform').then((m) => ({ default: m.ApiLogsPage })));
const WebhookLogs = lazy(() => import('./pages/platform').then((m) => ({ default: m.WebhookLogsPage })));
const Audit = lazy(() => import('./pages/platform').then((m) => ({ default: m.AuditPage })));
const Settings = lazy(() => import('./pages/platform').then((m) => ({ default: m.SettingsPage })));

export function AdminRoutes() {
  return (
    <Suspense fallback={<div className="flex h-screen items-center justify-center"><Spinner /></div>}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<RequireStaff><AdminLayout /></RequireStaff>}>
          <Route index element={<Overview />} />
          <Route path="merchants" element={<Merchants />} />
          <Route path="merchants/:id" element={<MerchantDetail />} />
          <Route path="transactions" element={<Transactions />} />
          <Route path="transactions/:id" element={<TransactionDetail />} />
          <Route path="payment-links" element={<PaymentLinks />} />
          <Route path="balances" element={<Balances />} />
          <Route path="settlements" element={<Settlements />} />
          <Route path="withdrawals" element={<Withdrawals />} />
          <Route path="refunds" element={<Refunds />} />
          <Route path="providers" element={<Providers />} />
          <Route path="fees" element={<Fees />} />
          <Route path="reconciliation" element={<Reconciliation />} />
          <Route path="risk" element={<Risk />} />
          <Route path="logs/api" element={<ApiLogs />} />
          <Route path="logs/webhooks" element={<WebhookLogs />} />
          <Route path="audit" element={<Audit />} />
          <Route path="settings" element={<Settings />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
