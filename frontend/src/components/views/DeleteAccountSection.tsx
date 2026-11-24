import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Card, IconTrash, TextField } from "@shared/ui";
import { useAuth } from "../../context/AuthContext";
import { getApiErrorCode, getApiErrorMessage } from "../../services/apiClient";

/**
 * Delete account (REBUILD_PLAN D15): removes the account and everything saved
 * in it, after the user confirms with their password.
 */
export function DeleteAccountSection() {
  const { deleteAccount } = useAuth();
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const [password, setPassword] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!password) {
      setError("Enter your password to confirm.");
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      await deleteAccount(password);
      navigate("/", { replace: true });
    } catch (err) {
      setError(
        getApiErrorCode(err) === "AUTH_INVALID_CREDENTIALS"
          ? "That password is not right, so nothing was deleted."
          : getApiErrorMessage(err, "Could not delete your account. Try again."),
      );
    } finally {
      setDeleting(false);
    }
  }

  function cancel() {
    setConfirming(false);
    setPassword("");
    setError(null);
  }

  return (
    <Card as="section" aria-labelledby="settings-delete-heading" padding="lg">
      <h2 id="settings-delete-heading" className="text-[20px] font-semibold text-fg">
        Delete account
      </h2>
      <p className="mt-1 text-[15px] text-muted">
        Removes your account and everything saved in it: memories, summaries, ratings and
        answer history on our servers. This can't be undone. Export your memories first from
        the Privacy Center if you want a copy.
      </p>
      {confirming ? (
        <form onSubmit={handleSubmit} className="mt-4 space-y-3" aria-label="Confirm account deletion">
          <TextField
            label="Your password"
            type="password"
            autoComplete="current-password"
            autoFocus
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            error={error ?? undefined}
          />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" loading={deleting} leadingIcon={<IconTrash size={18} />}>
              Delete my account
            </Button>
            <Button type="button" variant="secondary" onClick={cancel} disabled={deleting}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <Button
          variant="secondary"
          className="mt-4"
          leadingIcon={<IconTrash size={18} />}
          onClick={() => setConfirming(true)}
        >
          Delete account
        </Button>
      )}
    </Card>
  );
}
