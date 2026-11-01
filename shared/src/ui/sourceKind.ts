export type SourceKind = "web" | "pdf" | "video" | "note";

/** Map API source types ("webpage", "pdf", "youtube", ...) onto badge kinds. */
export function sourceKind(type: string | null | undefined): SourceKind {
  switch ((type ?? "").toLowerCase()) {
    case "pdf":
      return "pdf";
    case "youtube":
    case "video":
      return "video";
    case "note":
    case "manual_note":
    case "text":
      return "note";
    default:
      return "web";
  }
}
