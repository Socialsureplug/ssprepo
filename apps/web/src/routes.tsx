import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Spinner } from '@app/ui';
import { RequireSession } from './lib/session';
import { SiteLayout } from './site/SiteLayout';
import { HomePage } from './site/HomePage';

// Public marketing pages are eager (fast first paint); app areas are code-split.
const PricingPage = lazy(() => import('./site/PricingPage'));
const DevelopersPage = lazy(() => import('./site/DevelopersPage'));
const DocsPage = lazy(() => import('./site/DocsPage'));
const AboutPage = lazy(() => import('./site/AboutPage'));
const ContactPage = lazy(() => import('./site/ContactPage'));
const NotFoundPage = lazy(() => import('./site/NotFoundPage'));

const LoginPage = lazy(() => import('./auth/LoginPage'));
const SignupPage = lazy(() => import('./auth/SignupPage'));
const VerifyEmailPage = lazy(() => import('./auth/VerifyEmailPage'));
const ForgotPasswordPage = lazy(() => import('./auth/ForgotPasswordPage'));
const ResetPasswordPage = lazy(() => import('./auth/ResetPasswordPage'));
const AcceptInvitePage = lazy(() => import('./auth/AcceptInvitePage'));

const CheckoutPage = lazy(() => import('./checkout/CheckoutPage'));
const LinkCheckoutPage = lazy(() => import('./checkout/LinkCheckoutPage'));

const DashboardLayout = lazy(() => import('./dashboard/DashboardLayout'));
const OverviewPage = lazy(() => import('./dashboard/OverviewPage'));
const TransactionsPage = lazy(() => import('./dashboard/TransactionsPage'));
const TransactionDetailPage = lazy(() => import('./dashboard/TransactionDetailPage'));
const PaymentLinksPage = lazy(() => import('./dashboard/PaymentLinksPage'));
const PaymentLinkDetailPage = lazy(() => import('./dashboard/PaymentLinkDetailPage'));
const CustomersPage = lazy(() => import('./dashboard/CustomersPage'));
const CustomerDetailPage = lazy(() => import('./dashboard/CustomerDetailPage'));
const BalancePage = lazy(() => import('./dashboard/BalancePage'));
const SettlementsPage = lazy(() => import('./dashboard/SettlementsPage'));
const SettlementDetailPage = lazy(() => import('./dashboard/SettlementDetailPage'));
const DevelopersDashPage = lazy(() => import('./dashboard/DevelopersPage'));
const SettingsPage = lazy(() => import('./dashboard/SettingsPage'));
const OnboardingPage = lazy(() => import('./dashboard/OnboardingPage'));

const Fallback = () => <div className="flex min-h-[50vh] items-center justify-center"><Spinner /></div>;

export function AppRoutes() {
  return (
    <Suspense fallback={<Fallback />}>
      <Routes>
        <Route element={<SiteLayout />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/pricing" element={<PricingPage />} />
          <Route path="/developers" element={<DevelopersPage />} />
          <Route path="/docs" element={<DocsPage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="/contact" element={<ContactPage />} />
        </Route>

        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/verify-email" element={<VerifyEmailPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/accept-invite" element={<AcceptInvitePage />} />

        <Route path="/pay/:reference" element={<CheckoutPage />} />
        <Route path="/l/:slug" element={<LinkCheckoutPage />} />

        <Route path="/dashboard" element={<RequireSession><DashboardLayout /></RequireSession>}>
          <Route index element={<OverviewPage />} />
          <Route path="transactions" element={<TransactionsPage />} />
          <Route path="transactions/:id" element={<TransactionDetailPage />} />
          <Route path="payment-links" element={<PaymentLinksPage />} />
          <Route path="payment-links/:id" element={<PaymentLinkDetailPage />} />
          <Route path="customers" element={<CustomersPage />} />
          <Route path="customers/:id" element={<CustomerDetailPage />} />
          <Route path="balance" element={<BalancePage />} />
          <Route path="settlements" element={<SettlementsPage />} />
          <Route path="settlements/:id" element={<SettlementDetailPage />} />
          <Route path="developers" element={<DevelopersDashPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="onboarding" element={<OnboardingPage />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Route>

        <Route element={<SiteLayout />}>
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
