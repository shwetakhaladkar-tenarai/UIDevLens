import React, { useState } from "react";
import { useOutletContext } from "react-router-dom";
import { useAuth } from "../state/AuthContext.jsx";
import TopBar from "../layout/TopBar.jsx";
import Card from "../components/ui/Card.jsx";
import Input from "../components/ui/Input.jsx";
import Button from "../components/ui/Button.jsx";

function FormMessage({ error, status }) {
  if (error) {
    return (
      <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
        {error}
      </p>
    );
  }
  if (status) {
    return (
      <p role="status" className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-700">
        {status}
      </p>
    );
  }
  return null;
}

export default function Profile() {
  const { openMobileNav } = useOutletContext() ?? {};
  const { user, updateProfile } = useAuth();

  // ── Profile details (name / email) ──────────────────────────────────────
  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [profilePassword, setProfilePassword] = useState("");
  const [profileError, setProfileError] = useState("");
  const [profileStatus, setProfileStatus] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);

  const emailChanged = email.trim().toLowerCase() !== (user?.email ?? "").toLowerCase();
  const nameChanged = name.trim() !== (user?.name ?? "");

  async function handleProfileSubmit(e) {
    e.preventDefault();
    setProfileError("");
    setProfileStatus("");

    const updates = {};
    if (nameChanged) updates.name = name.trim();
    if (emailChanged) updates.email = email.trim();
    if (emailChanged) updates.currentPassword = profilePassword;

    if (Object.keys(updates).length === 0) {
      setProfileError("Nothing to update.");
      return;
    }

    setSavingProfile(true);
    try {
      await updateProfile(updates);
      setProfileStatus("Profile updated.");
      setProfilePassword("");
    } catch (err) {
      setProfileError(err.message || "Could not update profile.");
    } finally {
      setSavingProfile(false);
    }
  }

  // ── Change password ──────────────────────────────────────────────────────
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordStatus, setPasswordStatus] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  async function handlePasswordSubmit(e) {
    e.preventDefault();
    setPasswordError("");
    setPasswordStatus("");

    if (newPassword.length < 8) {
      setPasswordError("New password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setPasswordError("New passwords don't match.");
      return;
    }

    setSavingPassword(true);
    try {
      await updateProfile({ currentPassword, newPassword });
      setPasswordStatus("Password changed.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmNewPassword("");
    } catch (err) {
      setPasswordError(err.message || "Could not change password.");
    } finally {
      setSavingPassword(false);
    }
  }

  return (
    <>
      <TopBar onMenuClick={openMobileNav} left={<h1 className="text-sm font-semibold text-gray-900">Profile</h1>} />

      <main className="mx-auto max-w-2xl space-y-6 px-4 py-6 sm:px-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Account Settings</h2>
          <p className="mt-1 text-sm text-gray-500">Update your name, email, and password.</p>
        </div>

        <Card as="section" aria-labelledby="profile-details-heading" className="p-5">
          <h3 id="profile-details-heading" className="mb-4 text-base font-semibold text-gray-900">Profile Details</h3>
          <form onSubmit={handleProfileSubmit} noValidate className="space-y-4">
            <Input label="Name" type="text" value={name} onChange={(e) => setName(e.target.value)} disabled={savingProfile} />
            <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={savingProfile} />

            {emailChanged && (
              <Input
                label="Current password"
                type="password"
                autoComplete="current-password"
                required
                value={profilePassword}
                onChange={(e) => setProfilePassword(e.target.value)}
                disabled={savingProfile}
              />
            )}

            <FormMessage error={profileError} status={profileStatus} />

            <Button type="submit" variant="primary" disabled={savingProfile || (!nameChanged && !emailChanged)}>
              {savingProfile ? "Saving…" : "Save Profile"}
            </Button>
          </form>
        </Card>

        <Card as="section" aria-labelledby="change-password-heading" className="p-5">
          <h3 id="change-password-heading" className="mb-4 text-base font-semibold text-gray-900">Change Password</h3>
          <form onSubmit={handlePasswordSubmit} noValidate className="space-y-4">
            <Input
              label="Current password"
              type="password"
              autoComplete="current-password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              disabled={savingPassword}
            />
            <Input
              label="New password"
              type="password"
              autoComplete="new-password"
              required
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              disabled={savingPassword}
            />
            <Input
              label="Confirm new password"
              type="password"
              autoComplete="new-password"
              required
              value={confirmNewPassword}
              onChange={(e) => setConfirmNewPassword(e.target.value)}
              disabled={savingPassword}
            />

            <FormMessage error={passwordError} status={passwordStatus} />

            <Button type="submit" variant="primary" disabled={savingPassword}>
              {savingPassword ? "Saving…" : "Change Password"}
            </Button>
          </form>
        </Card>
      </main>
    </>
  );
}
