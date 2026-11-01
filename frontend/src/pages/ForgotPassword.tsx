import { Link } from "react-router-dom";
import { buttonClasses } from "@shared/ui";
import AuthLayout from "../components/AuthLayout";

// Reset emails are not sent yet: the API's /auth/forgot-password is a
// placeholder. Say so plainly instead of pretending a link is on its way;
// bring back the email form once the backend sends real reset links.
export default function ForgotPassword() {
  return (
    <AuthLayout
      title="Reset your password"
      subtitle="Password reset by email isn't available yet."
      echo="idle"
      footer={
        <>
          Remember your password?{" "}
          <Link to="/login" className="font-semibold text-link hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <div className="space-y-5">
        <p className="rounded-btn bg-raised px-4 py-3 text-[15px] text-fg">
          Sentiora can&apos;t send reset emails yet, so there is no link to wait for.
          If you know your password, sign in as usual.
        </p>
        <Link to="/login" className={buttonClasses("primary", "lg", true)}>
          Back to sign in
        </Link>
      </div>
    </AuthLayout>
  );
}
