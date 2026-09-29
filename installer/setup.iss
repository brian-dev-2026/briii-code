; Briii Code installer. Compiled by scripts/build.ps1, which generates brand.iss
; (AppName, AppVersion, AppId, ExeName, SourceDir, ...) next to the staged build.
#include BrandInclude

[Setup]
AppId={#AppId}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
; Per-user install (no admin prompt) by default; "Install for all users" is still offered.
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog commandline
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir={#OutputDir}
OutputBaseFilename={#OutputBaseFilename}
SetupIconFile={#IconFile}
UninstallDisplayIcon={app}\{#ExeName}.exe
UninstallDisplayName={#AppName}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ChangesEnvironment=yes
ChangesAssociations=yes
AppMutex={#AppMutex}
CloseApplications=yes
RestartApplications=no

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop shortcut"; GroupDescription: "Additional shortcuts:"; Flags: unchecked
Name: "contextfiles"; Description: "Add ""Open with {#AppName}"" to the context menu of &files"; GroupDescription: "Explorer integration:"
Name: "contextfolders"; Description: "Add ""Open with {#AppName}"" to the context menu of f&olders"; GroupDescription: "Explorer integration:"
Name: "openwith"; Description: "&Register {#AppName} as an editor for supported file types"; GroupDescription: "Explorer integration:"
Name: "addtopath"; Description: "Add ""{#AppCli}"" to &PATH (available after restarting terminals)"; GroupDescription: "Other:"

[InstallDelete]
; Clear the previous version's files so upgrades never mix old and new code.
Type: filesandordirs; Name: "{app}\resources"
Type: filesandordirs; Name: "{app}\locales"
Type: filesandordirs; Name: "{app}\bin"
Type: filesandordirs; Name: "{app}\policies"

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\{#ExeName}.exe"; AppUserModelID: "{#AppUserModelId}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#ExeName}.exe"; AppUserModelID: "{#AppUserModelId}"; Tasks: desktopicon

[Registry]
; URL protocol ({#UrlProtocol}://) - needed for sign-in callbacks from extensions.
Root: HKA; Subkey: "Software\Classes\{#UrlProtocol}"; ValueType: string; ValueName: ""; ValueData: "URL:{#UrlProtocol}"; Flags: uninsdeletekey; Check: RegisterShell
Root: HKA; Subkey: "Software\Classes\{#UrlProtocol}"; ValueType: string; ValueName: "URL Protocol"; ValueData: ""; Check: RegisterShell
Root: HKA; Subkey: "Software\Classes\{#UrlProtocol}\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: """{app}\{#ExeName}.exe"",0"; Check: RegisterShell
Root: HKA; Subkey: "Software\Classes\{#UrlProtocol}\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#ExeName}.exe"" --open-url -- ""%1"""; Check: RegisterShell

; Context menu: files
Root: HKA; Subkey: "Software\Classes\*\shell\{#RegName}"; ValueType: expandsz; ValueName: ""; ValueData: "Open w&ith {#AppName}"; Tasks: contextfiles; Flags: uninsdeletekey; Check: RegisterShell
Root: HKA; Subkey: "Software\Classes\*\shell\{#RegName}"; ValueType: expandsz; ValueName: "Icon"; ValueData: "{app}\{#ExeName}.exe"; Tasks: contextfiles; Check: RegisterShell
Root: HKA; Subkey: "Software\Classes\*\shell\{#RegName}\command"; ValueType: expandsz; ValueName: ""; ValueData: """{app}\{#ExeName}.exe"" ""%1"""; Tasks: contextfiles; Check: RegisterShell

; Context menu: folders and folder background
Root: HKA; Subkey: "Software\Classes\directory\shell\{#RegName}"; ValueType: expandsz; ValueName: ""; ValueData: "Open w&ith {#AppName}"; Tasks: contextfolders; Flags: uninsdeletekey; Check: RegisterShell
Root: HKA; Subkey: "Software\Classes\directory\shell\{#RegName}"; ValueType: expandsz; ValueName: "Icon"; ValueData: "{app}\{#ExeName}.exe"; Tasks: contextfolders; Check: RegisterShell
Root: HKA; Subkey: "Software\Classes\directory\shell\{#RegName}\command"; ValueType: expandsz; ValueName: ""; ValueData: """{app}\{#ExeName}.exe"" ""%V"""; Tasks: contextfolders; Check: RegisterShell
Root: HKA; Subkey: "Software\Classes\directory\background\shell\{#RegName}"; ValueType: expandsz; ValueName: ""; ValueData: "Open w&ith {#AppName}"; Tasks: contextfolders; Flags: uninsdeletekey; Check: RegisterShell
Root: HKA; Subkey: "Software\Classes\directory\background\shell\{#RegName}"; ValueType: expandsz; ValueName: "Icon"; ValueData: "{app}\{#ExeName}.exe"; Tasks: contextfolders; Check: RegisterShell
Root: HKA; Subkey: "Software\Classes\directory\background\shell\{#RegName}\command"; ValueType: expandsz; ValueName: ""; ValueData: """{app}\{#ExeName}.exe"" ""%V"""; Tasks: contextfolders; Check: RegisterShell

; "Open with" list for common source files
Root: HKA; Subkey: "Software\Classes\Applications\{#ExeName}.exe"; ValueType: string; ValueName: "FriendlyAppName"; ValueData: "{#AppName}"; Tasks: openwith; Flags: uninsdeletekey; Check: RegisterShell
Root: HKA; Subkey: "Software\Classes\Applications\{#ExeName}.exe\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\resources\app\resources\win32\default.ico"; Tasks: openwith; Check: RegisterShell
Root: HKA; Subkey: "Software\Classes\Applications\{#ExeName}.exe\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#ExeName}.exe"" ""%1"""; Tasks: openwith; Check: RegisterShell
#dim Exts[54] {"txt","md","json","jsonc","xml","yml","yaml","toml","ini","cfg","conf","log","csv","js","mjs","cjs","jsx","ts","tsx","vue","svelte","html","htm","css","scss","sass","less","py","rb","php","java","kt","go","rs","c","h","cpp","hpp","cc","cs","swift","dart","lua","sh","bash","ps1","psm1","bat","cmd","sql","graphql","env","gitignore","editorconfig"}
#define I
#sub AddExt
Root: HKA; Subkey: "Software\Classes\Applications\{#ExeName}.exe\SupportedTypes"; ValueType: string; ValueName: ".{#Exts[I]}"; ValueData: ""; Tasks: openwith; Check: RegisterShell
Root: HKA; Subkey: "Software\Classes\.{#Exts[I]}\OpenWithList\{#ExeName}.exe"; ValueType: string; ValueName: ""; ValueData: ""; Tasks: openwith; Flags: uninsdeletekey; Check: RegisterShell
#endsub
#for {I = 0; I < DimOf(Exts); I++} AddExt

[Run]
Filename: "{app}\{#ExeName}.exe"; Description: "Launch {#AppName}"; Flags: nowait postinstall skipifsilent

[Code]
const
  UserEnvKey = 'Environment';
  SystemEnvKey = 'SYSTEM\CurrentControlSet\Control\Session Manager\Environment';

{ /NOSHELL on the command line skips all Explorer/URL registration (used by verify.ps1). }
function RegisterShell: Boolean;
begin
  Result := ExpandConstant('{param:NOSHELL|0}') = '0';
end;

function EnvRoot: Integer;
begin
  if IsAdminInstallMode then Result := HKEY_LOCAL_MACHINE else Result := HKEY_CURRENT_USER;
end;

function EnvKey: String;
begin
  if IsAdminInstallMode then Result := SystemEnvKey else Result := UserEnvKey;
end;

procedure AddToPath(Dir: String);
var
  Path: String;
begin
  if not RegQueryStringValue(EnvRoot, EnvKey, 'Path', Path) then Path := '';
  if Pos(';' + Uppercase(Dir) + ';', ';' + Uppercase(Path) + ';') > 0 then exit;
  if (Path <> '') and (Path[Length(Path)] <> ';') then Path := Path + ';';
  RegWriteExpandStringValue(EnvRoot, EnvKey, 'Path', Path + Dir);
end;

procedure RemoveFromPath(Dir: String);
var
  Path: String;
begin
  if not RegQueryStringValue(EnvRoot, EnvKey, 'Path', Path) then exit;
  Path := ';' + Path + ';';
  if StringChangeEx(Path, ';' + Dir + ';', ';', True) = 0 then exit;
  while (Length(Path) > 0) and (Path[1] = ';') do Delete(Path, 1, 1);
  while (Length(Path) > 0) and (Path[Length(Path)] = ';') do Delete(Path, Length(Path), 1);
  RegWriteExpandStringValue(EnvRoot, EnvKey, 'Path', Path);
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if (CurStep = ssPostInstall) and WizardIsTaskSelected('addtopath') then
    AddToPath(ExpandConstant('{app}\bin'));
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usPostUninstall then
    RemoveFromPath(ExpandConstant('{app}\bin'));
end;
