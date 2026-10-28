import { type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import FullPageLoader from "./FullPageLoader";

interface OnboardingRouteProps {
  children: ReactNode;
}

export default function OnboardingRoute({ children }: OnboardingRouteProps) {
  const { isAuthenticated, isLoading, user } = useAuth();

  if (isLoading) {
    return <FullPageLoader />;
  }

  if (isAuthenticated && user?.onboarding_completed) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}
