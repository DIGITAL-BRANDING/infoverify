# Railway Deployment

If Railway fails with:

```text
P1001: Can't reach database server at db.<project>.supabase.co:5432
```

then `DATABASE_URL` is pointing to Supabase's direct database host. Use the
Supabase pooler host instead.

Set these Railway variables:

```text
NODE_ENV=production
DATABASE_URL=postgresql://postgres.<PROJECT_REF>:<PASSWORD>@aws-0-<REGION>.pooler.supabase.com:5432/postgres?sslmode=require
AUTH_TOKEN_SECRET=<random string with at least 32 characters>
ADMIN_SESSION_SECRET=<random string with at least 16 characters>
```

Do not set `DATABASE_URL` to:

```text
postgresql://postgres:<PASSWORD>@db.<PROJECT_REF>.supabase.co:5432/postgres
```

This project includes `railway.json`. Railway should build with:

```text
npm ci && npm run prisma:generate && npm run build
```

and start with:

```text
npm run start:prod
```

`start:prod` runs `prisma migrate deploy` and then starts `node dist/server.js`.
