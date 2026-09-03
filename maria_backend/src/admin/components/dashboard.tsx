import React from 'react';
import { Box, H2, H4, Icon, Text } from '@adminjs/design-system';

const ADMIN_ROOT_PATH = '/admin';

type QuickLink = {
  label: string;
  description: string;
  /** AdminJS resource-backed page - mutually exclusive with `href`. */
  resourceId?: string;
  /** Plain server-rendered page (Bulk Pricing, Company Wallet, etc) - mutually exclusive with `resourceId`. */
  href?: string;
  icon: string;
};

// One card per resource an admin actually works with day-to-day. Kept in the
// same grouping order as the sidebar navigation (Customers, Ledger, Products,
// Wallet, Communication, Access Control) so the dashboard reads as a map of
// the sidebar rather than a separate, unrelated list.
const quickLinks: QuickLink[] = [
  { label: 'Customers', description: 'Users, KYC status & profiles', resourceId: 'User', icon: 'Users' },
  { label: 'Ledger', description: 'Transactions, reversals & history', resourceId: 'Transaction', icon: 'List' },
  {
    label: 'CAC Registration Requests',
    description: 'Business name/company filings awaiting manual CAC registration',
    href: `${ADMIN_ROOT_PATH}/resources/Transaction?filters.type=CAC_SERVICE_REQUEST`,
    icon: 'Briefcase'
  },
  {
    label: 'BVN License Requests',
    description: 'Agent BVN license enrollments awaiting manual processing',
    href: `${ADMIN_ROOT_PATH}/resources/Transaction?filters.type=BVN_LICENSE_ONBOARDING`,
    icon: 'CreditCard'
  },
  {
    label: 'NIN Modification Requests',
    description: 'Manual NIN correction requests awaiting re-keying on techhubltd.co',
    href: `${ADMIN_ROOT_PATH}/resources/Transaction?filters.type=NIN_MODIFICATION`,
    icon: 'Edit'
  },
  {
    label: 'BVN Modification Requests',
    description: 'Manual BVN correction requests awaiting processing by an agent',
    href: `${ADMIN_ROOT_PATH}/resources/Transaction?filters.type=BVN_MODIFICATION`,
    icon: 'Edit3'
  },
  {
    label: 'User Wallet Activity',
    description: 'Look up any customer: funding, spend & recent transactions',
    href: `${ADMIN_ROOT_PATH}/user-wallet`,
    icon: 'Search'
  },
  {
    label: 'Customer Activity',
    description: 'Top customers, what they bought, and reward candidates',
    href: `${ADMIN_ROOT_PATH}/customer-activity`,
    icon: 'Award'
  },
  {
    label: 'Support Inbox',
    description: 'Complaints sent in from customer dashboards - reply inline',
    href: `${ADMIN_ROOT_PATH}/support-inbox`,
    icon: 'MessageCircle'
  },
  {
    label: 'User Deliveries',
    description: 'Upload a manual PDF, image or token file for one customer',
    href: `${ADMIN_ROOT_PATH}/user-deliveries`,
    icon: 'Upload'
  },
  {
    label: 'Company Wallet',
    description: 'Revenue, provider cost & net profit by service',
    href: `${ADMIN_ROOT_PATH}/company-wallet`,
    icon: 'TrendingUp'
  },
  {
    label: 'Provider Ledger',
    description: 'Our balance at Alrahuz/Techhub, settlements & adjustments',
    href: `${ADMIN_ROOT_PATH}/provider-ledger`,
    icon: 'Repeat'
  },
  {
    label: 'Provider Reconciliation',
    description: 'Transactions stuck "processing" at any provider - confirm success/failure by hand',
    href: `${ADMIN_ROOT_PATH}/provider-reconciliation`,
    icon: 'AlertTriangle'
  },
  {
    label: 'Data Plan Pricing',
    description: 'Set prices for data plans',
    resourceId: 'DataPlanPricing',
    icon: 'ShoppingCart'
  },
  {
    label: 'Bulk Pricing',
    description: 'Reprice every data plan / service in one click',
    href: `${ADMIN_ROOT_PATH}/bulk-pricing`,
    icon: 'Sliders'
  },
  {
    label: 'Service Pricing',
    description: 'NIN/BVN (Techhub) & result pin (Alrahuz) prices',
    resourceId: 'ServicePricing',
    icon: 'Tag'
  },
  { label: 'Coupons', description: 'Discount codes & promotions', resourceId: 'Coupon', icon: 'CreditCard' },
  {
    label: 'Provider Balance',
    description: 'Alrahuz, BilalSadaSub & Techhub provider wallet status',
    resourceId: 'ProviderBalanceStatus',
    icon: 'AlertTriangle'
  },
  {
    label: 'Referral Settings',
    description: 'Referral reward configuration',
    resourceId: 'ReferralSettings',
    icon: 'Percent'
  },
  {
    label: 'Notifications',
    description: 'Broadcast messages to users',
    resourceId: 'NotificationBroadcast',
    icon: 'Bell'
  },
  { label: 'Admin Users', description: 'Admin accounts & roles', resourceId: 'AdminUser', icon: 'Shield' },
  { label: 'Audit Log', description: 'Admin activity history', resourceId: 'AdminAuditLog', icon: 'FileText' }
];

const Dashboard: React.FC = () => (
  <Box>
    <Box
      position="relative"
      overflow="hidden"
      py="xxl"
      px={['default', 'lg', 'xxl']}
      style={{ background: 'linear-gradient(135deg, #0b2f73 0%, #1452a0 100%)' }}
    >
      <Box display="flex" alignItems="center" flexDirection={['column', 'row']}>
        <Box mr={['0', 'xl']} mb={['lg', '0']}>
          <img
            src="/branding/logo.jpg"
            alt="MARIA Digital Solutions"
            style={{ width: 96, height: 96, borderRadius: 20, display: 'block' }}
          />
        </Box>
        <Box>
          <H2 color="#ffffff" fontWeight="bold" style={{ color: '#ffffff' }}>
            Welcome to MARIA Digital Solutions Admin
          </H2>
          <Text color="#fff" style={{ opacity: 0.9, color: '#fff' }}>
            Manage customers, transactions, data plans and more from one place.
          </Text>
        </Box>
      </Box>
    </Box>

    <Box px={['default', 'lg', 'xxl']} py="xl">
      <H4 mb="lg">Quick links</H4>
      <Box display="flex" flexWrap="wrap" style={{ gap: 20 }}>
        {quickLinks.map((link) => (
          <a
            key={link.resourceId ?? link.href}
            href={link.href ?? `${ADMIN_ROOT_PATH}/resources/${link.resourceId}`}
            style={{ textDecoration: 'none', display: 'block', width: 280, flexGrow: 1, maxWidth: 340 }}
          >
            <Box variant="white" boxShadow="card" p="lg" style={{ cursor: 'pointer', height: '100%', background: '#0b2f73', borderRadius: 12 }}>
              <Box display="flex" alignItems="center" mb="default">
                <Icon
                  icon={link.icon}
                  color="#ffffff"
                  bg="rgba(96, 165, 250, 0.25)"
                  rounded
                  size={22}
                  p="default"
                  mr="default"
                />
                <Text fontWeight="bold" color="#ffffff">
                  {link.label}
                </Text>
              </Box>
              <Text fontSize="sm" color="#dbeafe">
                {link.description}
              </Text>
            </Box>
          </a>
        ))}
      </Box>
    </Box>
  </Box>
);

export default Dashboard;

