import { useState } from "react";
import { Button, Card, Label, TextField, ThemeToggle, Toggle } from "@shared/ui";
import { useAuth } from "../../context/AuthContext";

const SELECT_CLASSES =
  "h-11 w-full rounded-btn border border-line bg-surface px-3 text-[16px] text-fg focus:border-accent focus:outline-none";

export default function AccountSettingsView() {
  const { user } = useAuth();
  const [displayName, setDisplayName] = useState(
    user?.profile?.display_name || user?.email?.split("@")[0] || "User",
  );
  const [timezone, setTimezone] = useState("Asia/Kolkata");
  const [aiSummaryFormat, setAiSummaryFormat] = useState("detailed");
  const [autoSync, setAutoSync] = useState(true);
  const [saved, setSaved] = useState(false);

  function handleSave() {
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }

  const initialLetter = (displayName[0] || user?.email?.[0] || "U").toUpperCase();

  return (
    <div className="space-y-6">
      <Card as="section" aria-labelledby="settings-profile-heading" padding="lg">
        <div className="flex items-center gap-4 border-b border-line-soft pb-6">
          <span
            aria-hidden="true"
            className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-raised font-display text-2xl font-bold text-fg"
          >
            {initialLetter}
          </span>
          <div className="min-w-0">
            <h2
              id="settings-profile-heading"
              className="truncate text-[22px] font-semibold text-fg"
            >
              {displayName}
            </h2>
            <p className="truncate text-[15px] text-muted">{user?.email}</p>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField
            label="Email"
            type="email"
            value={user?.email ?? ""}
            disabled
            readOnly
          />
          <TextField
            label="Display name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="settings-timezone">Time zone</Label>
            <select
              id="settings-timezone"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className={SELECT_CLASSES}
            >
              <option value="Asia/Kolkata">India Standard Time (IST, UTC+5:30)</option>
              <option value="America/New_York">Eastern Time (ET, UTC-5)</option>
              <option value="America/Chicago">Central Time (CT, UTC-6)</option>
              <option value="America/Los_Angeles">Pacific Time (PT, UTC-8)</option>
              <option value="Europe/London">London (GMT, UTC+0)</option>
            </select>
          </div>
        </div>
      </Card>

      <Card as="section" aria-labelledby="settings-appearance-heading" padding="lg">
        <h2
          id="settings-appearance-heading"
          className="text-[20px] font-semibold text-fg"
        >
          Appearance
        </h2>
        <p className="mt-1 text-[15px] text-muted">
          System follows your device. Saved in this browser.
        </p>
        <ThemeToggle className="mt-4" />
      </Card>

      <Card as="section" aria-labelledby="settings-prefs-heading" padding="lg">
        <h2 id="settings-prefs-heading" className="text-[20px] font-semibold text-fg">
          Memory and answers
        </h2>
        <div className="mt-4 divide-y divide-line-soft">
          <Toggle
            label="Sync extension saves"
            description="Show pages saved by the browser extension in your memory."
            checked={autoSync}
            onChange={setAutoSync}
            className="py-3"
          />
          <div className="flex flex-col gap-2 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <Label htmlFor="settings-format">Answer style</Label>
              <p className="text-[15px] text-muted">
                Default depth for Ask Sentiora answers.
              </p>
            </div>
            <select
              id="settings-format"
              value={aiSummaryFormat}
              onChange={(e) => setAiSummaryFormat(e.target.value)}
              className={`${SELECT_CLASSES} sm:w-64`}
            >
              <option value="detailed">Structured and detailed</option>
              <option value="concise">Concise, with bullet points</option>
            </select>
          </div>
        </div>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={handleSave}>Save changes</Button>
        {/* TODO: these preferences are not sent to the API yet. */}
        <p role="status" className="text-[15px] text-muted">
          {saved ? "These preferences aren't saved to your account yet." : ""}
        </p>
      </div>
    </div>
  );
}
