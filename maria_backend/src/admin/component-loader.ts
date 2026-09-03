import { ComponentLoader } from 'adminjs';

export const componentLoader = new ComponentLoader();

export const Components = {
  // AdminJS resolves relative to the compiled loader in production. The
  // TypeScript source is used only by the tsx development runner.
  Dashboard: componentLoader.add(
    'Dashboard',
    process.env.NODE_ENV === 'production' ? './components/dashboard.js' : './components/dashboard.tsx'
  ),
  RedirectToManage: componentLoader.add(
    'RedirectToManage',
    process.env.NODE_ENV === 'production' ? './components/redirect-to-manage.js' : './components/redirect-to-manage.tsx'
  )
};
