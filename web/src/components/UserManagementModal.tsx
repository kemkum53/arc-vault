"use client";

import { useState, useEffect, useCallback } from "react";
import { Icon, Button } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import {
  getUsers, getAccounts, getUserSessions, createUser, updateUser, deleteUser, revokeUserToken,
  type UserResponse, type UserSession,
} from "@/lib/api";

/** "Firefox · Windows" from a user agent string. */
function shortAgent(ua: string | null): string {
  if (!ua) return "bilinmeyen tarayıcı";
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox"
    : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Tarayıcı";
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS"
    : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} · ${os}` : browser;
}

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "az önce";
  if (s < 3600) return `${Math.floor(s / 60)} dk önce`;
  if (s < 86400) return `${Math.floor(s / 3600)} sa önce`;
  return `${Math.floor(s / 86400)} gün önce`;
}

function stamp(iso: string): string {
  return new Date(iso).toLocaleString("tr-TR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function IpTag({ ip, mine }: { ip: string | null; mine: boolean }) {
  if (!ip) return <span style={{ color: "var(--fg-5)" }}>IP kaydı yok</span>;
  return (
    <span title={mine ? "Senin şu anki IP adresinle aynı" : "Senin IP adresinden farklı"} style={{
      color: mine ? "var(--fg-4)" : "#ffb020",
      background: mine ? "transparent" : "rgba(255,176,32,0.1)",
      padding: mine ? 0 : "1px 5px", borderRadius: 4,
    }}>{ip}{mine ? " (sen)" : ""}</span>
  );
}

interface Props {
  onClose: () => void;
}

const inputStyle: React.CSSProperties = {
  background: "var(--bg-input)",
  border: "1px solid var(--border-strong)",
  borderRadius: "var(--radius)",
  padding: "9px 12px",
  color: "var(--fg-2)",
  fontSize: 13,
  fontFamily: "var(--font-ui)",
  outline: "none",
  width: "100%",
};

const labelStyle: React.CSSProperties = {
  fontFamily: "var(--font-ui)", fontWeight: 600, fontSize: 10.5,
  color: "var(--fg-4)", textTransform: "uppercase", letterSpacing: "0.14em",
};

export function UserManagementModal({ onClose }: Props) {
  const t = useT();
  const { user: currentUser, logout } = useAuth();
  const [users, setUsers] = useState<UserResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Add user form
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState("user");
  const [newGroup, setNewGroup] = useState("");
  const [groups, setGroups] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);

  // Edit user
  const [editId, setEditId] = useState<string | null>(null);
  const [editUsername, setEditUsername] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [editRole, setEditRole] = useState("");
  const [editGroup, setEditGroup] = useState("");
  const [saving, setSaving] = useState(false);
  const [sessionsFor, setSessionsFor] = useState<string | null>(null);
  const [sessions, setSessions] = useState<UserSession[] | null>(null);

  const toggleSessions = async (userId: string) => {
    if (sessionsFor === userId) { setSessionsFor(null); return; }
    setSessionsFor(userId);
    setSessions(null);
    try {
      setSessions(await getUserSessions(userId));
    } catch (err) {
      setSessions([]);
      setError(err instanceof Error ? err.message : "Girişler alınamadı");
    }
  };

  const loadUsers = useCallback(async () => {
    try {
      const data = await getUsers();
      setUsers(data);
    } catch {
      setError("Kullanicilar yuklenemedi");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  useEffect(() => {
    getAccounts()
      .then(accs => setGroups([...new Set(accs.map(a => a.group_name).filter((g): g is string => !!g))].sort()))
      .catch(() => setGroups([]));
  }, []);

  const handleCreate = async () => {
    if (!newUsername || !newPassword) return;
    setCreating(true);
    setError(null);
    try {
      await createUser(newUsername, newPassword, newRole, newRole === "admin" ? null : newGroup || null);
      setNewUsername("");
      setNewPassword("");
      setNewRole("user");
      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Olusturma basarisiz");
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (u: UserResponse) => {
    if (!confirm(t("um.deleteConfirm"))) return;
    setError(null);
    try {
      await deleteUser(u.id);
      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Silme basarisiz");
    }
  };

  const handleRevoke = async (u: UserResponse) => {
    if (!confirm(t("um.revokeConfirm"))) return;
    setError(null);
    try {
      await revokeUserToken(u.id);
      if (u.id === currentUser?.id) {
        logout();
        return;
      }
      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Token iptal basarisiz");
    }
  };

  const startEdit = (u: UserResponse) => {
    setEditId(u.id);
    setEditUsername(u.username);
    setEditPassword("");
    setEditRole(u.role);
    setEditGroup(u.account_group ?? "");
  };

  const handleSave = async () => {
    if (!editId) return;
    setSaving(true);
    setError(null);
    try {
      const data: Record<string, string> = {};
      const orig = users.find(u => u.id === editId);
      if (editUsername !== orig?.username) data.username = editUsername;
      if (editPassword) data.password = editPassword;
      if (editRole !== orig?.role) data.role = editRole;
      if (editGroup !== (orig?.account_group ?? "")) data.account_group = editGroup;
      if (Object.keys(data).length > 0) {
        await updateUser(editId, data);
      }
      setEditId(null);
      await loadUsers();
      if (editId === currentUser?.id && (data.password || data.role)) {
        logout();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kaydetme basarisiz");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 100,
        background: "rgba(0,0,0,0.6)",
        backdropFilter: "blur(8px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 560, maxWidth: "100%", maxHeight: "85vh",
          background: "var(--bg-2)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "0 24px 80px rgba(0,0,0,0.5)",
          padding: "28px 28px 24px",
          display: "flex", flexDirection: "column", gap: 20,
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <h2 style={{
              margin: 0, fontFamily: "var(--font-display)", fontWeight: 600,
              fontSize: 20, color: "var(--fg-1)",
            }}>{t("um.title")}</h2>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none", border: "none", cursor: "pointer",
              color: "var(--fg-4)", padding: 4, borderRadius: "var(--radius-sm)",
            }}
          >
            <Icon name="x" size={18} />
          </button>
        </div>

        {/* Error */}
        {error && (
          <div style={{
            padding: "8px 12px",
            background: "rgba(244,67,54,0.08)",
            border: "1px solid rgba(244,67,54,0.25)",
            borderRadius: "var(--radius)",
            fontFamily: "var(--font-mono)", fontSize: 12, color: "#f44336",
            display: "flex", justifyContent: "space-between", alignItems: "center",
          }}>
            <span>{error}</span>
            <button onClick={() => setError(null)} style={{
              background: "none", border: "none", color: "#f44336", cursor: "pointer",
              fontFamily: "var(--font-mono)", fontSize: 11,
            }}>x</button>
          </div>
        )}

        {/* User list */}
        <div style={{ overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
          {loading ? (
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--fg-4)" }}>...</span>
          ) : users.length === 0 ? (
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--fg-4)" }}>{t("um.noUsers")}</span>
          ) : users.map((u) => (
            <div key={u.id} style={{
              background: "var(--bg-3)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
              padding: "12px 14px",
              display: "flex", flexDirection: "column", gap: 8,
            }}>
              {editId === u.id ? (
                /* Edit mode */
                <>
                  <div style={{ display: "flex", gap: 8 }}>
                    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
                      <span style={labelStyle}>{t("um.username")}</span>
                      <input value={editUsername} onChange={(e) => setEditUsername(e.target.value)}
                        style={inputStyle} />
                    </div>
                    <div style={{ width: 100, display: "flex", flexDirection: "column", gap: 4 }}>
                      <span style={labelStyle}>{t("um.role")}</span>
                      <select value={editRole} onChange={(e) => setEditRole(e.target.value)}
                        style={{ ...inputStyle, cursor: "pointer" }}>
                        <option value="admin">admin</option>
                        <option value="user">user</option>
                      </select>
                    </div>
                  </div>
                  {editRole !== "admin" && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <span style={labelStyle}>Hesap grubu</span>
                      <select value={editGroup} onChange={(e) => setEditGroup(e.target.value)}
                        style={{ ...inputStyle, cursor: "pointer" }}>
                        <option value="">Tümü (bütün hesaplar)</option>
                        {groups.map(g => <option key={g} value={g}>Yalnızca {g}</option>)}
                      </select>
                    </div>
                  )}
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <span style={labelStyle}>{t("um.newPassword")}</span>
                    <input type="password" value={editPassword} onChange={(e) => setEditPassword(e.target.value)}
                      placeholder="..." style={inputStyle} />
                  </div>
                  <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                    <Button variant="ghost" onClick={() => setEditId(null)}>{t("um.cancel")}</Button>
                    <Button variant="primary" onClick={handleSave}>
                      {saving ? t("um.saving") : t("um.save")}
                    </Button>
                  </div>
                </>
              ) : (
                /* View mode */
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: "var(--radius)",
                    background: u.role === "admin"
                      ? "linear-gradient(135deg, #7b2ff7, #5a1fd0)"
                      : "linear-gradient(135deg, #00d2ff, #0090b0)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    flexShrink: 0,
                  }}>
                    <Icon name={u.role === "admin" ? "shield" : "users"} size={14} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{
                        fontFamily: "var(--font-ui)", fontWeight: 600, fontSize: 13.5,
                        color: "var(--fg-1)",
                      }}>
                        {u.username}
                      </span>
                      {u.id === currentUser?.id && (
                        <span style={{
                          fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--fg-5)",
                        }}>{t("um.you")}</span>
                      )}
                      <span style={{
                        fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--fg-4)",
                        background: "var(--bg-1)", padding: "2px 6px", borderRadius: 4,
                      }}>{u.role}</span>
                      {u.role !== "admin" && u.account_group && (
                        <span title="Yalnızca bu gruptaki hesapları görür" style={{
                          fontFamily: "var(--font-mono)", fontSize: 10, color: "#00d2ff",
                          background: "rgba(0,210,255,0.08)", padding: "2px 6px", borderRadius: 4,
                        }}>{u.account_group}</span>
                      )}
                    </div>
                    <div style={{
                      fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--fg-5)", marginTop: 3,
                      display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center",
                    }}>
                      {u.last_seen_at ? (
                        <>
                          <span title={stamp(u.last_seen_at)}>son görülme {ago(u.last_seen_at)}</span>
                          <span>·</span>
                          <IpTag ip={u.last_seen_ip} mine={u.last_seen_is_you} />
                          <span>·</span>
                          <span>{shortAgent(u.last_seen_ua)}</span>
                        </>
                      ) : (
                        <span>henüz kayıt yok</span>
                      )}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                    <button onClick={() => toggleSessions(u.id)} className="av-icon-btn"
                      title="Son girişler" style={{ padding: 6, color: sessionsFor === u.id ? "#00d2ff" : undefined }}>
                      <Icon name="monitor" size={14} />
                    </button>
                    <button onClick={() => startEdit(u)} className="av-icon-btn"
                      title={t("um.editUser")} style={{ padding: 6 }}>
                      <Icon name="edit-2" size={14} />
                    </button>
                    <button onClick={() => handleRevoke(u)} className="av-icon-btn"
                      title={t("um.revokeToken")} style={{ padding: 6 }}>
                      <Icon name="shield-off" size={14} />
                    </button>
                    {u.id !== currentUser?.id && (
                      <button onClick={() => handleDelete(u)} className="av-icon-btn"
                        title="Sil" style={{ padding: 6, color: "#f44336" }}>
                        <Icon name="trash-2" size={14} />
                      </button>
                    )}
                  </div>
                </div>
              )}
              {sessionsFor === u.id && editId !== u.id && (
                <div style={{
                  marginTop: 10, borderTop: "1px solid var(--border)", paddingTop: 8,
                  fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--fg-4)",
                  display: "flex", flexDirection: "column", gap: 4,
                }}>
                  <span style={{ color: "var(--fg-5)" }}>Son girişler (en yeni üstte)</span>
                  {sessions === null && <span>yükleniyor…</span>}
                  {sessions?.length === 0 && <span>giriş kaydı yok</span>}
                  {sessions?.map((s, i) => (
                    <div key={i} style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                      <span style={{ minWidth: 82 }}>{stamp(s.created_at)}</span>
                      <IpTag ip={s.ip} mine={s.is_you} />
                      <span>{shortAgent(s.user_agent)}</span>
                      <span style={{ color: s.open ? "#4caf50" : "var(--fg-5)" }}>{s.open ? "açık" : "kapalı"}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Add user form */}
        <div style={{
          borderTop: "1px solid var(--border)",
          paddingTop: 16,
          display: "flex", flexDirection: "column", gap: 10,
        }}>
          <span style={{
            fontFamily: "var(--font-ui)", fontWeight: 600, fontSize: 12,
            color: "var(--fg-3)", textTransform: "uppercase", letterSpacing: "0.08em",
          }}>{t("um.addUser")}</span>
          <div style={{ display: "flex", gap: 8 }}>
            <input value={newUsername} onChange={(e) => setNewUsername(e.target.value)}
              placeholder={t("um.username")} style={{ ...inputStyle, flex: 1 }} />
            <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
              placeholder={t("um.password")} style={{ ...inputStyle, flex: 1 }}
              onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); }} />
            <select value={newRole} onChange={(e) => setNewRole(e.target.value)}
              style={{ ...inputStyle, width: 90, cursor: "pointer" }}>
              <option value="user">user</option>
              <option value="admin">admin</option>
            </select>
          </div>
          {newRole !== "admin" && (
            <select value={newGroup} onChange={(e) => setNewGroup(e.target.value)}
              style={{ ...inputStyle, cursor: "pointer" }} title="Kullanıcının görebileceği hesaplar">
              <option value="">Hesap grubu: tümü (bütün hesaplar)</option>
              {groups.map(g => <option key={g} value={g}>Hesap grubu: yalnızca {g}</option>)}
            </select>
          )}
          <Button variant="primary" icon="user-plus" onClick={handleCreate} full>
            {creating ? t("um.creating") : t("um.create")}
          </Button>
        </div>
      </div>
    </div>
  );
}
