import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import AppShell from "./layout/AppShell.jsx";
import { AuthProvider } from "./state/AuthContext.jsx";
import { AuditRunProvider } from "./state/AuditRunContext.jsx";
import RequireAuth from "./components/auth/RequireAuth.jsx";
import Login from "./pages/Login.jsx";
import Register from "./pages/Register.jsx";
import AuditRun from "./pages/AuditRun.jsx";
import Reports from "./pages/Reports.jsx";
import RuleProfiles from "./pages/RuleProfiles.jsx";
import Profile from "./pages/Profile.jsx";

export default function App() {
  return (
    <BrowserRouter>
      {/* Above the router so session state survives navigation — see
          state/AuthContext.jsx. */}
      <AuthProvider>
        <Routes>
          <Route path="login" element={<Login />} />
          <Route path="register" element={<Register />} />

          {/* Everything else requires a valid session (RequireAuth checks
              AuthContext and redirects to /login otherwise). */}
          <Route element={<RequireAuth />}>
            {/* Above the router so the current run survives navigating away
                from /audit and back — see state/AuditRunContext.jsx. */}
            <Route
              element={
                <AuditRunProvider>
                  <AppShell />
                </AuditRunProvider>
              }
            >
              <Route index element={<Navigate to="/audit" replace />} />
              <Route path="audit" element={<AuditRun />} />
              <Route path="reports" element={<Reports />} />
              <Route path="rule-profiles" element={<RuleProfiles />} />
              <Route path="profile" element={<Profile />} />
              <Route path="*" element={<Navigate to="/audit" replace />} />
            </Route>
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
