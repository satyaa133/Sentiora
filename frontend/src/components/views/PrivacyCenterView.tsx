import { useState, useEffect } from "react";
import {
  Button,
  Card,
  Echo,
  IconButton,
  IconClose,
  IconDownload,
  IconShield,
  Input,
  Tag,
} from "@shared/ui";
import type { MemoryItem } from "../../types/memory";
import { fetchMemoryItems } from "../../services/memoryService";
import { normalizeBlockedDomain } from "../../utils/blockedDomain";

export default function PrivacyCenterView() {
  const [blockedDomains, setBlockedDomains] = useState<string[]>(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem("sentiora_blocked_domains") ?? "[]");
      if (!Array.isArray(saved)) return [];
      // Lists saved before normalization may hold paths or non-domains.
      const domains = saved
        .map((entry) => (typeof entry === "string" ? normalizeBlockedDomain(entry) : null))
        .filter((domain): domain is string => domain !== null);
      return [...new Set(domains)];
    } catch {
      return [];
    }
  });

  const [newDomain, setNewDomain] = useState("");
  const [domainError, setDomainError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportSuccess, setExportSuccess] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem("sentiora_blocked_domains", JSON.stringify(blockedDomains));
      // The extension's content script on this page reads the list from storage.
      window.postMessage({ type: "SENTIORA_BLOCKLIST_SYNC" }, window.location.origin);
    } catch (e) {
      console.error("Failed to save blocked domains:", e);
    }
  }, [blockedDomains]);

  function handleAddDomain() {
    if (!newDomain.trim()) return;
    // Store exactly what the extension enforces, so the list never shows a
    // rule (a path, or a word that is not a site) that blocks nothing.
    const cleanDomain = normalizeBlockedDomain(newDomain);
    if (!cleanDomain) {
      setDomainError("Enter a site like example.com.");
      return;
    }
    setDomainError(null);
    if (!blockedDomains.includes(cleanDomain)) {
      setBlockedDomains((prev) => [...prev, cleanDomain]);
    }
    setNewDomain("");
  }

  function handleRemoveDomain(domain: string) {
    setBlockedDomains((prev) => prev.filter((d) => d !== domain));
  }

  async function handleExportVault() {
    setExporting(true);
    setExportSuccess(false);
    setExportError(null);

    // The loaded feed holds only the newest 100 memories; page through the API
    // so the export really is everything.
    const allItems: MemoryItem[] = [];
    try {
      for (let page = 1; ; page++) {
        const batch = await fetchMemoryItems(page, 100);
        allItems.push(...batch.items);
        if (!batch.has_more || batch.items.length === 0) break;
      }
    } catch {
      setExportError("Could not download your memory. Please try again.");
      return;
    } finally {
      setExporting(false);
    }

    const exportPayload = {
      app: "Sentiora Memory Vault",
      export_date: new Date().toISOString(),
      total_items: allItems.length,
      items: allItems,
    };
    // A Blob URL, not a data: URL, so a large vault still downloads whole.
    const blob = new Blob([JSON.stringify(exportPayload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const downloadAnchor = document.createElement("a");
    downloadAnchor.href = url;
    const dateString = new Date().toISOString().slice(0, 10);
    downloadAnchor.download = `sentiora-vault-export-${dateString}.json`;
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    URL.revokeObjectURL(url);

    setExportSuccess(true);
    setTimeout(() => setExportSuccess(false), 4000);
  }

  return (
    <div className="space-y-6">
      <Card
        as="section"
        aria-labelledby="privacy-builtin-heading"
        tone="raised"
        padding="lg"
        className="flex flex-col gap-5 sm:flex-row sm:items-center"
      >
        <Echo state="guarding" size={80} className="shrink-0" />
        <div>
          <h2
            id="privacy-builtin-heading"
            className="text-[20px] font-semibold text-fg"
          >
            Sensitive pages are always skipped
          </h2>
          <p className="mt-1 text-[16px] leading-relaxed text-muted">
            The extension skips banking, payment, health, insurance, tax and ID sites it
            recognises, sign-in pages, pages with a visible password field, and pages
            marked noindex. The check runs in your browser before anything is sent.
          </p>
        </div>
      </Card>

      <Card as="section" aria-labelledby="privacy-blocklist-heading" padding="lg">
        <h2
          id="privacy-blocklist-heading"
          className="text-[20px] font-semibold text-fg"
        >
          Your blocked sites
        </h2>
        <p className="mt-1 text-[15px] text-muted">
          The extension in this browser skips these sites and their subdomains. Changes
          apply as soon as you add or remove a site.
        </p>

        <form
          className="mt-5 flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            handleAddDomain();
          }}
        >
          <label htmlFor="block-domain" className="sr-only">
            Site to block
          </label>
          <Input
            id="block-domain"
            value={newDomain}
            onChange={(e) => {
              setNewDomain(e.target.value);
              setDomainError(null);
            }}
            placeholder="example.com"
            className="font-mono"
            invalid={Boolean(domainError)}
            aria-describedby={domainError ? "block-domain-error" : undefined}
          />
          <Button type="submit" variant="inverse" className="shrink-0">
            Add site
          </Button>
        </form>
        {domainError ? (
          <p id="block-domain-error" role="alert" className="mt-2 text-[15px] text-link">
            {domainError}
          </p>
        ) : null}

        {blockedDomains.length === 0 ? (
          <p className="mt-5 rounded-btn border border-dashed border-line px-4 py-6 text-center text-[15px] text-muted">
            No sites added yet.
          </p>
        ) : (
          <ul className="mt-5 divide-y divide-line-soft rounded-card border border-line">
            {blockedDomains.map((domain) => (
              <li
                key={domain}
                className="flex items-center justify-between gap-3 px-4 py-2"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <IconShield size={18} className="shrink-0 text-muted" />
                  <span className="truncate font-mono text-[15px] text-fg">
                    {domain}
                  </span>
                  <Tag className="shrink-0">Your rule</Tag>
                </span>
                <IconButton
                  label={`Remove ${domain}`}
                  icon={<IconClose size={18} />}
                  size="sm"
                  onClick={() => handleRemoveDomain(domain)}
                />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card as="section" aria-labelledby="privacy-export-heading" padding="lg">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2
              id="privacy-export-heading"
              className="text-[20px] font-semibold text-fg"
            >
              Export your memory
            </h2>
            <p className="mt-1 text-[15px] text-muted">
              Download everything you&apos;ve saved as a JSON file.
            </p>
            <p role="status" className="mt-1 min-h-[22px] text-[15px] text-fg">
              {exportError ?? (exportSuccess ? "Your export has downloaded." : "")}
            </p>
          </div>
          <Button
            variant="secondary"
            leadingIcon={<IconDownload size={18} />}
            onClick={handleExportVault}
            loading={exporting}
            className="shrink-0"
          >
            Download JSON
          </Button>
        </div>
      </Card>
    </div>
  );
}
