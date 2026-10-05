import type {
  AccountResponse,
  SyncDataResponse,
  SyncResponse,
  ItemReference,
  QuestReference,
  HideoutReference,
  ModReference,
  WorkshopProgressResponse,
  ExpeditionProgressResponse,
  MatrixInventoryResponse,
  MatrixView,
} from "./types";

export function getApiBase(): string {
  if (typeof window === "undefined") return "http://api:8000";
  const envUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (envUrl !== undefined) return envUrl;
  const { protocol, hostname } = window.location;
  return `${protocol}//${hostname}:8000`;
}

const TOKEN_KEY = "arc_vault_token";
const REFRESH_KEY = "arc_vault_refresh_token";
const USER_KEY = "arc_vault_user";

function getAuthHeader(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const token = localStorage.getItem(TOKEN_KEY);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function forceLogout(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem(USER_KEY);
  window.dispatchEvent(new Event("arc_vault_logout"));
}

// Eşzamanlı 401'ler tek bir refresh çağrısını paylaşır; aksi halde rotasyon
// birbirini iptal eder ve reuse tespiti tetiklenir.
let refreshInFlight: Promise<boolean> | null = null;

async function refreshAccessToken(): Promise<boolean> {
  const refreshToken = localStorage.getItem(REFRESH_KEY);
  if (!refreshToken) return false;

  const res = await fetch(`${getApiBase()}/api/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  if (!res.ok) return false;

  const data = await res.json();
  localStorage.setItem(TOKEN_KEY, data.token);
  localStorage.setItem(REFRESH_KEY, data.refresh_token);
  if (data.user) localStorage.setItem(USER_KEY, JSON.stringify(data.user));
  window.dispatchEvent(new CustomEvent("arc_vault_refreshed", { detail: data }));
  return true;
}

function ensureRefresh(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = refreshAccessToken()
      .catch(() => false)
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

// Gateway / edge failures (Cloudflare 52x, proxy 502-504): the request never
// reached the API, so a read is safe to retry once after a short pause.
const GATEWAY_STATUSES = new Set([502, 503, 504, 520, 521, 522, 523, 524]);
const GATEWAY_RETRY_DELAY_MS = 1500;
const UNREACHABLE = "Sunucuya ulaşılamadı. Birkaç saniye sonra tekrar dene.";

async function fetchJSON<T>(path: string, init?: RequestInit, retry = true, gatewayRetry = true): Promise<T> {
  const isRead = (init?.method ?? "GET").toUpperCase() === "GET";
  const again = async () => {
    await new Promise(r => setTimeout(r, GATEWAY_RETRY_DELAY_MS));
    return fetchJSON<T>(path, init, retry, false);
  };
  let res: Response;
  try {
    res = await fetch(`${getApiBase()}${path}`, {
      ...init,
      // Never serve API reads from the browser cache: after a sync the data
      // endpoint must return the fresh DB state, not a cached snapshot.
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        ...getAuthHeader(),
        ...init?.headers,
      },
    });
  } catch {
    if (isRead && gatewayRetry) return again();
    throw new Error(UNREACHABLE);
  }
  if (res.status === 401 && typeof window !== "undefined") {
    if (retry && (await ensureRefresh())) {
      return fetchJSON<T>(path, init, false, gatewayRetry);
    }
    forceLogout();
    throw new Error("Session expired");
  }
  if (!res.ok) {
    if (GATEWAY_STATUSES.has(res.status) && isRead && gatewayRetry) return again();
    const text = await res.text().catch(() => "");
    // Edge error pages are HTML; show a short message instead of the markup.
    if (GATEWAY_STATUSES.has(res.status) || /^\s*</.test(text)) {
      throw new Error(`Sunucuya ulaşılamadı (HTTP ${res.status}). Birkaç saniye sonra tekrar dene.`);
    }
    throw new Error(`API ${res.status}: ${text}`);
  }
  return res.json();
}

// ─── Accounts ───

export async function getAccounts(): Promise<AccountResponse[]> {
  return fetchJSON("/api/accounts");
}

export async function getAccount(id: string): Promise<AccountResponse> {
  return fetchJSON(`/api/accounts/${id}`);
}

export async function createAccount(
  email: string,
  password: string,
): Promise<AccountResponse> {
  const body: Record<string, string> = { arctracker_email: email, arctracker_password: password };
  return fetchJSON("/api/accounts", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function updateAccount(
  id: string,
  data: { group_name?: string | null; xbox_email?: string; xbox_password?: string },
): Promise<AccountResponse> {
  return fetchJSON(`/api/accounts/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}

export async function deleteAccount(id: string): Promise<void> {
  await fetch(`${getApiBase()}/api/accounts/${id}`, { method: "DELETE", headers: getAuthHeader() });
}

export interface PendingTokenResponse {
  id: string;
  embark_user_id: string | null;
  sub: string | null;
  token_expires_at: string | null;
  source: string | null;
  status: string;
  seen_count: number;
  first_seen_at: string;
  last_seen_at: string;
  resolved_account_id: string | null;
  display_name: string | null;
  display_name_discriminator: string | null;
  gamertag: string | null;
}

export interface AccountOption {
  id: string;
  label: string;
  arctracker_email: string;
  display_name: string | null;
  display_name_discriminator: string | null;
  embark_user_id: string | null;
}

export async function getAccountOptions(): Promise<AccountOption[]> {
  return fetchJSON("/api/accounts/admin-options");
}

export async function getPendingTokens(): Promise<PendingTokenResponse[]> {
  return fetchJSON("/api/accounts/token-push/pending");
}

export async function assignPendingToken(pendingId: string, accountId: string) {
  return fetchJSON<{ ok: boolean; account_id: string; result: unknown }>(
    `/api/accounts/token-push/pending/${pendingId}/assign`,
    {
      method: "POST",
      body: JSON.stringify({ account_id: accountId }),
    },
  );
}

export async function deleteExpiredPendingTokens(): Promise<{ deleted: number }> {
  return fetchJSON("/api/accounts/token-push/pending/expired", { method: "DELETE" });
}

// ─── Sync ───

export async function triggerSync(accountId: string, force = false): Promise<SyncResponse> {
  return fetchJSON(`/api/accounts/${accountId}/sync`, {
    method: "POST",
    body: JSON.stringify({ force }),
  });
}

export async function getSyncedData(accountId: string): Promise<SyncDataResponse> {
  return fetchJSON(`/api/accounts/${accountId}/data`);
}

// ─── Reference Data ───

let _itemsCache: Record<string, ItemReference> | null = null;
let _questsCache: Record<string, QuestReference> | null = null;
let _hideoutCache: Record<string, HideoutReference> | null = null;
let _modsCache: Record<string, ModReference> | null = null;

export async function getItemsReference(): Promise<Record<string, ItemReference>> {
  if (_itemsCache) return _itemsCache;
  _itemsCache = await fetchJSON("/api/reference/items");
  return _itemsCache!;
}

export async function getQuestsReference(): Promise<Record<string, QuestReference>> {
  if (_questsCache) return _questsCache;
  _questsCache = await fetchJSON("/api/reference/quests");
  return _questsCache!;
}

export async function getHideoutReference(): Promise<Record<string, HideoutReference>> {
  if (_hideoutCache) return _hideoutCache;
  _hideoutCache = await fetchJSON("/api/reference/hideout");
  return _hideoutCache!;
}

export async function getModsReference(): Promise<Record<string, ModReference>> {
  if (_modsCache) return _modsCache;
  _modsCache = await fetchJSON("/api/reference/mods");
  return _modsCache!;
}

// ─── Auth / User Management ───

export interface UserResponse {
  id: string;
  username: string;
  role: string;
  created_at: string;
}

export async function getUsers(): Promise<UserResponse[]> {
  return fetchJSON("/api/auth/users");
}

export async function createUser(username: string, password: string, role: string = "user") {
  return fetchJSON<{ id: string; username: string; role: string }>("/api/auth/users", {
    method: "POST",
    body: JSON.stringify({ username, password, role }),
  });
}

export async function updateUser(userId: string, data: { username?: string; password?: string; role?: string }) {
  return fetchJSON<{ id: string; username: string; role: string }>(`/api/auth/users/${userId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function deleteUser(userId: string): Promise<void> {
  await fetch(`${getApiBase()}/api/auth/users/${userId}`, { method: "DELETE", headers: getAuthHeader() });
}

export async function revokeUserToken(userId: string) {
  return fetchJSON<{ status: string; username: string }>(`/api/auth/users/${userId}/revoke-token`, {
    method: "POST",
  });
}

// ─── Workshop ───

export async function getWorkshopProgress(): Promise<WorkshopProgressResponse> {
  return fetchJSON("/api/workshop/progress");
}

// ─── Expedition ───

export async function getExpeditionProgress(): Promise<ExpeditionProgressResponse> {
  return fetchJSON("/api/expedition/progress");
}

export async function getSupplySelection(): Promise<{ included: string[] }> {
  return fetchJSON("/api/expedition/supply-selection");
}

export async function putSupplySelection(included: string[]): Promise<void> {
  await fetchJSON("/api/expedition/supply-selection", {
    method: "PUT",
    body: JSON.stringify({ included }),
  });
}

// ─── Matrix ───

export async function getMatrixInventory(itemIds: string[]): Promise<MatrixInventoryResponse> {
  const q = encodeURIComponent(itemIds.join(","));
  return fetchJSON(`/api/matrix/inventory?items=${q}`);
}

export async function getMatrixViews(): Promise<{ views: MatrixView[] | null }> {
  return fetchJSON("/api/matrix/views");
}

export async function putMatrixViews(views: MatrixView[]): Promise<void> {
  await fetchJSON("/api/matrix/views", {
    method: "PUT",
    body: JSON.stringify({ views }),
  });
}

// ─── Health ───

export async function checkHealth(): Promise<boolean> {
  try {
    await fetchJSON("/health");
    return true;
  } catch {
    return false;
  }
}
