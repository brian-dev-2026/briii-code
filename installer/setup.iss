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
; Compress in 4 parallel blocks in a 64-bit helper: ~2.5x faster (236 s -> 92 s) for ~1% larger
; output. Each thread needs ~0.7 GB of RAM with lzma2/max.
LZMAUseSeparateProcess=yes
LZMANumBlockThreads=4
WizardStyle=modern
ChangesEnvironment=yes
ChangesAssociations=yes
AppMutex={#AppMutex}
; A second setup (an update helper racing a manual install) aborts instead of overwriting files mid-copy.
SetupMutex={#AppMutex}-setup
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
; Clear the previous version's files so upgrades never mix old and new code. An /update=1 run
; (briii-update) leaves them alone: it stages the new files in {app}\_ and swaps them in at the end.
Type: filesandordirs; Name: "{app}\resources"; Check: not IsUpdate
Type: filesandordirs; Name: "{app}\locales"; Check: not IsUpdate
Type: filesandordirs; Name: "{app}\bin"; Check: not IsUpdate
Type: filesandordirs; Name: "{app}\policies"; Check: not IsUpdate
Type: filesandordirs; Name: "{app}\_"; Check: IsUpdate
Type: filesandordirs; Name: "{app}\_old"; Check: IsUpdate

[UninstallDelete]
; Downloaded updates (briii-update keeps them in %LOCALAPPDATA%\<AppName>\updates).
Type: filesandordirs; Name: "{localappdata}\{#AppName}\updates"

[Files]
Source: "{#SourceDir}\*"; DestDir: "{code:FilesDir}"; Flags: ignoreversion recursesubdirs createallsubdirs

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

#include "staged-update.iss"

var
  SwapFailed: Boolean;

function IsUpdate: Boolean;
begin
  Result := ExpandConstant('{param:update|0}') = '1';
end;

function FilesDir(Param: String): String;
begin
  if IsUpdate then Result := ExpandConstant('{app}\_') else Result := ExpandConstant('{app}');
end;

// The staged build's top-level files and folders, from build.ps1.
function TopLevelItems: TArrayOfString;
begin
  Result := SplitItems('{#TopLevelItems}');
end;

procedure RemoveItem(Path: String);
begin
  if DirExists(Path) then DelTree(Path, True, True, True) else DeleteFile(Path);
end;

procedure FinishStagedUpdate;
begin
  SwapFailed := not FinishStagedUpdateIn(ExpandConstant('{app}'), '{#AppMutex}', TopLevelItems, 30, 600);
  DelTree(ExpandConstant('{app}\_'), True, True, True);
end;
// Exit code 10: the staged update couldn't be swapped in; the installed version is unchanged.
function GetCustomSetupExitCode: Integer;
begin
  if SwapFailed then Result := 10 else Result := 0;
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then begin
    if IsUpdate then FinishStagedUpdate;
    if WizardIsTaskSelected('addtopath') then AddToPath(ExpandConstant('{app}\bin'));
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  Items: TArrayOfString;
  I: Integer;
begin
  if CurUninstallStep = usPostUninstall then begin
    RemoveFromPath(ExpandConstant('{app}\bin'));
    // Files an update swapped in are logged under <app>\_, so remove the app's items by name.
    Items := TopLevelItems;
    for I := 0 to GetArrayLength(Items) - 1 do
      if CompareText(Items[I], ExtractFileName(ExpandConstant('{uninstallexe}'))) <> 0 then
        RemoveItem(ExpandConstant('{app}\') + Items[I]);
    DelTree(ExpandConstant('{app}\_'), True, True, True);
    DelTree(ExpandConstant('{app}\_old'), True, True, True);
  end;
end;
