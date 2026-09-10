import React from "react";

/**
 * Compound table primitive matching the light card-table style used across
 * findings/matrix/history tables. Each sub-component is a thin styled
 * wrapper around the real HTML table element so semantics (scope, etc.)
 * stay correct — callers still control column structure.
 */
export function Table({ className = "", "aria-label": ariaLabel, children }) {
  return (
    <div tabIndex={0} role="region" aria-label={ariaLabel ?? "Scrollable table"} className="overflow-x-auto rounded-xl border border-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">
      <table className={`w-full min-w-[480px] text-left text-sm ${className}`}>{children}</table>
    </div>
  );
}

export function TableHead({ children }) {
  return <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">{children}</thead>;
}

export function TableBody({ children }) {
  return <tbody className="divide-y divide-gray-100">{children}</tbody>;
}

export function TableRow({ className = "", children, ...rest }) {
  return (
    <tr className={`align-top hover:bg-gray-50/80 ${className}`} {...rest}>
      {children}
    </tr>
  );
}

export function TableHeaderCell({ className = "", children, ...rest }) {
  return (
    <th scope="col" className={`px-4 py-3 font-medium ${className}`} {...rest}>
      {children}
    </th>
  );
}

export function TableRowHeaderCell({ className = "", children, ...rest }) {
  return (
    <th scope="row" className={`px-4 py-3 text-left font-medium text-gray-900 ${className}`} {...rest}>
      {children}
    </th>
  );
}

export function TableCell({ className = "", children, ...rest }) {
  return (
    <td className={`px-4 py-3 text-gray-700 ${className}`} {...rest}>
      {children}
    </td>
  );
}

export default Table;
