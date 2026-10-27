import { IconPlus } from "@shared/ui";

const QUESTIONS: Array<{ q: string; a: string }> = [
  {
    q: "Is Sentiora free?",
    // TODO: pricing has not been decided; do not invent an answer.
    a: "[TODO]",
  },
  {
    q: "Does it read my browsing history?",
    a: "It never looks at your past history. While you're signed in to the extension, it saves the pages you open from then on. It skips banking, health and sign-in pages it recognises, plus any site you block. Everything it saves is listed in your timeline, where you can delete it.",
  },
  {
    q: "Can I save PDFs that are on my computer?",
    a: "Yes. Open the PDF in Chrome and save it with the extension (turn on “Allow access to file URLs” for Sentiora first), or upload it from the Sources page.",
  },
  {
    q: "What happens if the answer isn't in my memory?",
    a: "Sentiora tells you it couldn't find the answer in what you saved, instead of making one up.",
  },
];

export default function Faq() {
  return (
    <section
      id="faq"
      aria-labelledby="faq-heading"
      className="scroll-mt-16 py-20 sm:py-28"
    >
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <h2 id="faq-heading" className="font-display text-section text-fg">
          Questions
        </h2>
        <div className="mt-8 divide-y divide-line border-y border-line">
          {QUESTIONS.map(({ q, a }) => (
            <details key={q} className="group">
              <summary className="flex min-h-[64px] cursor-pointer list-none items-center justify-between gap-4 py-4 text-[17px] font-semibold text-fg [&::-webkit-details-marker]:hidden">
                {q}
                <IconPlus
                  size={20}
                  className="shrink-0 text-muted transition-transform duration-200 group-open:rotate-45"
                />
              </summary>
              <p className="pb-5 pr-10 text-[16px] leading-relaxed text-muted">{a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
