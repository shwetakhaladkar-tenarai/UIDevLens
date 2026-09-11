import React, { useState } from "react";
import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar.jsx";

/**
 * Shared shell: fixed sidebar (drawer on mobile) + scrollable content area
 * where each route renders via <Outlet/>. Each page owns its own <TopBar/>
 * (see layout/TopBar.jsx) so page-specific controls (search, pipeline
 * status, actions) stay local to the page that needs them.
 */
export default function AppShell() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar mobileOpen={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col lg:pl-64">
        <Outlet context={{ openMobileNav: () => setMobileNavOpen(true) }} />
      </div>
    </div>
  );
}
