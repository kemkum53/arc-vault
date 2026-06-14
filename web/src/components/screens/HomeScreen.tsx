"use client";

import { useState, useRef, useCallback } from "react";
import { Icon, Wordmark, Button } from "@/components/ui";
import { AccountCard } from "@/components/AccountCard";
import { useAuth } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import type { AccountResponse } from "@/lib/types";

interface HomeScreenProps {
  accounts: AccountResponse[];
  onSelectAccount: (id: string) => void;
  onAddAccount: () => void;
  onManageUsers?: () => void;
  onSyncAll?: () => void;
  onGlobalSearch?: () => void;
  onSettings?: () => void;
  onSyncAccount?: (id: string) => Promise<void>;
  cardStatuses?: Record<string, string>;
  bulkSyncing?: boolean;
  bulkStatus?: string | null;
  onReorder?: (orderedIds: string[]) => void;
  loading: boolean;
}

export function HomeScreen({ accounts, onSelectAccount, onAddAccount, onManageUsers, onSyncAll, onGlobalSearch, onSettings, onSyncAccount, cardStatuses, bulkSyncing, bulkStatus, onReorder, loading }: HomeScreenProps) {
  const { user, logout, isAdmin } = useAuth();
  const t = useT();
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const dragRef = useRef<string | null>(null);

  const handleDragStart = useCallback((e: React.DragEvent, id: string) => {
    dragRef.current = id;
    setDragId(id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, id: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (id !== dragRef.current) setOverId(id);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    const srcId = dragRef.current;
    if (!srcId || srcId === targetId || !onReorder) return;
    const ids = accounts.map(a => a.id);
    const srcIdx = ids.indexOf(srcId);
    const tgtIdx = ids.indexOf(targetId);
    if (srcIdx === -1 || tgtIdx === -1) return;
    ids[srcIdx] = targetId;
    ids[tgtIdx] = srcId;
    onReorder(ids);
    setDragId(null);
    setOverId(null);
  }, [accounts, onReorder]);

  const handleDragEnd = useCallback(() => {
    dragRef.current = null;
    setDragId(null);
    setOverId(null);
  }, []);
  return (
    <div style={{
      minHeight: "100vh",
      background: "radial-gradient(circle at 70% 15%, rgba(123,47,247,0.12), transparent 55%), radial-gradient(circle at 20% 75%, rgba(0,210,255,0.08), transparent 50%), var(--bg-1)",
      padding: "40px",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
    }}>
      {/* Header */}
      <div style={{
        width: "100%", maxWidth: 1000,
        display: "flex", flexDirection: "column", gap: 6,
        marginBottom: 36,
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <Wordmark size={22} />
            <div style={{
              fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-5)",
              letterSpacing: "0.04em",
            }}>v1.0.0 · arc raiders companion</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {accounts.length > 0 && onGlobalSearch && (
              <button onClick={onGlobalSearch} className="av-icon-btn" title={t("home.globalSearch")}
                style={{ width: 36, height: 36 }}>
                <Icon name="search" size={17} />
              </button>
            )}
            {accounts.length > 0 && onSyncAll && (
              <button
                onClick={onSyncAll}
                disabled={bulkSyncing}
                style={{
                  display: "flex", alignItems: "center", gap: 7,
                  padding: "10px 16px",
                  background: bulkSyncing
                    ? "rgba(0,210,255,0.08)"
                    : "linear-gradient(135deg, rgba(0,210,255,0.12), rgba(123,47,247,0.08))",
                  border: `1px solid ${bulkSyncing ? "rgba(0,210,255,0.3)" : "rgba(0,210,255,0.15)"}`,
                  borderRadius: "var(--radius)",
                  color: bulkSyncing ? "#00d2ff" : "var(--fg-2)",
                  fontFamily: "var(--font-ui)", fontWeight: 600, fontSize: 13,
                  cursor: bulkSyncing ? "default" : "pointer",
                  transition: "all 180ms",
                  boxShadow: "0 2px 8px rgba(0,210,255,0.1)",
                }}
              >
                <Icon name="recycle" size={15} style={bulkSyncing ? { animation: "av-spin 1s linear infinite" } : undefined} />
                {bulkSyncing ? t("home.syncing") : t("home.syncAll")}
              </button>
            )}
            <button
              onClick={onAddAccount}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "10px 18px",
                background: "linear-gradient(135deg, #7b2ff7, #5a1fd0)",
                border: "1px solid rgba(123,47,247,0.4)",
                borderRadius: "var(--radius)",
                color: "#fff",
                fontFamily: "var(--font-ui)", fontWeight: 600, fontSize: 13.5,
                cursor: "pointer",
                transition: "all 180ms",
                boxShadow: "0 2px 12px rgba(123,47,247,0.25)",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 4px 20px rgba(123,47,247,0.4)";
                (e.currentTarget as HTMLButtonElement).style.transform = "translateY(-1px)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 2px 12px rgba(123,47,247,0.25)";
                (e.currentTarget as HTMLButtonElement).style.transform = "translateY(0)";
              }}
            >
              <Icon name="plus" size={16} />
              {t("home.addAccount")}
            </button>
            {isAdmin && onManageUsers && (
              <button onClick={onManageUsers} className="av-icon-btn" title={t("um.title")}>
                <Icon name="users" size={16} />
              </button>
            )}
            {onSettings && (
              <button onClick={onSettings} className="av-icon-btn" title={t("settings.title")}>
                <Icon name="settings" size={16} />
              </button>
            )}
            <button onClick={logout} className="av-icon-btn" title={`${user?.username} — ${t("nav.logout")}`}>
              <Icon name="log-out" size={16} />
            </button>
          </div>
        </div>

        {/* Stats bar + bulk actions */}
        <div style={{
          marginTop: 16,
          padding: "12px 18px",
          background: "var(--bg-2)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          display: "flex", alignItems: "center", gap: 28,
          fontFamily: "var(--font-mono)", fontSize: 12,
        }}>
          <span style={{ color: "var(--fg-4)" }}>
            {t("home.totalAccounts")}: <span style={{ color: "var(--fg-1)", fontWeight: 600 }}>{accounts.length}</span>
          </span>
          <span style={{ color: "var(--fg-4)" }}>
            {t("home.activeToken")}: <span style={{ color: "#4caf50", fontWeight: 600 }}>
              {accounts.filter(a => !a.is_token_expired).length}
            </span>
          </span>
          <span style={{ color: "var(--fg-4)" }}>
            {t("home.expired")}: <span style={{ color: accounts.some(a => a.is_token_expired) ? "#f44336" : "var(--fg-5)", fontWeight: 600 }}>
              {accounts.filter(a => a.is_token_expired).length}
            </span>
          </span>

          {accounts.length > 0 && onSyncAll && (
            <>
              <div style={{ flex: 1 }} />
              <div style={{ display: "flex", gap: 6 }}>
                <Button
                  variant="secondary"
                  icon={bulkSyncing ? "refresh-cw" : "recycle"}
                  iconSpin={bulkSyncing}
                  onClick={onSyncAll}
                >
                  {bulkSyncing ? t("home.syncing") : t("home.syncAll")}
                </Button>
              </div>
            </>
          )}
        </div>

        {bulkStatus && (
          <div style={{
            marginTop: 8,
            padding: "8px 14px",
            background: bulkStatus.includes("!") || bulkStatus.includes("tamam") || bulkStatus.includes("complete")
              ? "rgba(76,175,80,0.08)" : "rgba(123,47,247,0.08)",
            border: `1px solid ${bulkStatus.includes("!") || bulkStatus.includes("tamam") || bulkStatus.includes("complete")
              ? "rgba(76,175,80,0.25)" : "rgba(123,47,247,0.25)"}`,
            borderRadius: "var(--radius)",
            fontFamily: "var(--font-mono)", fontSize: 12,
            color: bulkStatus.includes("!") || bulkStatus.includes("tamam") || bulkStatus.includes("complete")
              ? "#4caf50" : "var(--fg-3)",
          }}>{bulkStatus}</div>
        )}
      </div>

      {/* Account Grid */}
      {loading ? (
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "center",
          gap: 16, marginTop: 80,
        }}>
          <div style={{
            width: 48, height: 48, borderRadius: "50%",
            background: "conic-gradient(from -90deg, #00d2ff 0deg, #7b2ff7 270deg, rgba(255,255,255,0.06) 270deg 360deg)",
            display: "flex", alignItems: "center", justifyContent: "center",
            animation: "av-spin 2.2s linear infinite",
          }}>
            <div style={{ width: 36, height: 36, borderRadius: "50%", background: "var(--bg-1)" }} />
          </div>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--fg-4)" }}>
            {t("home.loading")}
          </span>
        </div>
      ) : accounts.length === 0 ? (
        <div style={{
          marginTop: 60,
          display: "flex", flexDirection: "column", alignItems: "center", gap: 20,
          textAlign: "center",
        }}>
          <div style={{
            width: 80, height: 80, borderRadius: "50%",
            background: "linear-gradient(135deg, rgba(123,47,247,0.15), rgba(0,210,255,0.1))",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Icon name="user-plus" size={32} />
          </div>
          <div>
            <h2 style={{
              margin: 0, fontFamily: "var(--font-display)", fontWeight: 600,
              fontSize: 22, color: "var(--fg-1)",
            }}>{t("home.empty")}</h2>
            <p style={{
              margin: "8px 0 0", fontFamily: "var(--font-ui)", fontSize: 14,
              color: "var(--fg-4)", maxWidth: 400,
            }}>
              {t("home.emptyDesc")}
            </p>
          </div>
          <button
            onClick={onAddAccount}
            style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "12px 24px",
              background: "linear-gradient(135deg, #7b2ff7, #5a1fd0)",
              border: "none",
              borderRadius: "var(--radius)",
              color: "#fff",
              fontFamily: "var(--font-ui)", fontWeight: 600, fontSize: 14,
              cursor: "pointer",
            }}
          >
            <Icon name="plus" size={16} />
            {t("home.addFirst")}
          </button>
        </div>
      ) : (
        <div style={{
          width: "100%", maxWidth: 1000,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
          gap: 16,
        }}>
          {accounts.map((acc) => (
            <div
              key={acc.id}
              draggable
              onDragStart={(e) => handleDragStart(e, acc.id)}
              onDragOver={(e) => handleDragOver(e, acc.id)}
              onDrop={(e) => handleDrop(e, acc.id)}
              onDragEnd={handleDragEnd}
              style={{
                transition: "transform 200ms, opacity 200ms",
                opacity: dragId === acc.id ? 0.4 : 1,
                transform: overId === acc.id && dragId !== acc.id ? "scale(1.02)" : undefined,
                outline: overId === acc.id && dragId !== acc.id ? "2px solid rgba(123,47,247,0.4)" : undefined,
                outlineOffset: -2,
                borderRadius: "var(--radius-md)",
                cursor: "grab",
              }}
            >
              <AccountCard account={acc} onClick={() => onSelectAccount(acc.id)} onSync={onSyncAccount} status={cardStatuses?.[acc.id]} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
