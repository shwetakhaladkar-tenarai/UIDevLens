import React from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../../state/AuthContext.jsx";
import LoadingState from "../ui/LoadingState.jsx";

/**
 * Layout-route guard: renders the protected subtree only once we know a
 * session cookie is valid (see AuthContext's initial /api/auth/me check).
 * Redirects to /login otherwise, remembering where the user was headed so
 * Login.jsx can send them back after a successful sign-in.
 */
export default function RequireAuth() {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <LoadingState message="Checking session…" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <Outlet />;
}
