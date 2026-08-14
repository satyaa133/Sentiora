import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { APP_NAME } from "@shared/constants/app";
import { useAuth } from "../context/AuthContext";
import { createMemoryItem } from "../services/memoryService";
import { SOURCE_CATALOG, type SourceId } from "../types/sourcePreferences";

export default function Onboarding() {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [selectedSources, setSelectedSources] = useState<SourceId[]>(["webpages", "youtube"]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const { isAuthenticated, completeOnboarding } = useAuth();

  useEffect(() => {
    if (isAuthenticated) {
      setStep((current) => (current < 3 ? 3 : current));
    }
  }, [isAuthenticated]);

  function toggleSource(sourceId: SourceId) {
    setSelectedSources((prev) =>
      prev.includes(sourceId)
        ? prev.filter((id) => id !== sourceId)
        : [...prev, sourceId],
    );
  }

  async function handleComplete() {
    if (!isAuthenticated) {
      navigate("/signup");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      await completeOnboarding(selectedSources);

      try {
        await createMemoryItem({
          source_type: "webpage",
          title: "Getting Started with Your Sentiora Memory Vault",
          url: "https://sentiora.app/welcome",
          content:
            "Welcome to Sentiora! Every piece of knowledge you capture using the browser extension or uploader is securely parsed, indexed, and preserved here in your private vault. Sentiora extracts primary core ideas, stores high-fidelity text copies, and connects historical concepts automatically so you can search using natural phrases and ask questions anytime.",
        });
      } catch {
        // Ignore if welcome memory already exists
      }

      navigate("/dashboard");
    } catch {
      setError("Unable to save your source preferences. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen w-screen bg-[#FFFDF7] text-[#1F2421] font-sans flex flex-col justify-between p-8 selection:bg-moss-100 selection:text-moss-700">
      <header className="text-center pt-4">
        <h1 className="font-serif text-3xl font-bold text-[#1F2421] tracking-tight">{APP_NAME}</h1>
      </header>

      <main className="max-w-xl mx-auto w-full my-auto py-8 space-y-8">
        {step === 1 && (
          <div className="space-y-8 text-center">
            <div className="space-y-2">
              <h2 className="font-serif text-3xl font-bold text-[#1F2421]">Welcome to Sentiora</h2>
              <p className="font-serif italic text-sm text-[#60706A]">Your personal digital memory</p>
            </div>

            <div className="bg-white border border-[#E5DFD0] rounded-2xl p-6 shadow-card space-y-5 text-left divide-y divide-[#E5DFD0]">
              <div className="flex items-start gap-4 pt-1">
                <div className="h-10 w-10 rounded-xl bg-[#DBE9DF] text-[#2C6F54] flex items-center justify-center shrink-0 font-bold text-base">
                  📥
                </div>
                <div>
                  <h3 className="text-xs font-bold text-[#1F2421]">Save knowledge from any source</h3>
                  <p className="text-xs text-[#60706A] mt-0.5 leading-relaxed">
                    Capture web articles, research PDFs, YouTube videos, and your own custom thoughts.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-4 pt-4">
                <div className="h-10 w-10 rounded-xl bg-[#DBE9DF] text-[#2C6F54] flex items-center justify-center shrink-0 font-bold text-base">
                  🔍
                </div>
                <div>
                  <h3 className="text-xs font-bold text-[#1F2421]">Search and revisit what matters</h3>
                  <p className="text-xs text-[#60706A] mt-0.5 leading-relaxed">
                    A living timeline of your personal reference archive, always organized and readable.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-4 pt-4">
                <div className="h-10 w-10 rounded-xl bg-[#DBE9DF] text-[#2C6F54] flex items-center justify-center shrink-0 font-bold text-base">
                  💬
                </div>
                <div>
                  <h3 className="text-xs font-bold text-[#1F2421]">Ask questions about what you've saved</h3>
                  <p className="text-xs text-[#60706A] mt-0.5 leading-relaxed">
                    Synthesize your collected knowledge with an assistant that reads only from your vault.
                  </p>
                </div>
              </div>
            </div>

            <button
              onClick={() => setStep(2)}
              className="w-full py-3.5 bg-[#2C6F54] hover:bg-[#235943] text-white rounded-xl font-semibold text-xs transition-all shadow-md flex items-center justify-center gap-2"
            >
              <span>Next</span>
              <span>→</span>
            </button>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-8 text-center">
            <div className="h-16 w-16 bg-[#DBE9DF] text-[#2C6F54] rounded-full flex items-center justify-center mx-auto text-2xl">
              🔒
            </div>

            <div className="space-y-2">
              <h2 className="font-serif text-3xl font-bold text-[#1F2421]">You control what gets saved</h2>
              <p className="text-xs text-[#60706A] max-w-md mx-auto leading-relaxed">
                Sentiora never captures anything without your explicit, conscious permission.
              </p>
            </div>

            <div className="bg-white border border-[#E5DFD0] rounded-2xl p-6 shadow-card space-y-4 text-left divide-y divide-[#E5DFD0]">
              <div className="flex items-center gap-3 pt-1">
                <span className="text-base text-[#2C6F54]">🙈</span>
                <span className="text-xs font-semibold text-[#1F2421]">No background tracking or history recording</span>
              </div>
              <div className="flex items-center gap-3 pt-3">
                <span className="text-base text-[#2C6F54]">🛡️</span>
                <span className="text-xs font-semibold text-[#1F2421]">No third-party analytics or behavioral collection</span>
              </div>
              <div className="flex items-center gap-3 pt-3">
                <span className="text-base text-[#2C6F54]">✓</span>
                <span className="text-xs font-semibold text-[#1F2421]">You choose exactly what enters your digital archive</span>
              </div>
            </div>

            <p className="font-serif italic text-xs font-bold text-[#2C6F54]">
              "Your knowledge stays entirely yours."
            </p>

            <button
              onClick={() => setStep(3)}
              className="w-full py-3.5 bg-[#2C6F54] hover:bg-[#235943] text-white rounded-xl font-semibold text-xs transition-all shadow-md flex items-center justify-center gap-2"
            >
              <span>Next</span>
              <span>→</span>
            </button>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-6 text-center">
            <div className="space-y-2">
              <h2 className="font-serif text-3xl font-bold text-[#1F2421]">
                What would you like Sentiora to connect and read?
              </h2>
              <p className="text-xs text-[#60706A] max-w-md mx-auto leading-relaxed">
                Choose the sources you want active in your vault. You can change these anytime in Connected Sources.
              </p>
            </div>

            <div className="bg-white border border-[#E5DFD0] rounded-2xl p-4 shadow-card space-y-2 text-left max-h-[50vh] overflow-y-auto">
              {SOURCE_CATALOG.map((source) => {
                const isSelected = selectedSources.includes(source.id);
                return (
                  <label
                    key={source.id}
                    className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                      isSelected
                        ? "border-[#2C6F54] bg-[#DBE9DF]/40"
                        : "border-[#E5DFD0] bg-[#FFFDF7] hover:bg-white"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSource(source.id)}
                      className="mt-1 accent-[#2C6F54]"
                    />
                    <span className="text-lg">{source.icon}</span>
                    <div className="space-y-0.5">
                      <p className="text-xs font-bold text-[#1F2421]">{source.name}</p>
                      <p className="text-[11px] text-[#60706A] leading-snug">{source.description}</p>
                    </div>
                  </label>
                );
              })}
            </div>

            <button
              onClick={() => {
                if (!isAuthenticated) {
                  navigate("/signup");
                  return;
                }
                setStep(4);
              }}
              disabled={selectedSources.length === 0}
              className="w-full py-3.5 bg-[#2C6F54] hover:bg-[#235943] disabled:opacity-50 text-white rounded-xl font-semibold text-xs transition-all shadow-md flex items-center justify-center gap-2"
            >
              <span>{isAuthenticated ? "Confirm Selection" : "Create Account to Continue"}</span>
              <span>→</span>
            </button>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-6 text-center">
            <div className="space-y-2">
              <h2 className="font-serif text-3xl font-bold text-[#1F2421]">You're all set</h2>
              <p className="text-xs text-[#60706A] max-w-md mx-auto leading-relaxed">
                Your selected sources will appear as active channels in Connected Sources. You can pause or connect more at any time.
              </p>
            </div>

            <div className="bg-white border border-[#E5DFD0] rounded-2xl p-6 shadow-card text-left space-y-3">
              <p className="text-[11px] font-bold uppercase tracking-wider text-[#60706A]">Selected sources</p>
              <div className="flex flex-wrap gap-2">
                {selectedSources.map((sourceId) => {
                  const source = SOURCE_CATALOG.find((item) => item.id === sourceId);
                  return (
                    <span
                      key={sourceId}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#DBE9DF] text-[#2C6F54] text-[11px] font-semibold"
                    >
                      <span>{source?.icon}</span>
                      <span>{source?.name}</span>
                    </span>
                  );
                })}
              </div>
            </div>

            {error && (
              <div className="bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl p-3">
                {error}
              </div>
            )}

            <button
              onClick={handleComplete}
              disabled={isSubmitting}
              className="w-full py-3.5 bg-[#2C6F54] hover:bg-[#235943] disabled:opacity-50 text-white rounded-xl font-semibold text-xs transition-all shadow-md flex items-center justify-center gap-2"
            >
              <span>{isSubmitting ? "Saving preferences…" : "Go to Dashboard"}</span>
              <span>→</span>
            </button>
          </div>
        )}
      </main>

      <footer className="flex justify-center items-center gap-2 pb-4">
        {[1, 2, 3, 4].map((s) => (
          <div
            key={s}
            onClick={() => setStep(s as 1 | 2 | 3 | 4)}
            className={`h-2 rounded-full cursor-pointer transition-all ${
              s === step ? "w-8 bg-[#2C6F54]" : "w-2 bg-[#E5DFD0]"
            }`}
          />
        ))}
      </footer>
    </div>
  );
}
