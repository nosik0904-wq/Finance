import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createStateSnapshot } from "./auditTrail";
import { getSupabaseClient, hasSupabaseConfig } from "./supabaseClient";

const idleState = {
  configured: hasSupabaseConfig(),
  loading: true,
  saving: false,
  session: null,
  user: null,
  householdId: "",
  householdName: "",
  inviteCode: "",
  role: "",
  revision: null,
  lastPulledAt: "",
  lastSavedAt: "",
  conflict: false,
  message: "",
  error: "",
};

function normalizeInviteCode(value = "") {
  return String(value).trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function userLabel(user) {
  return user?.email || user?.id || "unknown user";
}

export function useCloudSync({ state, setState, normalizeRemoteState, today }) {
  const client = useMemo(() => getSupabaseClient(), []);
  const [cloud, setCloud] = useState(idleState);
  const householdIdRef = useRef("");
  const revisionRef = useRef(null);
  const sessionRef = useRef(null);
  const stateRef = useRef(state);
  const saveInFlightRef = useRef(false);
  const queuedSaveRef = useRef(null);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const setCloudPatch = useCallback((patch) => {
    setCloud((current) => ({ ...current, ...patch }));
  }, []);

  const pullLatestByHouseholdId = useCallback(async (householdId = householdIdRef.current) => {
    if (!client || !householdId) return false;
    setCloudPatch({ loading: true, error: "", message: "Pulling latest household data..." });
    const { data, error } = await client
      .from("household_state")
      .select("state_json, revision, updated_at")
      .eq("household_id", householdId)
      .maybeSingle();

    if (error) {
      setCloudPatch({ loading: false, error: error.message, message: "" });
      return false;
    }

    if (!data?.state_json) {
      setCloudPatch({ loading: false, message: "No cloud household state found yet." });
      return false;
    }

    const normalized = normalizeRemoteState(data.state_json);
    normalized.debug = { ...(normalized.debug || {}), localOnly: false, cloudRevision: data.revision, cloudPulledAt: new Date().toISOString() };
    revisionRef.current = data.revision;
    setState(normalized);
    setCloudPatch({
      loading: false,
      saving: false,
      revision: data.revision,
      lastPulledAt: new Date().toISOString(),
      conflict: false,
      message: `Pulled cloud revision ${data.revision}.`,
    });
    return true;
  }, [client, normalizeRemoteState, setCloudPatch, setState]);

  const loadMembership = useCallback(async (session, { pull = true } = {}) => {
    if (!client || !session?.user) {
      householdIdRef.current = "";
      revisionRef.current = null;
      setCloudPatch({ loading: false, session: session || null, user: session?.user || null, householdId: "", householdName: "", inviteCode: "", role: "", revision: null });
      return null;
    }

    setCloudPatch({ loading: true, session, user: session.user, error: "", message: "" });
    const { data, error } = await client
      .from("household_members")
      .select("role, households(id, name, invite_code)")
      .eq("user_id", session.user.id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error) {
      setCloudPatch({ loading: false, error: error.message });
      return null;
    }

    if (!data?.households?.id) {
      householdIdRef.current = "";
      revisionRef.current = null;
      setCloudPatch({ loading: false, householdId: "", householdName: "", inviteCode: "", role: "", revision: null, message: "Signed in. Create or join a household to start cloud sync." });
      return null;
    }

    householdIdRef.current = data.households.id;
    setCloudPatch({
      loading: false,
      householdId: data.households.id,
      householdName: data.households.name || "Finance household",
      inviteCode: data.households.invite_code || "",
      role: data.role || "member",
    });

    if (pull) await pullLatestByHouseholdId(data.households.id);
    return data.households.id;
  }, [client, pullLatestByHouseholdId, setCloudPatch]);

  const saveCloudState = useCallback(async (nextState, action = {}, before = null, after = null, { force = false } = {}) => {
    if (!client || !sessionRef.current?.user || !householdIdRef.current) return false;

    if (saveInFlightRef.current) {
      queuedSaveRef.current = { nextState, action, before, after, force };
      return false;
    }

    saveInFlightRef.current = true;
    setCloudPatch({ saving: true, error: "", message: "Saving to cloud..." });

    try {
      let expectedRevision = revisionRef.current;
      if (expectedRevision === null || force) {
        const { data: remote, error: readError } = await client
          .from("household_state")
          .select("revision")
          .eq("household_id", householdIdRef.current)
          .maybeSingle();
        if (readError) throw readError;
        expectedRevision = remote?.revision || 0;
      }

      const nextRevision = Number(expectedRevision || 0) + 1;
      const payload = {
        ...nextState,
        debug: {
          ...(nextState.debug || {}),
          localOnly: false,
          cloudRevision: nextRevision,
          cloudSavedAt: new Date().toISOString(),
        },
      };

      const { data: updated, error: updateError } = await client
        .from("household_state")
        .update({
          state_json: payload,
          revision: nextRevision,
          updated_by: sessionRef.current.user.id,
          updated_at: new Date().toISOString(),
        })
        .eq("household_id", householdIdRef.current)
        .eq("revision", expectedRevision)
        .select("revision")
        .maybeSingle();

      if (updateError) throw updateError;
      if (!updated?.revision) {
        setCloudPatch({
          saving: false,
          conflict: true,
          message: "Another device changed the household first. Pull latest before saving again.",
        });
        return false;
      }

      const actionRow = {
        household_id: householdIdRef.current,
        revision: nextRevision,
        action_type: action.type || "state_update",
        title: action.title || "App data changed",
        detail: action.detail || "",
        source: action.source || "app",
        entity_type: action.entityType || "",
        entity_id: action.entityId || "",
        amount: action.amount === undefined || action.amount === "" ? null : Number(action.amount || 0),
        action_date: action.date || today || new Date().toISOString().slice(0, 10),
        before_summary: before || createStateSnapshot(stateRef.current),
        after_summary: after || createStateSnapshot(payload),
        device_label: navigator.userAgent || "browser",
        created_by: sessionRef.current.user.id,
      };

      await client.from("action_log").insert(actionRow);
      await client.from("state_snapshots").insert({
        household_id: householdIdRef.current,
        revision: nextRevision,
        state_json: payload,
        reason: action.title || action.type || "State saved",
        created_by: sessionRef.current.user.id,
      });

      revisionRef.current = nextRevision;
      setCloudPatch({
        saving: false,
        revision: nextRevision,
        lastSavedAt: new Date().toISOString(),
        conflict: false,
        message: `Saved cloud revision ${nextRevision}.`,
      });
      return true;
    } catch (error) {
      setCloudPatch({ saving: false, error: error.message || "Cloud save failed.", message: "" });
      return false;
    } finally {
      saveInFlightRef.current = false;
      const queued = queuedSaveRef.current;
      queuedSaveRef.current = null;
      if (queued) {
        setTimeout(() => saveCloudState(queued.nextState, queued.action, queued.before, queued.after, { force: queued.force }), 50);
      }
    }
  }, [client, setCloudPatch, today]);

  const pushCurrent = useCallback(async ({ force = false } = {}) => {
    const snapshot = createStateSnapshot(stateRef.current);
    return saveCloudState(stateRef.current, {
      type: force ? "cloud_force_push" : "cloud_manual_push",
      title: force ? "Device state force-pushed to cloud" : "Device state pushed to cloud",
      detail: force ? "Manual force push from this browser." : "Manual cloud save from this browser.",
      source: "setup",
      force: true,
    }, snapshot, snapshot, { force });
  }, [saveCloudState]);

  const signIn = useCallback(async (email, password) => {
    if (!client) return { ok: false, error: "Supabase is not configured." };
    setCloudPatch({ loading: true, error: "", message: "Signing in..." });
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) {
      setCloudPatch({ loading: false, error: error.message });
      return { ok: false, error: error.message };
    }
    sessionRef.current = data.session;
    await loadMembership(data.session);
    return { ok: true };
  }, [client, loadMembership, setCloudPatch]);

  const signUp = useCallback(async (email, password) => {
    if (!client) return { ok: false, error: "Supabase is not configured." };
    setCloudPatch({ loading: true, error: "", message: "Creating account..." });
    const { data, error } = await client.auth.signUp({ email, password });
    if (error) {
      setCloudPatch({ loading: false, error: error.message });
      return { ok: false, error: error.message };
    }
    if (data.session) {
      sessionRef.current = data.session;
      await loadMembership(data.session, { pull: false });
      setCloudPatch({ loading: false, message: "Account created. Create or join a household." });
    } else {
      setCloudPatch({ loading: false, message: "Account created. Check your email if confirmation is enabled, then sign in." });
    }
    return { ok: true };
  }, [client, loadMembership, setCloudPatch]);

  const signOut = useCallback(async () => {
    if (!client) return;
    await client.auth.signOut();
    sessionRef.current = null;
    householdIdRef.current = "";
    revisionRef.current = null;
    setCloudPatch({ ...idleState, loading: false, configured: hasSupabaseConfig(), message: "Signed out. Local device data is still available." });
  }, [client, setCloudPatch]);

  const createHouseholdFromThisDevice = useCallback(async (householdName) => {
    if (!client || !sessionRef.current?.user) return false;
    setCloudPatch({ loading: true, error: "", message: "Creating cloud household..." });
    const payload = {
      ...stateRef.current,
      debug: { ...(stateRef.current.debug || {}), localOnly: false, cloudCreatedAt: new Date().toISOString() },
    };
    const { data, error } = await client.rpc("create_household_with_state", {
      household_name: householdName || stateRef.current.household?.householdName || "Finance household",
      initial_state: payload,
    });
    if (error) {
      setCloudPatch({ loading: false, error: error.message, message: "" });
      return false;
    }
    const row = Array.isArray(data) ? data[0] : data;
    householdIdRef.current = row.household_id;
    revisionRef.current = row.revision || 1;
    setCloudPatch({
      loading: false,
      householdId: row.household_id,
      householdName: householdName || stateRef.current.household?.householdName || "Finance household",
      inviteCode: row.invite_code || "",
      role: "owner",
      revision: row.revision || 1,
      lastSavedAt: new Date().toISOString(),
      message: "Cloud household created from this device.",
    });
    setState(payload);
    return true;
  }, [client, setCloudPatch, setState]);

  const joinHousehold = useCallback(async (inviteCode) => {
    if (!client || !sessionRef.current?.user) return false;
    const code = normalizeInviteCode(inviteCode);
    if (!code) {
      setCloudPatch({ error: "Enter an invite code." });
      return false;
    }
    setCloudPatch({ loading: true, error: "", message: "Joining household..." });
    const { data, error } = await client.rpc("join_household_by_code", { invite_code_input: code });
    if (error) {
      setCloudPatch({ loading: false, error: error.message, message: "" });
      return false;
    }
    const row = Array.isArray(data) ? data[0] : data;
    householdIdRef.current = row.household_id;
    revisionRef.current = row.revision || null;
    setCloudPatch({ loading: false, householdId: row.household_id, inviteCode: row.invite_code || code, role: "member", message: "Joined household. Pulling latest data..." });
    await pullLatestByHouseholdId(row.household_id);
    return true;
  }, [client, pullLatestByHouseholdId, setCloudPatch]);

  useEffect(() => {
    if (!client) {
      setCloudPatch({ loading: false, configured: false, error: "Supabase config is missing." });
      return undefined;
    }

    let mounted = true;
    client.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      sessionRef.current = data.session;
      loadMembership(data.session);
    });

    const { data: subscription } = client.auth.onAuthStateChange((_event, session) => {
      sessionRef.current = session;
      loadMembership(session, { pull: Boolean(session) });
    });

    return () => {
      mounted = false;
      subscription?.subscription?.unsubscribe?.();
    };
  }, [client, loadMembership, setCloudPatch]);

  return {
    cloud,
    saveCloudState,
    pushCurrent,
    pullLatest: () => pullLatestByHouseholdId(),
    signIn,
    signUp,
    signOut,
    createHouseholdFromThisDevice,
    joinHousehold,
    hasClient: Boolean(client),
    userEmail: userLabel(cloud.user),
  };
}
