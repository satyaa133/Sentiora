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
      // The extension's content script on this page reads the list from storage.
      window.postMessage({ type: "SENTIORA_BLOCKLIST_SYNC" }, window.location.origin);
    } catch (e) {
      console.error("Failed to save blocked domains:", e);
    }
  }, [blockedDomains]);

  function handleAddDomain() {
    if (!newDomain.trim()) return;
    const cleanDomain = newDomain
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "");
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

      const dataStr =
        "data:text/json;charset=utf-8," +
        encodeURIComponent(JSON.stringify(exportPayload, null, 2));
      const downloadAnchor = document.createElement("a");
      downloadAnchor.setAttribute("href", dataStr);
      const dateString = new Date().toISOString().slice(0, 10);
      downloadAnchor.setAttribute(
        "download",
        `sentiora-vault-export-${dateString}.json`,
      );
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();

      setTimeout(() => setExportSuccess(false), 4000);
    }, 600);
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
            onChange={(e) => setNewDomain(e.target.value)}
            placeholder="example.com"
            className="font-mono"
          />
          <Button type="submit" variant="inverse" className="shrink-0">
            Add site
          </Button>
        </form>

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
              Download everything you&apos;ve saved ({items.length}{" "}
              {items.length === 1 ? "memory" : "memories"}) as a JSON file.
            </p>
            <p role="status" className="mt-1 min-h-[22px] text-[15px] text-fg">
              {exportSuccess ? "Your export has downloaded." : ""}
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
