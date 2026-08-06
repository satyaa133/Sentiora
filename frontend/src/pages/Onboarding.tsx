import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { APP_NAME } from "@shared/constants/app";
import { useAuth } from "../context/AuthContext";

export default function Onboarding() {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();

  function handleComplete() {
    if (isAuthenticated) {
      navigate("/dashboard");
    } else {
      navigate("/signup");
    }
  }

  return (
    <div className="min-h-screen w-screen bg-[#FFFDF7] text-[#1F2421] font-sans flex flex-col justify-between p-8 selection:bg-moss-100 selection:text-moss-700">
      {/* Centered Brand Header */}
      <header className="text-center pt-4">
        <h1 className="font-serif text-3xl font-bold text-[#1F2421] tracking-tight">{APP_NAME}</h1>
      </header>

      {/* Main Step Canvas */}
      <main className="max-w-xl mx-auto w-full my-auto py-8 space-y-8">
        {/* STEP 1: Welcome to Sentiora */}
        {step === 1 && (
          <div className="space-y-8 text-center">
            <div className="space-y-2">
              <h2 className="font-serif text-3xl font-bold text-[#1F2421]">Welcome to Sentiora</h2>
              <p className="font-serif italic text-sm text-[#60706A]">Your personal digital memory</p>
            </div>

            {/* Feature list */}
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

        {/* STEP 2: You control what gets saved */}
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

        {/* STEP 3: Your first memory is saved! */}
        {step === 3 && (
          <div className="space-y-6 text-center">
            <div className="space-y-2">
              <h2 className="font-serif text-3xl font-bold text-[#1F2421]">Your first memory is saved!</h2>
              <p className="text-xs text-[#60706A] max-w-md mx-auto leading-relaxed">
                We've initialized a default welcome memory card in your vault to show you how saved knowledge is structured and preserved.
              </p>
            </div>

            {/* Default Welcome Memory Card */}
            <div className="bg-white border border-[#E5DFD0] rounded-2xl p-6 shadow-card text-left space-y-4">
              {/* Header Badges & Browser Link Font Domain */}
              <div className="flex items-center justify-between text-xs pb-1 border-b border-[#FAF8F1]">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center px-2.5 py-1 rounded text-[10px] font-bold tracking-wider uppercase bg-[#DBE9DF] text-[#2C6F54]">
                    WEBPAGE
                  </span>
                  <span className="font-mono text-[11px] text-[#60706A] tracking-tight hover:text-[#2C6F54] transition-colors underline decoration-dotted decoration-[#60706A]/40">
                    sentiora.app
                  </span>
                </div>
                <span className="text-[11px] text-[#60706A]">Saved just now · 1 min read</span>
              </div>

              {/* Webpage Title */}
              <h3 className="font-serif text-lg font-bold text-[#1F2421] leading-snug">
                Getting Started with Your Sentiora Memory Vault
              </h3>

              {/* Extracted Webpage Content */}
              <div className="space-y-2 text-xs text-[#60706A] leading-relaxed font-sans bg-[#FFFDF7] p-4 rounded-xl border border-[#E5DFD0]/60">
                <p>
                  "Welcome to Sentiora! Every piece of knowledge you capture using the browser extension or uploader is securely parsed, indexed, and preserved here in your private vault."
                </p>
                <p>
                  "Sentiora extracts primary core ideas, stores high-fidelity text copies, and connects historical concepts automatically so you can search using natural phrases and ask questions anytime."
                </p>
              </div>

              {/* Extracted Key Topics & Metrics */}
              <div className="pt-1 flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="px-2 py-0.5 bg-[#FAF8F1] border border-[#E5DFD0] rounded text-[10px] font-medium text-[#60706A]">#Welcome</span>
                  <span className="px-2 py-0.5 bg-[#FAF8F1] border border-[#E5DFD0] rounded text-[10px] font-medium text-[#60706A]">#PersonalVault</span>
                  <span className="px-2 py-0.5 bg-[#FAF8F1] border border-[#E5DFD0] rounded text-[10px] font-medium text-[#60706A]">#DigitalBrain</span>
                </div>
                <span className="text-[11px] font-medium text-[#2C6F54]">280 words extracted</span>
              </div>
            </div>

            {/* Action Button */}
            <button
              onClick={handleComplete}
              className="w-full py-3.5 bg-[#2C6F54] hover:bg-[#235943] text-white rounded-xl font-semibold text-xs transition-all shadow-md flex items-center justify-center gap-2 mt-2"
            >
              <span>{isAuthenticated ? "Go to Dashboard" : "Create Account & Start Vault"}</span>
              <span>→</span>
            </button>

            <div>
              <span className="inline-block px-3 py-1 bg-[#FAF8F1] border border-[#E5DFD0] text-[#60706A] text-[11px] font-semibold rounded-full">
                Onboarding Complete
              </span>
            </div>
          </div>
        )}
      </main>

      {/* Step Indicators Footer */}
      <footer className="flex justify-center items-center gap-2 pb-4">
        {[1, 2, 3].map((s) => (
          <div
            key={s}
            onClick={() => setStep(s as 1 | 2 | 3)}
            className={`h-2 rounded-full cursor-pointer transition-all ${
              s === step ? "w-8 bg-[#2C6F54]" : "w-2 bg-[#E5DFD0]"
            }`}
          />
        ))}
      </footer>
    </div>
  );
}
