import { type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

interface OnboardingRouteProps {
  children: ReactNode;
}

export default function OnboardingRoute({ children }: OnboardingRouteProps) {
  const { isAuthenticated, isLoading, user } = useAuth();

  if (isLoading) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#FFFDF7",
        }}
      >
        <div className="sentiora-spinner" aria-label="Loading…" />
      </div>
    );
  }

  if (isAuthenticated && user?.onboarding_completed) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}
