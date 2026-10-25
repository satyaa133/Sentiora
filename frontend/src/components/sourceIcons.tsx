import type { ReactNode } from "react";

import {
  IconFile,
  IconGlobe,
  IconLink,
  IconMail,
  IconMessage,
  IconNote,
  IconVideo,
} from "@shared/ui";
import type { SourceKind } from "@shared/ui";

import type { SourceId } from "../types/sourcePreferences";

/** Stroke icons for the source catalog (replaces the catalog's emoji). */
export const SOURCE_ICONS: Record<SourceId, ReactNode> = {
  webpages: <IconGlobe size={20} />,
  youtube: <IconVideo size={20} />,
  pdf: <IconFile size={20} />,
  chatgpt: <IconMessage size={20} />,
  notion: <IconNote size={20} />,
  github: <IconLink size={20} />,
  twitter: <IconGlobe size={20} />,
  substack: <IconMail size={20} />,
};

/** Badge kind for catalog sources that map onto a memory type. */
export const SOURCE_BADGE: Partial<Record<SourceId, SourceKind>> = {
  webpages: "web",
  youtube: "video",
  pdf: "pdf",
};
