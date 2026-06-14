"use client";

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";

export type Lang = "tr" | "en";

const translations = {
  // ─── Sidebar ───
  "nav.dashboard": { tr: "Dashboard", en: "Dashboard" },
  "nav.inventory": { tr: "Envanter", en: "Inventory" },
  "nav.quests": { tr: "Questler", en: "Quests" },
  "nav.blueprints": { tr: "Blueprints", en: "Blueprints" },
  "nav.hideout": { tr: "Hideout", en: "Hideout" },
  "nav.projects": { tr: "Projeler", en: "Projects" },
  "nav.settings": { tr: "Ayarlar", en: "Settings" },
  "nav.allAccounts": { tr: "Tüm Hesaplar", en: "All Accounts" },
  "nav.logout": { tr: "Çıkış Yap", en: "Log Out" },

  // ─── Topbar ───
  "topbar.search": { tr: "Ara: item, quest, blueprint...", en: "Search: item, quest, blueprint..." },
  "topbar.syncing": { tr: "Senkronize Ediliyor...", en: "Syncing..." },
  "topbar.sync": { tr: "Senkronize Et", en: "Sync" },

  // ─── Home ───
  "home.addAccount": { tr: "Hesap Ekle", en: "Add Account" },
  "home.totalAccounts": { tr: "Toplam Hesap", en: "Total Accounts" },
  "home.activeToken": { tr: "Aktif Token", en: "Active Token" },
  "home.expired": { tr: "Expired", en: "Expired" },
  "home.loading": { tr: "Hesaplar yükleniyor...", en: "Loading accounts..." },
  "home.empty": { tr: "Henüz hesap eklenmedi", en: "No accounts yet" },
  "home.emptyDesc": {
    tr: "arctracker.io hesabınızı bağlayarak envanterinizi, questlerinizi ve blueprintlerinizi takip etmeye başlayın.",
    en: "Connect your arctracker.io account to start tracking your inventory, quests, and blueprints.",
  },
  "home.addFirst": { tr: "İlk Hesabı Ekle", en: "Add First Account" },
  "home.syncAll": { tr: "Tümünü Sync", en: "Sync All" },
  "home.syncing": { tr: "Senkronize Ediliyor...", en: "Syncing..." },
  "home.syncDone": { tr: "Senkronizasyon tamamlandı", en: "Sync complete" },
  "home.globalSearch": { tr: "Tüm Envanterde Ara", en: "Search All Inventories" },
  "home.searchPlaceholder": { tr: "Item ara... (tüm karakterler)", en: "Search items... (all characters)" },
  "home.searchLoading": { tr: "Envanterler yükleniyor...", en: "Loading inventories..." },
  "home.searchEmpty": { tr: "Arama sonucu bulunamadı", en: "No results found" },
  "home.searchHint": { tr: "Yukarıdan item adı yazarak tüm karakterlerde arayın", en: "Type an item name above to search across all characters" },

  // ─── Account Card ───
  "card.token": { tr: "Token", en: "Token" },
  "card.lastSync": { tr: "Son Sync", en: "Last Sync" },
  "card.totalValue": { tr: "Toplam Değer", en: "Total Value" },
  "card.sync": { tr: "Envanter Senkronize Et", en: "Sync Inventory" },
  "card.open": { tr: "Detaylar", en: "Details" },
  "card.statusSyncing": { tr: "Envanter senkronize ediliyor...", en: "Syncing inventory..." },

  // ─── Login ───
  "login.setup": { tr: "İlk Kurulum", en: "Initial Setup" },
  "login.setupDesc": { tr: "Admin hesabı oluşturun", en: "Create admin account" },
  "login.title": { tr: "Giriş Yap", en: "Log In" },
  "login.username": { tr: "Kullanıcı Adı", en: "Username" },
  "login.password": { tr: "Şifre", en: "Password" },
  "login.wait": { tr: "Lütfen bekleyin...", en: "Please wait..." },
  "login.createAdmin": { tr: "Admin Hesabı Oluştur", en: "Create Admin Account" },
  "login.submit": { tr: "Giriş Yap", en: "Log In" },
  "login.setupFailed": { tr: "Kurulum başarısız", en: "Setup failed" },
  "login.invalidCredentials": { tr: "Kullanıcı adı veya şifre hatalı", en: "Invalid username or password" },

  // ─── Add Account Modal ───
  "modal.addAccount": { tr: "Hesap Ekle", en: "Add Account" },
  "modal.credentials": { tr: "arctracker.io kimlik bilgileri", en: "arctracker.io credentials" },
  "modal.email": { tr: "Email", en: "Email" },
  "modal.password": { tr: "Şifre", en: "Password" },
  "modal.passwordPlaceholder": { tr: "arctracker.io şifresi", en: "arctracker.io password" },
  "modal.adding": { tr: "Ekleniyor...", en: "Adding..." },
  "modal.cancel": { tr: "İptal", en: "Cancel" },
  "modal.addFailed": { tr: "Hesap eklenemedi", en: "Failed to add account" },
  "modal.hint": {
    tr: "Her oyun hesabı için ayrı bir arctracker.io hesabı gerekir. Token güncellemesi Windows harvester üzerinden yapılır.",
    en: "Each game account needs a separate arctracker.io account. Token updates are handled by the Windows harvester.",
  },

  // ─── Dashboard ───
  "dash.welcome": { tr: "Hoş geldin, raider", en: "Welcome, raider" },
  "dash.tokenExpired": { tr: "Token Expired", en: "Token Expired" },
  "dash.tokenValid": { tr: "Token Valid", en: "Token Valid" },
  "dash.expires": { tr: "bitiş", en: "expires" },
  "dash.credits": { tr: "Credits", en: "Credits" },
  "dash.raiderTokens": { tr: "Raider Tokens", en: "Raider Tokens" },
  "dash.stash": { tr: "Stash", en: "Stash" },
  "dash.slots": { tr: "slot", en: "slots" },
  "dash.nearlyFull": { tr: "neredeyse dolu", en: "nearly full" },
  "dash.allSources": { tr: "tüm kaynaklar", en: "all sources" },
  "dash.weeklyCap": { tr: "haftalık limit 1000", en: "weekly cap 1000" },
  "dash.syncRunning": { tr: "Senkronizasyon çalışıyor", en: "Sync running" },
  "dash.synced": { tr: "Senkronize", en: "Synced" },
  "dash.recentItems": { tr: "Son Eklenenler", en: "Recent Items" },
  "dash.weapons": { tr: "Silahlar", en: "Weapons" },
  "dash.weaponTypes": { tr: "farklı silah", en: "weapon types" },
  "dash.noWeapons": { tr: "Envanterde silah yok", en: "No weapons in inventory" },
  "dash.openInventory": { tr: "Envanteri Aç", en: "Open Inventory" },
  "dash.activeQuests": { tr: "Aktif Questler", en: "Active Quests" },
  "dash.viewAll": { tr: "Hepsi", en: "View All" },
  "dash.noActiveQuests": { tr: "Aktif quest yok", en: "No active quests" },
  "dash.activeProjects": { tr: "Aktif Projeler", en: "Active Projects" },

  // ─── Page subtitles ───
  "sub.noSync": { tr: "henüz sync yapılmadı", en: "not synced yet" },
  "sub.completed": { tr: "tamamlandı", en: "completed" },
  "sub.traders": { tr: "trader", en: "traders" },
  "sub.learned": { tr: "öğrenilmiş", en: "learned" },
  "sub.remaining": { tr: "kalan", en: "remaining" },
  "sub.installed": { tr: "modül kurulu", en: "modules installed" },
  "sub.locked": { tr: "kilitli", en: "locked" },
  "sub.active": { tr: "aktif", en: "active" },

  // ─── Inventory ───
  "inv.search": { tr: "Item ara...", en: "Search items..." },
  "inv.sortName": { tr: "İsim", en: "Name" },
  "inv.sortRarity": { tr: "Nadirlik", en: "Rarity" },
  "inv.groupDur": { tr: "Durability grupla", en: "Group by durability" },
  "inv.reload": { tr: "Yenile", en: "Reload" },
  "inv.reloading": { tr: "Yenileniyor...", en: "Reloading..." },
  "inv.empty": { tr: "Henüz envanter verisi yok. Sync yapın.", en: "No inventory data yet. Run a sync." },
  "inv.noMatch": { tr: "Filtreye uyan item bulunamadı.", en: "No items match the filter." },

  // ─── Quests ───
  "quest.all": { tr: "Tümü", en: "All" },
  "quest.active": { tr: "aktif", en: "active" },
  "quest.completed": { tr: "tamamlandı", en: "completed" },
  "quest.fitScreen": { tr: "Sığdır", en: "Fit to screen" },

  // ─── Blueprints ───
  "bp.learned": { tr: "öğrenilmiş", en: "learned" },
  "bp.undiscovered": { tr: "keşfedilmedi", en: "undiscovered" },
  "bp.all": { tr: "Hepsi", en: "All" },
  "bp.learnedFilter": { tr: "Okunmuş", en: "Learned" },
  "bp.unlearnedFilter": { tr: "Okunmamış", en: "Unlearned" },
  "bp.empty": { tr: "Henüz blueprint verisi yok. Sync yapın.", en: "No blueprint data yet. Run a sync." },

  // ─── Hideout ───
  "hideout.title": { tr: "Hideout", en: "Hideout" },
  "hideout.modulesInstalled": { tr: "modül kurulu", en: "modules installed" },
  "hideout.locked": { tr: "kilitli", en: "locked" },
  "hideout.upgrading": { tr: "Yükseltiliyor", en: "Upgrading" },
  "hideout.notUnlocked": { tr: "Henüz açılmamış", en: "Not unlocked yet" },
  "hideout.empty": { tr: "Henüz hideout verisi yok. Sync yapın.", en: "No hideout data yet. Run a sync." },

  // ─── Projects ───
  "proj.activeProjects": { tr: "aktif proje", en: "active projects" },
  "proj.goals": { tr: "Hedefleri", en: "Goals" },
  "proj.completePhase": { tr: "Phase'i Tamamla", en: "Complete Phase" },
  "proj.detail": { tr: "Detay", en: "Details" },
  "proj.newProject": { tr: "Yeni Proje", en: "New Project" },
  "proj.empty": { tr: "Henüz proje verisi yok. Sync yapın.", en: "No project data yet. Run a sync." },

  // ─── Settings ───
  "set.embarkAccount": { tr: "Embark Hesabı", en: "Embark Account" },
  "set.connectedVia": { tr: "arctracker.io üzerinden bağlı", en: "connected via arctracker.io" },
  "set.displayName": { tr: "Görünen Ad", en: "Display Name" },
  "set.provider": { tr: "Platform", en: "Provider" },
  "set.linkedAt": { tr: "Bağlanma Tarihi", en: "Linked At" },
  "set.tokenExpires": { tr: "Token Bitiş", en: "Token Expires" },
  "set.tokenStatus": { tr: "Token Durumu", en: "Token Status" },
  "set.removing": { tr: "Kaldırılıyor...", en: "Removing..." },
  "set.removeAccount": { tr: "Hesabı Kaldır", en: "Remove Account" },
  "set.confirmDelete": { tr: "Bu hesabı kalıcı olarak kaldırmak istediğinize emin misiniz?", en: "Are you sure you want to permanently remove this account?" },
  "set.status": { tr: "Durum", en: "Status" },
  "set.registered": { tr: "Kayıtlı", en: "Registered" },
  "set.notRegistered": { tr: "Kayıtlı değil", en: "Not registered" },
  "set.saving": { tr: "Kaydediliyor...", en: "Saving..." },
  "set.saveFailed": { tr: "Kaydetme başarısız", en: "Save failed" },
  "set.syncTitle": { tr: "Sync", en: "Sync" },
  "set.syncBehavior": { tr: "davranış", en: "behavior" },
  "set.autoSync": { tr: "Otomatik sync (her 30 dk)", en: "Auto sync (every 30 min)" },
  "set.questNotify": { tr: "Yeni quest tamamlandığında bildir", en: "Notify on quest completion" },
  "set.tokenWarn": { tr: "Token süresi dolmadan 24h önce uyar", en: "Warn 24h before token expiry" },
  "set.telemetry": { tr: "Telemetri gönder", en: "Send telemetry" },
  "set.userManagement": { tr: "Kullanıcı Yönetimi", en: "User Management" },
  "set.addUser": { tr: "yeni kullanıcı ekle", en: "add new user" },
  "set.usernamePlaceholder": { tr: "Kullanıcı adı", en: "Username" },
  "set.passwordPlaceholder": { tr: "Şifre", en: "Password" },
  "set.creating": { tr: "Oluşturuluyor...", en: "Creating..." },
  "set.createUser": { tr: "Kullanıcı Oluştur", en: "Create User" },
  "set.createFailed": { tr: "Oluşturma başarısız", en: "Creation failed" },

  // ─── User Management ───
  "um.title": { tr: "Kullanıcı Yönetimi", en: "User Management" },
  "um.addUser": { tr: "Kullanıcı Ekle", en: "Add User" },
  "um.username": { tr: "Kullanıcı Adı", en: "Username" },
  "um.password": { tr: "Şifre", en: "Password" },
  "um.role": { tr: "Rol", en: "Role" },
  "um.actions": { tr: "İşlemler", en: "Actions" },
  "um.creating": { tr: "Oluşturuluyor...", en: "Creating..." },
  "um.create": { tr: "Oluştur", en: "Create" },
  "um.revokeToken": { tr: "Token İptal", en: "Revoke Token" },
  "um.revokeConfirm": { tr: "Bu kullanıcının tokenini iptal etmek istediğinize emin misiniz? Kullanıcı tekrar giriş yapmak zorunda kalacak.", en: "Are you sure you want to revoke this user's token? They will need to log in again." },
  "um.revoked": { tr: "Token iptal edildi", en: "Token revoked" },
  "um.deleteConfirm": { tr: "Bu kullanıcıyı kalıcı olarak silmek istediğinize emin misiniz?", en: "Are you sure you want to permanently delete this user?" },
  "um.deleted": { tr: "Kullanıcı silindi", en: "User deleted" },
  "um.you": { tr: "(sen)", en: "(you)" },
  "um.editUser": { tr: "Kullanıcı Düzenle", en: "Edit User" },
  "um.newPassword": { tr: "Yeni Şifre (değiştirmek için)", en: "New Password (to change)" },
  "um.save": { tr: "Kaydet", en: "Save" },
  "um.saving": { tr: "Kaydediliyor...", en: "Saving..." },
  "um.cancel": { tr: "İptal", en: "Cancel" },
  "um.noUsers": { tr: "Henüz kullanıcı yok", en: "No users yet" },

  // ─── Settings Modal ───
  "settings.title": { tr: "Ayarlar", en: "Settings" },
  "settings.general": { tr: "Genel", en: "General" },
  "settings.syncTab": { tr: "Senkronizasyon", en: "Sync" },
  "settings.pendingTokens": { tr: "Token Eşleştirme", en: "Token Matching" },
  "settings.pendingHint": {
    tr: "Harvester'ın bulduğu ama DB'de hesaba bağlayamadığı tokenları doğru hesaba eşleştirin. Bir kez eşleştikten sonra sonraki pushlar otomatik çalışır.",
    en: "Match harvester tokens that could not be linked to an account. Once matched, future pushes work automatically.",
  },
  "settings.pendingEmpty": { tr: "Eşleşmeyen token yok", en: "No unmatched tokens" },
  "settings.pendingAssigned": { tr: "Token hesaba bağlandı", en: "Token assigned to account" },
  "settings.pendingLoadFailed": { tr: "Token listesi yüklenemedi", en: "Failed to load pending tokens" },
  "settings.pendingAssignFailed": { tr: "Token bağlanamadı", en: "Failed to assign token" },
  "settings.selectAccount": { tr: "Hesap seç", en: "Select account" },
  "settings.assign": { tr: "Bağla", en: "Assign" },
  "settings.assigning": { tr: "Bağlanıyor...", en: "Assigning..." },
  "settings.language": { tr: "Dil", en: "Language" },
  "settings.version": { tr: "Versiyon", en: "Version" },

  // ─── Common ───
  "common.error": { tr: "Hata", en: "Error" },
  "common.close": { tr: "Kapat", en: "Close" },
  "common.loading": { tr: "ARC Vault yükleniyor...", en: "Loading ARC Vault..." },
  "common.loadingData": { tr: "Hesap verileri yükleniyor...", en: "Loading account data..." },
  "common.dataError": { tr: "Veri yükleme hatası", en: "Data load error" },
  "common.unknownError": { tr: "Bilinmeyen hata oluştu", en: "Unknown error occurred" },
  "common.apiDown": { tr: "API'ye bağlanılamıyor. Backend çalışıyor mu?", en: "Cannot connect to API. Is the backend running?" },

  // ─── Time ───
  "time.justNow": { tr: "az önce", en: "just now" },
  "time.minutesAgo": { tr: "dk önce", en: "min ago" },
  "time.hoursAgo": { tr: "sa önce", en: "hr ago" },
  "time.daysAgo": { tr: "gün önce", en: "d ago" },
} as const;

type TranslationKey = keyof typeof translations;

interface I18nContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: TranslationKey) => string;
}

const I18nContext = createContext<I18nContextValue>({
  lang: "tr",
  setLang: () => {},
  t: (key) => translations[key]?.tr ?? key,
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("tr");

  useEffect(() => {
    const saved = localStorage.getItem("arc_vault_lang");
    if (saved === "en" || saved === "tr") setLangState(saved);
  }, []);

  const setLang = useCallback((newLang: Lang) => {
    setLangState(newLang);
    localStorage.setItem("arc_vault_lang", newLang);
  }, []);

  const t = useCallback((key: TranslationKey): string => {
    return translations[key]?.[lang] ?? key;
  }, [lang]);

  return (
    <I18nContext.Provider value={{ lang, setLang, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useT() {
  return useContext(I18nContext).t;
}

export function useLang() {
  const { lang, setLang } = useContext(I18nContext);
  return { lang, setLang };
}
