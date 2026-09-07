import React from "react";

export default function Header({ onReset, showReset = false }) {
  return (
    <header className="border-b border-gray-800 bg-gray-950/80 backdrop-blur sticky top-0 z-50">
      <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
        <button
          onClick={onReset}
          className="flex items-center gap-3 group focus:outline-none"
          aria-label="Go to home"
        >
          <div className="w-8 h-8 rounded-lg bg-brand-500 flex items-center justify-center text-white font-bold text-sm">
            AI
          </div>
          <div>
            <p className="text-sm font-semibold text-white leading-tight group-hover:text-brand-500 transition-colors">
              Frontend Quality Analyzer
            </p>
            <p className="text-xs text-gray-500">Powered by LangGraph + OpenAI</p>
          </div>
        </button>

        {showReset && (
          <button
            onClick={onReset}
            className="text-sm text-gray-400 hover:text-white border border-gray-700 hover:border-gray-500 px-3 py-1.5 rounded-lg transition-colors"
          >
            ← New Analysis
          </button>
        )}
      </div>
    </header>
  );
}
