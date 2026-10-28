/**
 * Static sample libraries for the landing live demo (DESIGN.md §9.1).
 * Everything here is prepared text: the landing page makes no API calls.
 * In answers, [n] cites the n-th entry of `sources` (1-based).
 */
export type Audience = "students" | "developers" | "researchers";
export type DemoKind = "web" | "pdf" | "video" | "note";

export interface DemoItem {
  title: string;
  kind: DemoKind;
  source: string;
  saved: string;
}

export interface DemoQA {
  question: string;
  keywords: string[];
  answer: string;
  /** Indexes into the library's items, in citation order. */
  sources: number[];
}

export interface DemoLibrary {
  label: string;
  items: DemoItem[];
  qas: DemoQA[];
}

export const AUDIENCES: Audience[] = ["students", "developers", "researchers"];

export const DEMO_FALLBACK =
  "Nothing in this sample library covers that. In your own Sentiora, Echo searches everything you've saved.";

export const DEMO_LIBRARIES: Record<Audience, DemoLibrary> = {
  students: {
    label: "Students",
    items: [
      { title: "DBMS unit 3 lecture slides", kind: "pdf", source: "lms.example.edu", saved: "Oct 9" },
      { title: "Viva prep: normal forms", kind: "note", source: "Your note", saved: "Oct 11" },
      { title: "OS: deadlocks explained", kind: "video", source: "youtube.com", saved: "Oct 3" },
      { title: "Big-O cheat sheet", kind: "web", source: "algo.example.dev", saved: "Sep 28" },
      { title: "CN notes: TCP vs UDP", kind: "pdf", source: "lms.example.edu", saved: "Oct 6" },
      { title: "Dijkstra's algorithm in 10 minutes", kind: "video", source: "youtube.com", saved: "Sep 30" },
      { title: "How to write a good SRS", kind: "web", source: "se.example.org", saved: "Sep 21" },
      { title: "Mini-project ideas", kind: "note", source: "Your note", saved: "Sep 19" },
      { title: "Java streams cheat sheet", kind: "web", source: "java.example.dev", saved: "Sep 15" },
      { title: "Aptitude practice set", kind: "pdf", source: "Uploaded file", saved: "Sep 12" },
    ],
    qas: [
      {
        question: "What are the normal forms?",
        keywords: ["normal form", "1nf", "2nf", "3nf", "bcnf", "normaliz", "normalis"],
        answer:
          "1NF removes repeating groups, so every field holds a single value [1]. 2NF drops dependencies on part of a composite key, 3NF drops transitive ones, and BCNF makes every determinant a candidate key [2].",
        sources: [0, 1],
      },
      {
        question: "What causes a deadlock?",
        keywords: ["deadlock", "coffman", "circular wait"],
        answer:
          "Four conditions must hold together: mutual exclusion, hold and wait, no preemption and circular wait [1]. Break any one of them, for example by always taking locks in the same order, and a deadlock can't form [1].",
        sources: [2],
      },
      {
        question: "TCP or UDP for a video call?",
        keywords: ["tcp", "udp", "video call", "transport"],
        answer:
          "UDP. A late video frame is useless, so dropping it beats waiting for a retransmission [1]. TCP suits files and web pages, where every byte has to arrive in order [1].",
        sources: [4],
      },
      {
        question: "Explain Dijkstra quickly",
        keywords: ["dijkstra", "shortest path"],
        answer:
          "Start at the source with distance 0, then keep taking the unvisited node with the smallest known distance and relaxing its edges [1]. With a min-heap that is O((V + E) log V) [2]. Edge weights must not be negative [1].",
        sources: [5, 3],
      },
    ],
  },
  developers: {
    label: "Developers",
    items: [
      { title: "Understanding Docker containers", kind: "web", source: "blog.example.dev", saved: "Oct 12" },
      { title: "Production Dockerfiles, a talk", kind: "video", source: "youtube.com", saved: "Sep 30" },
      { title: "Postgres indexing guide", kind: "web", source: "db.example.dev", saved: "Oct 4" },
      { title: "Rate limiter design notes", kind: "note", source: "Your note", saved: "Oct 8" },
      { title: "useEffect pitfalls", kind: "web", source: "react.example.dev", saved: "Sep 26" },
      { title: "System design primer, chapter 4", kind: "pdf", source: "Uploaded file", saved: "Sep 22" },
      { title: "Rebase or merge?", kind: "web", source: "git.example.dev", saved: "Sep 18" },
      { title: "Kubernetes probes explained", kind: "video", source: "youtube.com", saved: "Sep 14" },
      { title: "REST pagination patterns", kind: "web", source: "api.example.dev", saved: "Sep 10" },
      { title: "Postmortem template", kind: "note", source: "Your note", saved: "Sep 6" },
    ],
    qas: [
      {
        question: "How do containers differ from VMs?",
        keywords: ["container", "docker", " vm", "vms", "virtual machine"],
        answer:
          "Containers share the host kernel and isolate processes with namespaces and cgroups [1], so they start in milliseconds. A VM boots its own operating system on a hypervisor [2].",
        sources: [0, 5],
      },
      {
        question: "How do I keep Docker images small?",
        keywords: ["image", "dockerfile", "multi-stage", "smaller"],
        answer:
          "Use multi-stage builds so compilers stay out of the final image [1], start from a slim base, and copy in only what the app needs at runtime [2].",
        sources: [1, 0],
      },
      {
        question: "When should I add a database index?",
        keywords: ["index", "postgres", "slow query", "explain"],
        answer:
          "Index the columns you filter or join on most, and confirm with EXPLAIN ANALYZE before and after [1]. Each index slows writes a little, so drop the ones no query uses [1].",
        sources: [2],
      },
      {
        question: "How does a token bucket rate limiter work?",
        keywords: ["rate limit", "token bucket", "throttl", "limiter"],
        answer:
          "Each client has a bucket that refills at a fixed rate; a request spends one token and is rejected when the bucket is empty [1]. The bucket size decides how large a burst you allow [2].",
        sources: [3, 5],
      },
    ],
  },
  researchers: {
    label: "Researchers",
    items: [
      { title: "Attention is all you need", kind: "pdf", source: "arxiv.org", saved: "Oct 10" },
      { title: "Lit review: retrieval-augmented generation", kind: "note", source: "Your note", saved: "Oct 7" },
      { title: "A survey of dense retrieval", kind: "pdf", source: "arxiv.org", saved: "Oct 2" },
      { title: "Evaluating LLM answers, a talk", kind: "video", source: "youtube.com", saved: "Sep 29" },
      { title: "Statistical power, explained", kind: "web", source: "stats.example.org", saved: "Sep 24" },
      { title: "Lab meeting notes, week 14", kind: "note", source: "Your note", saved: "Sep 20" },
      { title: "A practical guide to preregistration", kind: "web", source: "osf.example.org", saved: "Sep 17" },
      { title: "Effect sizes cheat sheet", kind: "pdf", source: "Uploaded file", saved: "Sep 13" },
      { title: "Open science in practice, a talk", kind: "video", source: "youtube.com", saved: "Sep 9" },
      { title: "Reviewer 2 response draft", kind: "note", source: "Your note", saved: "Sep 5" },
    ],
    qas: [
      {
        question: "What is self-attention?",
        keywords: ["attention", "transformer"],
        answer:
          "Each token builds a weighted mix of all the others, weighted by how well its query matches their keys [1]. Several heads run in parallel, so the model can follow different relationships at once [1].",
        sources: [0],
      },
      {
        question: "How does RAG reduce hallucinations?",
        keywords: ["rag", "retrieval", "hallucinat", "grounding"],
        answer:
          "It retrieves relevant passages first and has the model answer from them, so each claim can be traced to a source [1]. Answers still need a check when retrieval misses the right passage [2].",
        sources: [1, 2],
      },
      {
        question: "How big a sample do I need?",
        keywords: ["sample size", "power", "how many participants"],
        answer:
          "It depends on the effect size you expect, your alpha and the power you want, often 0.8 [1]. Halving the effect size roughly quadruples the sample you need [2].",
        sources: [4, 7],
      },
      {
        question: "Why preregister a study?",
        keywords: ["preregist", "registered report"],
        answer:
          "Writing down hypotheses and analyses before seeing the data separates confirmatory from exploratory results [1], which makes accidental p-hacking much harder [2].",
        sources: [6, 8],
      },
    ],
  },
};

function normalize(text: string): string {
  return ` ${text.toLowerCase().replace(/[^a-z0-9+-]+/g, " ").trim()} `;
}

/** The prepared answer that best matches a question, or null when none does. */
export function findDemoAnswer(library: DemoLibrary, question: string): DemoQA | null {
  const asked = normalize(question);
  if (!asked.trim()) return null;
  const exact = library.qas.find((qa) => normalize(qa.question) === asked);
  if (exact) return exact;
  let best: DemoQA | null = null;
  let bestScore = 0;
  for (const qa of library.qas) {
    const score = qa.keywords.filter((keyword) => asked.includes(keyword)).length;
    if (score > bestScore) {
      best = qa;
      bestScore = score;
    }
  }
  return best;
}

export type AnswerPart = { text: string } | { cite: number };

/** Split "text [1] more [2]." into text runs and citation markers. */
export function splitCitations(answer: string): AnswerPart[] {
  const parts: AnswerPart[] = [];
  const pattern = /\s?\[(\d+)\]/g;
  let last = 0;
  for (const match of answer.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) parts.push({ text: answer.slice(last, index) });
    parts.push({ cite: Number(match[1]) });
    last = index + match[0].length;
  }
  if (last < answer.length) parts.push({ text: answer.slice(last) });
  return parts;
}
