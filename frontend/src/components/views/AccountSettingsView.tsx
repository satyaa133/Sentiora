import { useState } from "react";
import { useAuth } from "../../context/AuthContext";

export default function AccountSettingsView() {
  const { user } = useAuth();
  const [displayName, setDisplayName] = useState(user?.profile?.display_name || user?.email?.split("@")[0] || "User");
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
    <div className="space-y-6 max-w-4xl font-sans">
      {/* Profile Header & Avatar Card */}
      <div className="bg-white/85 backdrop-blur-md border border-parchment-200/80 rounded-2xl p-6 shadow-card space-y-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 pb-6 border-b border-parchment-200/60">
          <div className="w-16 h-16 rounded-2xl bg-moss-600 text-white flex items-center justify-center text-2xl font-bold font-serif shadow-md border-2 border-white">
            {initialLetter}
          </div>
          <div className="space-y-1">
            <h2 className="font-serif text-2xl font-bold text-ink-900">{displayName}</h2>
            <p className="text-xs text-ink-500 font-medium">{user?.email || "user@sentiora.ai"}</p>
            <div className="flex items-center gap-2 pt-1">
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-moss-100 text-moss-700 border border-moss-200">
                Personal Pro Vault
              </span>
              <span className="text-[11px] text-ink-400">· Member Active</span>
            </div>
          </div>
        </div>

        {/* Profile Settings Form */}
        <div className="space-y-5">
          <h3 className="font-serif text-lg font-bold text-ink-900">Personal Vault Profile</h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div>
              <label className="block font-semibold text-ink-900 mb-1">Email Address</label>
              <input
                type="text"
                disabled
                value={user?.email || "user@example.com"}
                className="w-full bg-parchment-100/80 backdrop-blur-xs border border-parchment-200/80 rounded-xl px-3.5 py-2.5 text-ink-500 font-mono font-medium cursor-not-allowed"
              />
            </div>

            <div>
              <label className="block font-semibold text-ink-900 mb-1">Display Name</label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Enter display name..."
                className="w-full bg-parchment-50/80 backdrop-blur-xs border border-parchment-200/80 rounded-xl px-3.5 py-2.5 text-ink-900 focus:outline-none focus:border-moss-600 focus:bg-white font-medium transition-colors"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block font-semibold text-ink-900 mb-1">Timezone & Locale</label>
              <select
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="w-full bg-parchment-50/80 backdrop-blur-xs border border-parchment-200/80 rounded-xl px-3.5 py-2.5 text-ink-900 focus:outline-none focus:border-moss-600 focus:bg-white font-medium transition-colors"
              >
                <option value="Asia/Kolkata">India Standard Time (IST - UTC+5:30)</option>
                <option value="America/New_York">Eastern Time (ET - UTC-5)</option>
                <option value="America/Chicago">Central Time (CT - UTC-6)</option>
                <option value="America/Los_Angeles">Pacific Time (PT - UTC-8)</option>
                <option value="Europe/London">London (GMT - UTC+0)</option>
              </select>
            </div>
          </div>
        </div>

        {/* Vault Preferences */}
        <div className="pt-4 border-t border-parchment-200/60 space-y-4 text-xs">
          <h3 className="font-serif text-lg font-bold text-ink-900">Vault & AI Preferences</h3>

          <div className="space-y-3">
            <div className="flex items-center justify-between p-3.5 bg-parchment-50/80 rounded-xl border border-parchment-200/80">
              <div>
                <p className="font-bold text-ink-900">Auto-sync extension captures</p>
                <p className="text-[11px] text-ink-500">Automatically sync content captured by the browser extension into memory feed.</p>
              </div>
              <input
                type="checkbox"
                checked={autoSync}
                onChange={(e) => setAutoSync(e.target.checked)}
                className="w-4 h-4 text-moss-600 rounded border-parchment-300 focus:ring-moss-500 cursor-pointer"
              />
            </div>

            <div className="flex items-center justify-between p-3.5 bg-parchment-50/80 rounded-xl border border-parchment-200/80">
              <div>
                <p className="font-bold text-ink-900">AI Assistant Response Format</p>
                <p className="text-[11px] text-ink-500">Select default depth for Ask Sentiora AI answers.</p>
              </div>
              <select
                value={aiSummaryFormat}
                onChange={(e) => setAiSummaryFormat(e.target.value)}
                className="bg-white border border-parchment-200 rounded-lg px-2.5 py-1.5 text-xs text-ink-900 font-semibold focus:outline-none focus:border-moss-600"
              >
                <option value="detailed">Structured & Detailed</option>
                <option value="concise">Concise & Bullet Points</option>
              </select>
            </div>
          </div>
        </div>

        {/* Save Controls */}
        <div className="pt-4 flex items-center gap-3">
          <button
            onClick={handleSave}
            className="px-6 py-2.5 bg-moss-600 hover:bg-moss-700 text-white rounded-xl text-xs font-semibold transition-colors shadow-sm"
          >
            Save Changes
          </button>
          {saved && (
            <span className="text-xs text-moss-600 font-bold animate-fade-in">
              ✓ Profile settings updated successfully!
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
