import React, { useState } from "react";
import Header from "../components/Header.jsx";
import UrlForm from "../components/UrlForm.jsx";
import AnalysisProgress from "../components/AnalysisProgress.jsx";
import { analyzeUrl } from "../services/analyzeService.js";

export default function AnalyzePage({ analyzing, setAnalyzing, onResult }) {
  const [error, setError] = useState("");
  const [pendingUrl, setPendingUrl] = useState("");

  async function handleSubmit(url) {
    setError("");
    setPendingUrl(url);
    setAnalyzing(true);

    try {
      const result = await analyzeUrl(url);
      onResult(result.data);
    } catch (err) {
      setError(err.message || "Something went wrong. Is the backend running?");
    } finally {
      setAnalyzing(false);
      setPendingUrl("");
    }
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <main className="flex-1 flex items-center justify-center px-4 py-16">
        <div className="w-full max-w-2xl">
          {/* Hero */}
          {!analyzing && (
            <div className="text-center mb-10">
              <div className="inline-flex items-center gap-2 text-xs text-brand-400 bg-brand-500/10 border border-brand-500/20 px-3 py-1.5 rounded-full mb-6">
                <span>🤖</span>
                <span>LangGraph · LangChain · OpenAI</span>
              </div>
              <h1 className="text-4xl font-bold text-white mb-3 leading-tight">
                Frontend Quality
                <span className="text-brand-500"> Analyzer</span>
              </h1>
              <p className="text-gray-400 text-base max-w-lg mx-auto">
                Paste any public URL. The AI agent runs a 10-node LangGraph pipeline
                checking performance, network efficiency, design, and accessibility.
              </p>
            </div>
          )}

          {/* Form / Progress */}
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
            {analyzing ? (
              <AnalysisProgress url={pendingUrl} />
            ) : (
              <>
                <UrlForm onSubmit={handleSubmit} analyzing={analyzing} />
                {error && (
                  <div
                    role="alert"
                    className="mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-400"
                  >
                    {error}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Feature grid */}
          {!analyzing && (
            <div className="mt-8 grid sm:grid-cols-2 gap-4">
              {[
                { icon: "⚡", title: "Performance", desc: "Core Web Vitals, LCP, CLS, TBT" },
                { icon: "📡", title: "Network",     desc: "Caching, compression, request counts" },
                { icon: "🎨", title: "Design",      desc: "Contrast, typography, responsiveness" },
                { icon: "♿", title: "Accessibility", desc: "WCAG 2.1 AA, ARIA, keyboard nav" },
              ].map((f) => (
                <div
                  key={f.title}
                  className="flex items-start gap-3 bg-gray-900/50 border border-gray-800 rounded-xl p-4"
                >
                  <span className="text-2xl" aria-hidden="true">{f.icon}</span>
                  <div>
                    <p className="text-sm font-medium text-white">{f.title}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{f.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
