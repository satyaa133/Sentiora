import { Suspense, lazy } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";

import EchoMount from "./components/echo/EchoMount";
import ProtectedRoute from "./components/ProtectedRoute";
import OnboardingRoute from "./components/OnboardingRoute";
import { AuthProvider } from "./context/AuthContext";
import LandingPage from "./pages/LandingPage";
import { DASHBOARD_PATHS } from "./routes";

// The landing page ships in the first bundle (it holds the LCP); every other
// page loads on demand so landing visitors don't download the app (DESIGN.md §11).
const DashboardHome = lazy(() => import("./pages/DashboardHome"));
const ForgotPassword = lazy(() => import("./pages/ForgotPassword"));
const Login = lazy(() => import("./pages/Login"));
const NotFound = lazy(() => import("./pages/NotFound"));
const Onboarding = lazy(() => import("./pages/Onboarding"));
const SignUp = lazy(() => import("./pages/SignUp"));

// UI kit gallery, development builds only (tree-shaken from production).
const ComponentsGallery = import.meta.env.DEV
  ? lazy(() => import("./pages/dev/ComponentsGallery"))
  : null;

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Suspense fallback={<div className="min-h-screen bg-bg" />}>
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
                {/* element={null}: the shell renders the view, not an <Outlet />. */}
                {DASHBOARD_PATHS.map((path) => (
                  <Route key={path} path={path} element={null} />
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
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </Suspense>
        <EchoMount />
      </AuthProvider>
    </BrowserRouter>
  );
}
