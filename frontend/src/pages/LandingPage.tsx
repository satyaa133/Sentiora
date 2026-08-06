import { Link, useNavigate } from "react-router-dom";
import { APP_NAME } from "@shared/constants/app";

export default function LandingPage() {
  const navigate = useNavigate();

  function handleGetStarted() {
    navigate("/onboarding");
  }

  function handleSignIn() {
    navigate("/login");
  }

  return (
    <div className="relative min-h-screen w-screen bg-[#FFFDF7] text-[#1F2421] font-sans selection:bg-moss-100 selection:text-moss-700 overflow-x-hidden flex flex-col justify-between">
      {/* Ambient Page Backdrop Blur & Glowing Mesh Gradients */}
      <div className="fixed top-0 left-1/4 w-[600px] h-[600px] bg-[#2C6F54]/10 rounded-full blur-[140px] pointer-events-none -z-10" />
      <div className="fixed bottom-10 right-10 w-[500px] h-[500px] bg-[#DBE9DF]/30 rounded-full blur-[120px] pointer-events-none -z-10" />

      {/* Glassmorphic Top Navbar */}
      <header className="sticky top-0 z-50 backdrop-blur-md bg-[#FFFDF7]/85 border-b border-[#E5DFD0]/50 transition-all">
        <div className="max-w-7xl mx-auto w-full px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <Link to="/" className="font-serif text-2xl font-bold text-[#1F2421] tracking-tight hover:text-[#2C6F54] transition-colors">
              {APP_NAME}
            </Link>
            <nav className="hidden md:flex items-center gap-6 text-xs font-semibold text-[#60706A]">
              <a href="#features" className="hover:text-[#1F2421] transition-colors">Features</a>
              <a href="#how-it-works" className="hover:text-[#1F2421] transition-colors">How It Works</a>
              <a href="#privacy" className="hover:text-[#1F2421] transition-colors">Privacy Guarantee</a>
              <a href="#extension" className="hover:text-[#1F2421] transition-colors">Chrome Extension</a>
            </nav>
          </div>

          <div className="flex items-center gap-4">
            <button
              onClick={handleSignIn}
              className="text-xs font-semibold text-[#1F2421] hover:text-[#2C6F54] transition-colors px-3 py-2"
            >
              Log In
            </button>
            <button
              onClick={handleGetStarted}
              className="px-5 py-2.5 bg-[#2C6F54] hover:bg-[#235943] text-white text-xs font-semibold rounded-xl transition-all shadow-md hover:shadow-xl hover:-translate-y-0.5 active:translate-y-0"
            >
              Get Started →
            </button>
          </div>
        </div>
      </header>

      {/* Main Hero Container */}
      <main className="max-w-7xl mx-auto w-full px-6 my-auto py-8 space-y-20">
        {/* Upper Hero Card (Dark Emerald Aesthetic) */}
        <section className="relative rounded-3xl bg-gradient-to-br from-[#1A2621] via-[#12211A] to-[#0A1510] text-white p-8 md:p-14 overflow-hidden shadow-2xl border border-[#2C6F54]/40 min-h-[500px] flex flex-col md:flex-row items-center justify-between gap-12 backdrop-blur-xl">
          
          {/* Internal Ambient Radial Lighting */}
          <div className="absolute -top-32 -left-32 w-[450px] h-[450px] bg-[#2C6F54]/25 rounded-full blur-[100px] pointer-events-none" />
          <div className="absolute -bottom-32 -right-32 w-[500px] h-[500px] bg-[#2C6F54]/30 rounded-full blur-[120px] pointer-events-none" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-[#162A21]/40 rounded-full blur-[90px] pointer-events-none" />

          {/* Left Hero Content */}
          <div className="space-y-6 max-w-xl z-10">
            <span className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#2C6F54]/35 border border-[#2C6F54]/60 text-[#DBE9DF] text-[11px] font-bold tracking-wide uppercase shadow-inner backdrop-blur-md">
              <span className="w-2 h-2 rounded-full bg-[#34D399] animate-pulse" />
              AI-Powered Personal Knowledge Vault
            </span>

            <h1 className="font-serif text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight text-white leading-[1.15]">
              Unlock Every Article, PDF & Video You Ever Read — <span className="text-[#DBE9DF] italic underline decoration-[#2C6F54]/60 decoration-wavy underline-offset-8">Now Just One Search Away!</span>
            </h1>

            <p className="text-xs sm:text-sm text-[#DBE9DF]/85 leading-relaxed font-sans max-w-lg">
              Sentiora is your private digital second brain. Automatically capture web articles, research papers, and YouTube transcripts, then ask natural language questions with instant citations.
            </p>

            <div className="flex flex-wrap items-center gap-4 pt-2">
              <button
                onClick={handleGetStarted}
                className="px-7 py-3.5 bg-[#2C6F54] hover:bg-[#235943] text-white text-xs font-bold rounded-xl transition-all shadow-xl hover:shadow-2xl hover:-translate-y-0.5 active:translate-y-0 flex items-center gap-2"
              >
                <span>Start Your Memory Vault</span>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                </svg>
              </button>

              <button
                onClick={handleSignIn}
                className="px-5 py-3.5 bg-white/10 hover:bg-white/20 text-white text-xs font-semibold rounded-xl transition-all border border-white/15 backdrop-blur-md shadow-sm"
              >
                Sign In To Existing Vault
              </button>
            </div>

            <p className="text-[11px] text-[#DBE9DF]/70 font-medium pt-1 flex items-center gap-2">
              <span className="text-[#34D399]">✓</span> No background tracking · 100% conscious capture · Instant setup
            </p>
          </div>

          {/* Right Floating Orbit Graphic & Animated Floating Rings */}
          <div className="relative w-full max-w-md h-96 flex items-center justify-center shrink-0 z-10">
            
            {/* Outer Slow Rotating Ring */}
            <div className="absolute w-80 h-80 rounded-full border border-white/15 border-dashed animate-orbit-spin pointer-events-none" />
            
            {/* Middle Pulsing Ring */}
            <div className="absolute w-60 h-60 rounded-full border border-white/20 animate-float-slow pointer-events-none" />
            
            {/* Inner Floating Ring */}
            <div className="absolute w-40 h-40 rounded-full border border-[#DBE9DF]/30 animate-float-delayed pointer-events-none" />

            {/* Central Node Badge with Pulsing Glow */}
            <div className="z-20 bg-gradient-to-b from-[#2C6F54] to-[#14261D] border border-[#DBE9DF]/50 p-6 rounded-2xl text-center shadow-2xl backdrop-blur-xl animate-pulse-glow">
              <span className="text-3xl inline-block animate-bounce-slow">🧠</span>
              <p className="text-2xl font-serif font-bold text-white mt-1">247+</p>
              <p className="text-[10px] text-[#DBE9DF] font-bold uppercase tracking-widest mt-0.5">Memories Saved</p>
            </div>

            {/* Floating Node Elements */}
            <div className="absolute top-2 left-2 bg-white/15 backdrop-blur-xl border border-white/30 px-3.5 py-2 rounded-2xl text-white text-xs font-semibold flex items-center gap-2 shadow-2xl animate-float-slow hover:scale-105 hover:bg-white/25 transition-all">
              <span className="text-sm">🌐</span> Webpages
            </div>

            <div className="absolute top-6 right-0 bg-white/15 backdrop-blur-xl border border-white/30 px-3.5 py-2 rounded-2xl text-white text-xs font-semibold flex items-center gap-2 shadow-2xl animate-float-delayed hover:scale-105 hover:bg-white/25 transition-all">
              <span className="text-sm">📄</span> Research PDFs
            </div>

            <div className="absolute bottom-4 left-4 bg-white/15 backdrop-blur-xl border border-white/30 px-3.5 py-2 rounded-2xl text-white text-xs font-semibold flex items-center gap-2 shadow-2xl animate-float-side hover:scale-105 hover:bg-white/25 transition-all">
              <span className="text-sm">🎥</span> YouTube Transcripts
            </div>

            <div className="absolute bottom-8 right-2 bg-[#2C6F54]/90 backdrop-blur-xl border border-white/40 px-3.5 py-2 rounded-2xl text-white text-xs font-bold flex items-center gap-2 shadow-2xl animate-float-slow hover:scale-105 hover:bg-[#2C6F54] transition-all">
              <span className="text-sm">🤖</span> RAG AI Assistant
            </div>
          </div>
        </section>

        {/* Lower Feature Grid Section */}
        <section id="features" className="space-y-10 pt-4">
          <div className="text-center space-y-2 max-w-xl mx-auto">
            <h2 className="font-serif text-2xl sm:text-3xl font-bold text-[#1F2421]">
              Built for Thinkers, Researchers & Builders
            </h2>
            <p className="text-xs text-[#60706A]">
              Never lose a valuable article, code snippet, or video summary again.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-white/90 backdrop-blur-md border border-[#E5DFD0] rounded-3xl p-7 shadow-card hover:shadow-xl hover:border-[#2C6F54]/60 hover:-translate-y-1.5 transition-all space-y-4">
              <div className="h-11 w-11 rounded-xl bg-[#DBE9DF] text-[#2C6F54] flex items-center justify-center text-xl font-bold shadow-inner">
                ⚡
              </div>
              <h3 className="text-base font-serif font-bold text-[#1F2421]">1-Click Extension Capture</h3>
              <p className="text-xs text-[#60706A] leading-relaxed font-sans">
                Save full cleaned article texts, research PDFs, or YouTube transcripts instantly with a single click or keyboard shortcut.
              </p>
            </div>

            <div className="bg-white/90 backdrop-blur-md border border-[#E5DFD0] rounded-3xl p-7 shadow-card hover:shadow-xl hover:border-[#2C6F54]/60 hover:-translate-y-1.5 transition-all space-y-4">
              <div className="h-11 w-11 rounded-xl bg-[#DBE9DF] text-[#2C6F54] flex items-center justify-center text-xl font-bold shadow-inner">
                🔎
              </div>
              <h3 className="text-base font-serif font-bold text-[#1F2421]">Instant Semantic Search</h3>
              <p className="text-xs text-[#60706A] leading-relaxed font-sans">
                Search your personal library using natural phrases, conceptual synonyms, or exact keywords across all saved documents.
              </p>
            </div>

            <div className="bg-white/90 backdrop-blur-md border border-[#E5DFD0] rounded-3xl p-7 shadow-card hover:shadow-xl hover:border-[#2C6F54]/60 hover:-translate-y-1.5 transition-all space-y-4">
              <div className="h-11 w-11 rounded-xl bg-[#DBE9DF] text-[#2C6F54] flex items-center justify-center text-xl font-bold shadow-inner">
                💬
              </div>
              <h3 className="text-base font-serif font-bold text-[#1F2421]">Ask Sentiora RAG Assistant</h3>
              <p className="text-xs text-[#60706A] leading-relaxed font-sans">
                Synthesize complex topics and ask questions. Sentiora answers exclusively using your saved knowledge with exact source links.
              </p>
            </div>
          </div>
        </section>

        {/* Lower Call to Action Banner */}
        <section className="relative rounded-3xl bg-[#FAF8F1] border border-[#E5DFD0] text-[#1F2421] p-10 text-center space-y-5 shadow-card overflow-hidden backdrop-blur-md">
          <div className="absolute -top-24 -left-24 w-72 h-72 bg-[#DBE9DF]/50 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -bottom-24 -right-24 w-72 h-72 bg-[#DBE9DF]/50 rounded-full blur-3xl pointer-events-none" />
          
          <h2 className="font-serif text-2xl sm:text-3xl font-bold text-[#1F2421] relative z-10">
            Ready to build your digital second brain?
          </h2>
          <p className="text-xs text-[#60706A] max-w-md mx-auto relative z-10 leading-relaxed font-sans">
            Get started in under 2 minutes. Free, private, and fully customizable.
          </p>
          <div className="pt-2 relative z-10">
            <button
              onClick={handleGetStarted}
              className="px-8 py-3.5 bg-[#2C6F54] hover:bg-[#235943] text-white text-xs font-bold rounded-xl transition-all shadow-md hover:shadow-xl hover:-translate-y-0.5 active:translate-y-0"
            >
              Get Started Now →
            </button>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-[#E5DFD0]/60 bg-[#FAF8F1]/50 backdrop-blur-sm py-6 text-center text-xs text-[#60706A]">
        <div className="max-w-7xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="font-serif font-bold text-[#1F2421]">Sentiora © 2026</p>
          <div className="flex items-center gap-6">
            <Link to="/login" className="hover:underline">Sign In</Link>
            <Link to="/signup" className="hover:underline">Create Account</Link>
            <Link to="/onboarding" className="hover:underline">Onboarding</Link>
            <Link to="/dashboard" className="hover:underline">Vault Dashboard</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
