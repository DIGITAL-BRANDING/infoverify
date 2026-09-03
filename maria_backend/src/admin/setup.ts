import AdminJS from 'adminjs';
import AdminJSExpress from '@adminjs/express';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import pg from 'pg';
import { Database, Resource } from '@adminjs/prisma';
import { env } from '../config/env.js';
import { authenticateAdmin } from './auth.js';
import { registerBulkPricingRoutes } from './bulk-pricing.js';
import { registerCompanyWalletRoutes } from './company-wallet.js';
import { registerProviderLedgerRoutes } from './provider-ledger.js';
import { registerProviderReconciliationRoutes } from './provider-reconciliation.js';
import { registerUserWalletRoutes } from './user-wallet.js';
import { registerCustomerActivityRoutes } from './customer-activity.js';
import { registerNinModificationRoutes } from './nin-modification.js';
import { registerBvnModificationRoutes } from './bvn-modification.js';
import { registerBvnLicenseRoutes } from './bvn-license-onboarding.js';
import { registerCacRoutes } from './cac.js';
import { componentLoader, Components } from './component-loader.js';
import { userResource } from './resources/user.resource.js';
import { transactionResource } from './resources/transaction.resource.js';
import { adminUserResource } from './resources/admin-user.resource.js';
import { adminAuditLogResource } from './resources/audit-log.resource.js';
import { dataPlanPricingResource } from './resources/data-plan-pricing.resource.js';
import { servicePricingResource } from './resources/service-pricing.resource.js';
import { couponResource } from './resources/coupon.resource.js';
import { providerBalanceResource } from './resources/provider-balance.resource.js';
import { referralSettingsResource } from './resources/referral-settings.resource.js';
import { appConfigResource } from './resources/app-config.resource.js';
import { supportTicketResource, supportTicketMessageResource } from './resources/support-ticket.resource.js';
import { notificationBroadcastResource } from './resources/notification-broadcast.resource.js';
import { userDeliveryResource } from './resources/user-delivery.resource.js';
import { registerUserDeliveryRoutes } from './user-deliveries.js';
import { registerSupportInboxRoutes } from './support-inbox.js';

AdminJS.registerAdapter({ Database, Resource });

export const ADMIN_ROOT_PATH = '/admin';

// A separate, small pg Pool just for session storage - deliberately not routed
// through Prisma, since connect-pg-simple needs a raw pg client to manage its
// own `session` table (auto-created below via createTableIfMissing). This
// pool is cheap: session reads/writes are infrequent compared to API traffic.
//
// IMPORTANT: we rewrite `sslmode` to `no-verify` directly in the connection
// string rather than passing a separate `ssl: { rejectUnauthorized: false }`
// config object. Passing both `connectionString` and `ssl` together looks
// like it should work, but node-postgres's ConnectionParameters does:
//   config = Object.assign({}, config, parse(config.connectionString))
// - which re-parses the connection string and merges the result IN LAST,
// silently clobbering any explicit `ssl` property with whatever `sslmode`
// in the URL parses to. Our DATABASE_URL carries `sslmode=require`, which
// pg-connection-string treats as full certificate-chain verification and
// rejects Supabase's pooler cert with "self-signed certificate in
// certificate chain". Putting `sslmode=no-verify` in the string itself
// means pg-connection-string sets `rejectUnauthorized: false` inside the
// very object that wins the merge, so it actually takes effect. Prisma's
// connection to this same DATABASE_URL is unaffected since it uses its own
// TLS stack. The connection itself is still encrypted; this only skips
// validating the CA chain, which is the standard accepted workaround for
// this node-postgres/Supabase combination.
function withNoVerifySsl(connectionString: string): string {
  const url = new URL(connectionString);
  url.searchParams.set('sslmode', 'no-verify');
  return url.toString();
}

const sessionPool = new pg.Pool({
  connectionString: withNoVerifySsl(env.DATABASE_URL)
});
const PgSession = connectPgSimple(session);
const adminSessionStore = new PgSession({
  pool: sessionPool,
  tableName: 'admin_session',
  createTableIfMissing: true,
  // Prunes expired rows periodically instead of on every request.
  pruneSessionInterval: 60 * 15
});

export async function buildAdminRouter() {
  const admin = new AdminJS({
    rootPath: ADMIN_ROOT_PATH,
    componentLoader,
    dashboard: {
      component: Components.Dashboard
    },
    branding: {
      companyName: 'MARIA Digital Solutions',
      logo: '/branding/logo.jpg',
      favicon: '/branding/logo.jpg',
      withMadeWithLove: false,
      theme: {
        colors: {
          // Matches the app's brand palette (lib/core/constants/app_colors.dart):
          // Gold primary + Vivid Orange accent.
          primary100: '#0b2f73',
          primary80: '#1452a0',
          primary60: '#2563eb',
          primary40: '#60a5fa',
          primary20: '#dbeafe',
          accent: '#06b6d4',
          love: '#06b6d4'
        }
      }
    },
    assets: {
      // See public/admin-assets/mobile-fix.css for what this actually does
      // and why - fixes AdminJS's built-in list tables rendering blank
      // (checkbox + "..." menu visible, every data column empty) on
      // narrow/mobile viewports.
      styles: ['/admin-assets/mobile-fix.css']
    },
    resources: [
      userResource,
      transactionResource,
      dataPlanPricingResource,
      servicePricingResource,
      couponResource,
      providerBalanceResource,
      referralSettingsResource,
      appConfigResource,
      supportTicketResource,
      supportTicketMessageResource,
      notificationBroadcastResource,
      userDeliveryResource,
      adminUserResource,
      adminAuditLogResource
    ]
  });

  if (env.NODE_ENV !== 'production') {
    // Live-rebuilds the frontend bundle on file changes during local development.
    void admin.watch();
  } else {
    // AdminJSExpress.buildAuthenticatedRouter() below also calls admin.initialize()
    // internally, but WITHOUT awaiting it (fire-and-forget) - so the router it
    // returns can start serving requests before the bundle has finished writing
    // to disk. On a fresh deploy that raced against a stale/partial .adminjs/bundle.js
    // (or a corrupt in-progress write), which is what produced "Unexpected token"
    // in the browser: the first request(s) got served whatever was on disk at
    // that instant, not the freshly-built bundle. Awaiting it here ourselves,
    // before this function's promise resolves, guarantees a complete, valid
    // bundle exists before app.ts starts routing any request to this router.
    console.log('[admin] Building AdminJS frontend bundle...');
    await admin.initialize();
    console.log('[admin] AdminJS frontend bundle ready');
  }

  const router = AdminJSExpress.buildAuthenticatedRouter(
    admin,
    {
      authenticate: async (email: string, password: string) => authenticateAdmin(email, password),
      cookiePassword: env.ADMIN_SESSION_SECRET,
      cookieName: 'imam_admin_sid'
    },
    null,
    {
      resave: false,
      saveUninitialized: false,
      secret: env.ADMIN_SESSION_SECRET,
      // Was express-session's default in-memory store, which loses every active
      // session on a restart/redeploy and can't be shared across more than one
      // instance — either of which reproduces exactly "login succeeds, next
      // request bounces back to /admin/login". Persisting sessions in the same
      // Postgres database Prisma already talks to fixes that: a redeploy (or a
      // second instance, if this ever scales beyond one) shares the same
      // session table instead of each holding its own private, empty one.
      store: adminSessionStore,
      cookie: {
        // Explicit rather than left to express-session's default, since without
        // `app.set('trust proxy', ...)` upstream (see app.ts), auto-detecting
        // "is this request secure" behind Railway's proxy is unreliable — this
        // makes the intent unambiguous instead of depending on that detection.
        secure: env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 8 * 60 * 60 * 1000 // 8 hours
      }
    }
  );

  registerBulkPricingRoutes(router);
  registerCompanyWalletRoutes(router);
  registerProviderLedgerRoutes(router);
  registerProviderReconciliationRoutes(router);
  registerUserWalletRoutes(router);
  registerCustomerActivityRoutes(router);
  registerNinModificationRoutes(router);
  registerBvnModificationRoutes(router);
  registerBvnLicenseRoutes(router);
  registerCacRoutes(router);
  registerUserDeliveryRoutes(router);
  registerSupportInboxRoutes(router);

  return { admin, router };
}

