import type { ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { AppShell } from '@/components/layout/AppShell';
import { LoginPage } from '@/pages/Login/LoginPage';
import { RegisterPage } from '@/pages/Register/RegisterPage';
import { DashboardPage } from '@/pages/Dashboard/DashboardPage';
import { AttendancePage } from '@/pages/Attendance/AttendancePage';
import { HistoryPage } from '@/pages/History/HistoryPage';
import { ProfilePage } from '@/pages/Profile/ProfilePage';
import { FaceEnrollmentPage } from '@/pages/FaceEnrollment/FaceEnrollmentPage';
import { AdminHomePage } from '@/pages/Admin/AdminHomePage';
import { EmployeesPage } from '@/pages/Admin/EmployeesPage';
import { AdminAttendancePage } from '@/pages/Admin/AdminAttendancePage';
import { ReviewsPage } from '@/pages/Admin/ReviewsPage';
import { SettingsPage } from '@/pages/Admin/SettingsPage';

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Guest><LoginPage /></Guest>} />
      <Route path="/register" element={<Guest><RegisterPage /></Guest>} />
      <Route element={<Private><AppShell /></Private>}>
        <Route index element={<DashboardPage />} />
        <Route path="/attendance" element={<AttendancePage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/enroll" element={<FaceEnrollmentPage />} />
        <Route path="/admin" element={<Admin><AdminHomePage /></Admin>} />
        <Route path="/admin/employees" element={<Admin><EmployeesPage /></Admin>} />
        <Route path="/admin/attendance" element={<Admin><AdminAttendancePage /></Admin>} />
        <Route path="/admin/reviews" element={<Admin><ReviewsPage /></Admin>} />
        <Route path="/admin/settings" element={<Admin><SettingsPage /></Admin>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function Guest({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <ScreenLoading />;
  if (user) return <Navigate to="/" replace />;
  return children;
}

function Private({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <ScreenLoading />;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function Admin({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (user?.role !== 'admin') return <Navigate to="/" replace />;
  return children;
}

function ScreenLoading() {
  return <div className="grid min-h-screen place-items-center text-sm text-ink-700">Loading your session…</div>;
}
