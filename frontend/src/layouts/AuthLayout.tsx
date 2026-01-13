import { Outlet } from 'react-router';

// Minimal layout for authentication pages
// No navigation, no header, just the content
export const AuthLayout = () => {
  return <Outlet />;
};