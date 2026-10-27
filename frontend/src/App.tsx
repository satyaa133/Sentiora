import { Suspense, lazy } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import ProtectedRoute from "./components/ProtectedRoute";
import OnboardingRoute from "./components/OnboardingRoute";
import { AuthProvider } from "./context/AuthContext";
import DashboardHome from "./pages/DashboardHome";
import ForgotPassword from "./pages/ForgotPassword";
import LandingPage from "./pages/LandingPage";
import Login from "./pages/Login";
import Onboarding from "./pages/Onboarding";
import SignUp from "./pages/SignUp";

// UI kit gallery, development builds only (tree-shaken from production).
const ComponentsGallery = import.meta.env.DEV
  ? lazy(() => import("./pages/dev/ComponentsGallery"))
  : null;

const DASHBOARD_PATHS = [
  "dashboard",
  "intelligence",
  "timeline",
  "search",
  "ask",
  "sources",
  "privacy",
  "settings",
];

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/">
            <Route index element={<LandingPage />} />
            <Route path="login" element={<Login />} />
            <Route path="signup" element={<SignUp />} />
            <Route path="forgot-password" element={<ForgotPassword />} />
            <Route
              path="onboarding"
              element={
                <OnboardingRoute>
                  <Onboarding />
                </OnboardingRoute>
              }
            />
            {/* Every app tab renders the same shell; DashboardHome picks the view from the path. */}
            <Route
              element={
                <ProtectedRoute>
                  <DashboardHome />
                </ProtectedRoute>
              }
            >
              {DASHBOARD_PATHS.map((path) => (
                <Route key={path} path={path} />
              ))}
            </Route>
            {ComponentsGallery ? (
              <Route
                path="dev/components"
                element={
                  <Suspense fallback={null}>
                    <ComponentsGallery />
                  </Suspense>
                }
              />
            ) : null}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
