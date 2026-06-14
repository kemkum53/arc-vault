#define MyAppName "ARC Vault Harvester"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "ARC Vault"
#define MyAppExeName "ARC Vault Harvester.exe"
#define MyAppCliName "ARC Vault Harvester CLI.exe"

[Setup]
AppId={{8E6F5C28-8F04-4C42-AD7D-6ED9DB0A4C6C}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={localappdata}\Programs\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=installer
OutputBaseFilename=ARC-Vault-Harvester-Setup
Compression=lzma
SolidCompression=yes
WizardStyle=modern
UninstallDisplayIcon={app}\{#MyAppExeName}
SetupIconFile=arc_vault.ico
CloseApplications=yes

[Languages]
Name: "turkish"; MessagesFile: "compiler:Languages\Turkish.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked
Name: "startup"; Description: "Windows açıldığında ARC Vault Harvester'ı başlat"; GroupDescription: "Başlangıç seçenekleri:"; Flags: unchecked

[Files]
Source: "dist\{#MyAppExeName}"; DestDir: "{app}"; Flags: ignoreversion
Source: "dist\{#MyAppCliName}"; DestDir: "{app}"; Flags: ignoreversion
Source: "arc_vault.ico"; DestDir: "{app}"; Flags: ignoreversion
Source: "README.md"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\API Key Ayarla"; Filename: "{app}\{#MyAppCliName}"; Parameters: "configure --prompt-api-key --show-existing"
Name: "{group}\Durum - Diagnostic"; Filename: "{app}\{#MyAppCliName}"; Parameters: "status"
Name: "{group}\Ayar ve Log Klasörü"; Filename: "{localappdata}\ARC Vault Harvester"; Check: DirExists(ExpandConstant('{localappdata}\ARC Vault Harvester'))
Name: "{group}\Kaldır"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "{#MyAppName}"; ValueData: """{app}\{#MyAppExeName}"""; Tasks: startup

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{#MyAppName} uygulamasını başlat"; Flags: nowait postinstall skipifsilent unchecked
