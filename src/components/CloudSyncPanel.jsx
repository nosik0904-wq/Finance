import React, { useState } from "react";

function Field({ label, children, helper }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {helper && <small className="helper-text">{helper}</small>}
    </label>
  );
}

export default function CloudSyncPanel({ cloudSync, householdName }) {
  const { cloud, signIn, signUp, signOut, createHouseholdFromThisDevice, joinHousehold, pullLatest, pushCurrent, userEmail } = cloudSync;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [confirmForce, setConfirmForce] = useState(false);

  const signedIn = Boolean(cloud.session?.user);
  const connected = Boolean(cloud.householdId);
  const status = !cloud.configured ? "Not configured" : cloud.loading ? "Loading" : cloud.saving ? "Saving" : cloud.conflict ? "Needs refresh" : connected ? "Cloud connected" : signedIn ? "Signed in" : "Signed out";

  const handleSignIn = () => signIn(email, password);
  const handleSignUp = () => signUp(email, password);

  return (
    <article className={`panel cloud-panel ${connected ? "ready" : ""}`}>
      <div className="panel-heading">
        <div>
          <h2>Cloud household sync</h2>
          <p>Use this for Carl and Kim to share the same household data across phones. Backups and CSV exports still stay available.</p>
        </div>
        <span className={`pill ${connected ? "safe" : cloud.conflict ? "warning" : ""}`}>{status}</span>
      </div>

      {!cloud.configured && <div className="inline-warning">Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, then redeploy.</div>}
      {cloud.error && <div className="inline-warning">{cloud.error}</div>}
      {cloud.message && <div className="inline-note">{cloud.message}</div>}

      {!signedIn && cloud.configured && (
        <div className="cloud-auth-grid">
          <Field label="Email"><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /></Field>
          <Field label="Password"><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 6 characters" /></Field>
          <div className="preset-row">
            <button className="primary-action" onClick={handleSignIn} disabled={cloud.loading || !email || !password}>Sign in</button>
            <button onClick={handleSignUp} disabled={cloud.loading || !email || !password}>Create account</button>
          </div>
        </div>
      )}

      {signedIn && !connected && (
        <div className="cloud-actions-grid">
          <div className="backup-card important">
            <strong>Create household from this device</strong>
            <small>This uploads the current setup as revision 1. Do this on Carl's main device first.</small>
            <button className="primary-action" onClick={() => createHouseholdFromThisDevice(householdName)}>Create cloud household</button>
          </div>
          <div className="backup-card">
            <strong>Join existing household</strong>
            <small>Use the invite code from the owner's device. This will pull the shared cloud data.</small>
            <input value={inviteCode} onChange={(event) => setInviteCode(event.target.value.toUpperCase())} placeholder="Invite code" />
            <button onClick={() => joinHousehold(inviteCode)}>Join household</button>
          </div>
        </div>
      )}

      {signedIn && connected && (
        <div className="cloud-connected-grid">
          <div>
            <strong>{cloud.householdName || householdName || "Finance household"}</strong>
            <span>Signed in as {userEmail}</span>
            <span>Role: {cloud.role || "member"}</span>
            <span>Cloud revision: {cloud.revision ?? "—"}</span>
          </div>
          <div>
            <strong>Invite Kim</strong>
            <span className="invite-code">{cloud.inviteCode || "No code"}</span>
            <small>Kim signs in, enters this code, then pulls the same household state.</small>
          </div>
          <div className="preset-row cloud-buttons">
            <button onClick={pullLatest} disabled={cloud.loading}>Pull latest</button>
            <button onClick={() => pushCurrent()} disabled={cloud.saving}>Push this device</button>
            <button onClick={signOut}>Sign out</button>
          </div>
          {cloud.conflict && (
            <div className="inline-warning">
              Another device saved first. Pull latest to use the newest household data. If you know this device is correct, force push it.
              <div className="preset-row">
                <button onClick={pullLatest}>Pull latest now</button>
                {!confirmForce ? (
                  <button onClick={() => setConfirmForce(true)}>Show force push</button>
                ) : (
                  <button className="danger-button" onClick={() => pushCurrent({ force: true })}>Force push this device</button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="inline-note">
        Safety rule: cloud sync is for tracking and shared visibility only. Manual bank balances and the backup/export tools still stay as the source of recovery.
      </div>
    </article>
  );
}
