import { ComponentLoader } from 'adminjs';

export const componentLoader = new ComponentLoader();

export const Components = {
  // Keep the source extension here: the dev server runs TypeScript through
  // tsx, while AdminJS resolves the path relative to this loader file.
  Dashboard: componentLoader.add('Dashboard', './components/dashboard.tsx')
};
