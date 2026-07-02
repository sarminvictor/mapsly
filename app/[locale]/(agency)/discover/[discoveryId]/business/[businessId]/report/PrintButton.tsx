"use client";

// PrintButton · WP5-5 · "Download PDF" = the browser's print-to-PDF over the
// report's print CSS. A tiny client island (needs onClick); the surrounding
// page stays a server component. Hidden in print media via the toolbar class.

export function PrintButton() {
  return (
    <button
      type="button"
      className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700"
      onClick={() => window.print()}
    >
      Download PDF
    </button>
  );
}
