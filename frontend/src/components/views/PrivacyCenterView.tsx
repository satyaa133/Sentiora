import { useState, useEffect } from "react";
import type { MemoryItem } from "../../types/memory";

interface PrivacyCenterViewProps {
  items?: MemoryItem[];
}

export default function PrivacyCenterView({ items = [] }: PrivacyCenterViewProps) {
  const [blockedDomains, setBlockedDomains] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem("sentiora_blocked_domains");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [newDomain, setNewDomain] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportSuccess, setExportSuccess] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem("sentiora_blocked_domains", JSON.stringify(blockedDomains));
    } catch (e) {
      console.error("Failed to save blocked domains:", e);
    }
  }, [blockedDomains]);

  function handleAddDomain() {
    if (!newDomain.trim()) return;
    const cleanDomain = newDomain.trim().toLowerCase().replace(/^https?:\/\//, "");
    if (!blockedDomains.includes(cleanDomain)) {
      setBlockedDomains((prev) => [...prev, cleanDomain]);
    }
    setNewDomain("");
  }

  function handleRemoveDomain(domain: string) {
    setBlockedDomains((prev) => prev.filter((d) => d !== domain));
  }

  function handleExportVault() {
    setExporting(true);
    setExportSuccess(false);

    setTimeout(() => {
      setExporting(false);
      setExportSuccess(true);

      const exportPayload = {
        app: "Sentiora Memory Vault",
        export_date: new Date().toISOString(),
        total_items: items.length,
        items: items,
      };

      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportPayload, null, 2));
      const downloadAnchor = document.createElement("a");
      downloadAnchor.setAttribute("href", dataStr);
      const dateString = new Date().toISOString().slice(0, 10);
      downloadAnchor.setAttribute("download", `sentiora-vault-export-${dateString}.json`);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();

      setTimeout(() => setExportSuccess(false), 4000);
    }, 600);
  }

  return (
    <div className="space-y-6 max-w-4xl font-sans">
      {/* Blocklist Manager */}
      <div className="bg-white/85 backdrop-blur-md border border-parchment-200/80 rounded-2xl p-6 shadow-card space-y-4">
        <div>
          <h2 className="font-serif text-xl font-bold text-ink-900">Custom Sensitive Domain Blocklist</h2>
          <p className="text-xs text-ink-500 mt-1">
            Add custom domains you want Sentiora to ignore. Only domains you add below will be blocked from automatic capture.
          </p>
        </div>

        <div className="flex gap-2">
          <input
            type="text"
            value={newDomain}
            onChange={(e) => setNewDomain(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAddDomain();
            }}
            placeholder="e.g. internal.company.com or mysite.com"
            className="flex-1 bg-parchment-50/80 backdrop-blur-xs border border-parchment-200/80 rounded-xl px-3 py-2 text-xs text-ink-900 focus:outline-none focus:border-moss-600 focus:bg-white font-medium transition-colors"
          />
          <button
            onClick={handleAddDomain}
            className="px-4 py-2 bg-moss-600 hover:bg-moss-700 text-white text-xs font-semibold rounded-xl transition-colors shadow-sm"
          >
            Add Domain
          </button>
        </div>

        <div className="space-y-2 pt-2">
          {blockedDomains.length === 0 ? (
            <div className="p-6 bg-parchment-50/60 rounded-xl border border-dashed border-parchment-200 text-center space-y-1">
              <p className="text-xs font-bold text-ink-700">No custom blocked domains added yet</p>
              <p className="text-[11px] text-ink-500">Domains you add above will appear here and will be skipped by the extension.</p>
            </div>
          ) : (
            blockedDomains.map((domain) => (
              <div
                key={domain}
                className="p-3 bg-parchment-50/80 backdrop-blur-xs border border-parchment-200/80 rounded-xl flex items-center justify-between text-xs transition-colors hover:bg-white"
              >
                <div className="flex items-center gap-2">
                  <span className="text-moss-600">🛡️</span>
                  <span className="font-mono text-ink-900 font-semibold">{domain}</span>
                </div>
                <button
                  onClick={() => handleRemoveDomain(domain)}
                  className="text-rose-600 hover:underline font-semibold text-[11px]"
                >
                  Remove
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Data Ownership & Export */}
      <div className="bg-white/85 backdrop-blur-md border border-parchment-200/80 rounded-2xl p-6 shadow-card space-y-4">
        <h2 className="font-serif text-xl font-bold text-ink-900">Data Ownership & Control</h2>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 bg-parchment-50/80 backdrop-blur-xs border border-parchment-200/80 rounded-xl">
          <div>
            <p className="text-xs font-bold text-ink-900">Export Complete Vault (JSON File)</p>
            <p className="text-[11px] text-ink-500">
              Download a complete JSON export of all your captured memory items ({items.length} items in vault).
            </p>
            {exportSuccess && (
              <p className="text-xs font-bold text-moss-600 mt-1 animate-fade-in">
                ✓ JSON Vault Export downloaded successfully!
              </p>
            )}
          </div>
          <button
            onClick={handleExportVault}
            disabled={exporting}
            className="px-4 py-2 bg-moss-600 hover:bg-moss-700 text-white text-xs font-semibold rounded-xl transition-colors shadow-sm shrink-0"
          >
            {exporting ? "Generating JSON..." : "Export Vault Data (.json)"}
          </button>
        </div>
      </div>
    </div>
  );
}
