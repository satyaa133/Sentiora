/**
 * Development-only gallery of the shared UI kit (DESIGN.md §6), rendered side by side
 * in light and dark. Registered at /dev/components only when import.meta.env.DEV.
 * Sample text below is placeholder content for the gallery, not product data.
 */
import { useState } from "react";
import type { ReactNode } from "react";

import {
  AddTagButton,
  Button,
  Card,
  Chip,
  Drawer,
  Echo,
  Eyebrow,
  IconArrowRight,
  IconButton,
  IconCopy,
  IconPlus,
  IconSearch,
  IconSettings,
  IconTrash,
  Kbd,
  Logo,
  MemoryList,
  MemoryRow,
  MemoryRowSkeleton,
  Modal,
  PortalContainerContext,
  Skeleton,
  SourceBadge,
  Tabs,
  Tag,
  TextAreaField,
  TextField,
  ThemeToggle,
  ToastProvider,
  Toggle,
  useToast,
} from "@shared/ui";
import type { EchoState } from "@shared/ui";

const ECHO_STATES: EchoState[] = ["idle", "saving", "happy", "faded", "guarding"];
const FILTERS = ["All", "Web", "PDF", "Video", "Notes"];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-4 border-t border-line pt-6">
      <h3 className="font-mono text-eyebrow uppercase text-muted">{title}</h3>
      {children}
    </section>
  );
}

function ToastDemo() {
  const toast = useToast();
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        variant="secondary"
        onClick={() =>
          toast.show({ message: "Saved to your memory.", tone: "success" })
        }
      >
        Success toast
      </Button>
      <Button
        variant="secondary"
        onClick={() =>
          toast.show({
            message: "Memory deleted.",
            action: { label: "Undo", onClick: () => undefined },
          })
        }
      >
        Toast with action
      </Button>
      <Button
        variant="secondary"
        onClick={() =>
          toast.show({ message: "Could not reach Sentiora.", tone: "error" })
        }
      >
        Error toast
      </Button>
    </div>
  );
}

function Showcase() {
  const [filter, setFilter] = useState("All");
  const [toggles, setToggles] = useState({ detect: true, confirm: false });
  const [modalOpen, setModalOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [tags, setTags] = useState(["docker", "linux"]);

  return (
    <div className="space-y-8">
      <Section title="Logo & Echo">
        <div className="flex flex-wrap items-center gap-6">
          <Logo />
          <Logo markOnly />
          <span className="rounded-btn bg-inverse px-3 py-2">
            <Logo tone="inverse" size={18} />
          </span>
        </div>
        <ul className="grid grid-cols-3 gap-3 sm:grid-cols-5">
          {ECHO_STATES.map((state) => (
            <li
              key={state}
              className="flex flex-col items-center gap-2 rounded-card bg-raised p-4"
            >
              <Echo state={state} size={56} />
              <span className="text-sm text-muted">{state}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Buttons">
        <div className="flex flex-wrap gap-2">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="inverse" leadingIcon={<IconPlus size={18} />}>
            Inverse
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm">Small</Button>
          <Button size="lg" trailingIcon={<IconArrowRight size={18} />}>
            Large
          </Button>
          <Button loading>Saving</Button>
          <Button disabled variant="secondary">
            Disabled
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <IconButton label="Settings" icon={<IconSettings />} />
          <IconButton label="Copy" icon={<IconCopy />} variant="secondary" />
          <IconButton label="Delete" icon={<IconTrash size={18} />} size="sm" />
        </div>
      </Section>

      <Section title="Inputs">
        <TextField
          label="Email"
          type="email"
          placeholder="you@example.com"
          autoComplete="off"
        />
        <TextField
          label="Password"
          type="password"
          error="Use at least 8 characters."
          defaultValue="short"
        />
        <TextField
          label="Search"
          placeholder="Search or ask anything you've saved..."
          leadingIcon={<IconSearch size={18} />}
          trailing={
            <span className="flex gap-1 pr-2">
              <Kbd>Ctrl</Kbd>
              <Kbd>K</Kbd>
            </span>
          }
        />
        <TextAreaField
          label="Note (optional)"
          hint="Only you can see this."
          placeholder="Why are you saving this?"
          rows={3}
        />
      </Section>

      <Section title="Chips, tags & badges">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((label) => (
            <Chip
              key={label}
              selected={filter === label}
              onClick={() => setFilter(label)}
            >
              {label}
            </Chip>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {tags.map((tag) => (
            <Tag
              key={tag}
              onRemove={() => setTags((current) => current.filter((t) => t !== tag))}
            >
              {tag}
            </Tag>
          ))}
          <Tag>Built-in rule</Tag>
          <AddTagButton
            onClick={() => setTags((current) => [...current, `tag${current.length}`])}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {["webpage", "pdf", "youtube", "note"].map((type) => (
            <SourceBadge key={type} type={type} />
          ))}
          {["webpage", "pdf", "youtube", "note"].map((type) => (
            <SourceBadge key={`${type}-tile`} type={type} variant="tile" />
          ))}
        </div>
      </Section>

      <Section title="Cards">
        <div className="grid gap-3 sm:grid-cols-3">
          <Card>
            <p className="font-semibold">Surface</p>
            <p className="text-[15px] text-muted">Default card.</p>
          </Card>
          <Card tone="raised">
            <p className="font-semibold">Raised</p>
            <p className="text-[15px] text-muted">Highlight section.</p>
          </Card>
          <Card tone="inverse">
            <p className="font-semibold">Inverse</p>
            <p className="text-[15px] text-on-inverse-muted">Graphite panel.</p>
          </Card>
        </div>
        <Card tone="raised" className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <Echo state="idle" size={56} />
          <div className="min-w-0 flex-1">
            <Eyebrow>Resurfaced · saved 6 weeks ago</Eyebrow>
            <p className="mt-1 font-display text-xl font-bold">
              Sample resurfaced title
            </p>
          </div>
          <div className="flex gap-2">
            <Button>Revisit</Button>
            <Button variant="secondary">Not now</Button>
          </div>
        </Card>
      </Section>

      <Section title="Memory rows">
        <MemoryList>
          <MemoryRow
            title="Sample web article title"
            snippet="A short snippet from the saved page, clamped to two lines when it runs long enough to wrap."
            sourceType="webpage"
            dateLabel="Today"
            onSelect={() => setDrawerOpen(true)}
          />
          <MemoryRow
            title="Sample PDF title"
            snippet="Snippet text."
            sourceType="pdf"
            dateLabel="Yesterday"
            onSelect={() => setDrawerOpen(true)}
          />
          <MemoryRow
            title="Sample video title"
            sourceType="youtube"
            dateLabel="Oct 21"
            actions={
              <IconButton label="Delete" icon={<IconTrash size={18} />} size="sm" />
            }
          />
        </MemoryList>
      </Section>

      <Section title="Toggle & tabs">
        <div className="divide-y divide-line-soft rounded-card border border-line bg-surface px-4">
          <Toggle
            label="Auto-detect sensitive pages"
            description="Skip banking, health and login pages."
            checked={toggles.detect}
            onChange={(detect) => setToggles((t) => ({ ...t, detect }))}
          />
          <Toggle
            label="Show save confirmation"
            checked={toggles.confirm}
            onChange={(confirm) => setToggles((t) => ({ ...t, confirm }))}
          />
          <Toggle
            label="Disabled"
            checked={false}
            onChange={() => undefined}
            disabled
          />
        </div>
        <Tabs
          label="Sample tabs"
          items={[
            {
              id: "content",
              label: "Content",
              panel: <p className="text-muted">Content panel.</p>,
            },
            {
              id: "notes",
              label: "Notes",
              panel: <p className="text-muted">Notes panel.</p>,
            },
            {
              id: "info",
              label: "Info",
              panel: <p className="text-muted">Info panel.</p>,
            },
          ]}
        />
      </Section>

      <Section title="Skeletons">
        <div className="space-y-2">
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-4 w-full" />
        </div>
        <ul className="overflow-hidden rounded-card border border-line bg-surface">
          <MemoryRowSkeleton />
          <MemoryRowSkeleton />
        </ul>
      </Section>

      <Section title="Overlays">
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setModalOpen(true)}>
            Open modal
          </Button>
          <Button variant="secondary" onClick={() => setDrawerOpen(true)}>
            Open drawer
          </Button>
        </div>
        <ToastDemo />
      </Section>

      <Section title="Theme toggle">
        <div className="flex flex-wrap items-center gap-3">
          <ThemeToggle />
          <ThemeToggle variant="icon" />
        </div>
        <p className="text-sm text-muted">
          Changes the whole app; these panels keep their fixed theme.
        </p>
      </Section>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Delete this memory?"
        description="This removes it from search and answers."
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => setModalOpen(false)}>Delete</Button>
          </>
        }
      />
      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        eyebrow="Web · Oct 12"
        title="Sample memory detail"
        footer={
          <>
            <Button variant="secondary" leadingIcon={<IconCopy size={18} />}>
              Copy
            </Button>
            <Button variant="ghost" leadingIcon={<IconTrash size={18} />}>
              Delete
            </Button>
          </>
        }
      >
        <p className="text-muted">Drawer body content.</p>
      </Drawer>
    </div>
  );
}

function ThemePanel({ theme }: { theme: "light" | "dark" }) {
  const [portal, setPortal] = useState<HTMLDivElement | null>(null);
  return (
    <div
      data-theme={theme}
      className="min-w-0 rounded-panel border border-line bg-bg p-4 sm:p-6"
    >
      <h2 className="mb-6 font-display text-2xl font-bold tracking-tight">
        {theme === "light" ? "Light" : "Dark"}
      </h2>
      <PortalContainerContext.Provider value={portal}>
        <ToastProvider>
          <Showcase />
        </ToastProvider>
      </PortalContainerContext.Provider>
      <div ref={setPortal} />
    </div>
  );
}

export default function ComponentsGallery() {
  return (
    <div className="min-h-screen bg-bg text-fg">
      <header className="sticky top-0 z-10 border-b border-line bg-bg">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <Logo size={20} />
            <span className="font-mono text-eyebrow uppercase text-muted">
              Components
            </span>
          </div>
          <ThemeToggle />
        </div>
      </header>
      <main className="mx-auto grid max-w-[1400px] gap-4 px-4 py-6 sm:px-6 lg:grid-cols-2">
        <ThemePanel theme="light" />
        <ThemePanel theme="dark" />
      </main>
    </div>
  );
}
