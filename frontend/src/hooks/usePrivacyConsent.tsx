import { useCallback, useRef, useState, type ReactNode } from "react";
import { Button, Modal, PRIVACY_NOTICE_TEXT } from "@shared/ui";
import {
  acceptPrivacyNotice,
  fetchPrivacyConsent,
  type PrivacyConsent,
} from "../services/privacyService";

// Shared by every view in this tab: once accepted, nobody asks again.
let known: boolean | null = null;

/** Forget what we know (sign-out, or the API said consent is missing). */
export function resetPrivacyConsentCache(value: boolean | null = null) {
  known = value;
}

/**
 * Gate for AI features (REBUILD_PLAN D10). `requireConsent(action)` runs the
 * action at once when the user accepted the current notice; otherwise it shows
 * the notice and runs the action after "I agree". Render `consentModal`.
 */
export function usePrivacyConsent() {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<(() => void) | null>(null);

  const ask = useCallback((action: () => void) => {
    pending.current = action;
    setError(null);
    setOpen(true);
  }, []);

  const requireConsent = useCallback(
    async (action: () => void) => {
      if (known === true) {
        action();
        return;
      }
      if (known === null) {
        try {
          const consent: PrivacyConsent = await fetchPrivacyConsent();
          known = consent.privacy_consent_current;
        } catch {
          known = null; // Unknown: let the API decide (it answers 403 if needed).
          action();
          return;
        }
      }
      if (known) action();
      else ask(action);
    },
    [ask],
  );

  /** The API refused with PRIVACY_CONSENT_REQUIRED: ask, then retry. */
  const consentMissing = useCallback(
    (retry: () => void) => {
      known = false;
      ask(retry);
    },
    [ask],
  );

  async function accept() {
    setSaving(true);
    setError(null);
    try {
      const consent = await acceptPrivacyNotice();
      known = consent.privacy_consent_current;
      setOpen(false);
      const action = pending.current;
      pending.current = null;
      action?.();
    } catch {
      setError("Could not save your answer. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    pending.current = null;
    setOpen(false);
  }

  const consentModal: ReactNode = (
    <Modal
      open={open}
      onClose={cancel}
      title="Before Echo uses AI"
      description="AI answers and summaries are optional. Quoted answers and search keep working either way."
      footer={
        <>
          <Button variant="secondary" onClick={cancel} disabled={saving}>
            Not now
          </Button>
          <Button onClick={() => void accept()} loading={saving}>
            I agree
          </Button>
        </>
      }
    >
      <p className="text-[16px] leading-relaxed text-fg">{PRIVACY_NOTICE_TEXT}</p>
      {error ? (
        <p role="alert" className="mt-3 text-[15px] text-link">
          {error}
        </p>
      ) : null}
    </Modal>
  );

  return { requireConsent, consentMissing, consentModal };
}
