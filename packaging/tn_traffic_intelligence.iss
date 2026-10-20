; Inno Setup script for TN Traffic Intelligence (Windows installer, route A).
; Compiled by packaging\build_package.ps1

#ifndef StageDir
  #define StageDir "..\dist-stage"
#endif
#ifndef AppVersion
  #define AppVersion "3.2.0"
#endif

[Setup]
AppId={{8C4A1B62-9E3D-4A57-B0F1-2D6B7C31E5AA}
AppName=TianNuo Traffic Intelligence
AppVersion={#AppVersion}
AppPublisher=TianNuo (田诺)
AppComments=智能流量分析与预测平台 - 真实数据、12 种预测算法、All Models 批处理与 held-out Test 评价
DefaultDirName={autopf}\TN Traffic Intelligence
DefaultGroupName=TN Traffic Intelligence
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=dist
OutputBaseFilename=TN-Traffic-Intelligence-Setup-{#AppVersion}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayName=TianNuo Traffic Intelligence
SetupIconFile=payload\tn.ico
LicenseFile=payload\LICENSE_NOTICES.txt
InfoBeforeFile=payload\BEFORE_INSTALL.txt
DisableWelcomePage=no
MinVersion=10.0

[Languages]
Name: "chinesesimplified"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "附加任务:"; Flags: checkedonce
Name: "prefetchmodels"; Description: "立即下载预训练大模型权重 (Chronos 约 35MB, TimesFM 约 800MB, 需要网络)"; GroupDescription: "可选组件:"; Flags: unchecked

[Files]
Source: "{#StageDir}\python\*"; DestDir: "{app}\python"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#StageDir}\app\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs; Excludes: "data\tn_traffic.db"

[Icons]
Name: "{group}\启动 TN Traffic Intelligence"; Filename: "{app}\launch_tn.bat"; WorkingDir: "{app}"; IconFilename: "{app}\python\python.exe"
Name: "{group}\停止服务"; Filename: "{app}\stop_tn.bat"; WorkingDir: "{app}"
Name: "{group}\用户指南 (README)"; Filename: "{app}\README.md"
Name: "{group}\卸载 TN Traffic Intelligence"; Filename: "{uninstallexe}"
Name: "{autodesktop}\TN Traffic Intelligence"; Filename: "{app}\launch_tn.bat"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\first_run.ps1"""; StatusMsg: "正在初始化数据库并导入六个原始数据文件..."; Flags: runhidden waituntilterminated
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\prefetch_models.ps1"""; StatusMsg: "正在下载 TimesFM / Chronos 预训练权重（约 850MB）..."; Flags: runhidden waituntilterminated; Tasks: prefetchmodels
Filename: "{app}\launch_tn.bat"; Description: "立即启动 TN Traffic Intelligence"; Flags: postinstall nowait skipifsilent

[UninstallRun]
Filename: "{app}\stop_tn.bat"; Flags: runhidden

[UninstallDelete]
Type: filesandordirs; Name: "{app}\python"
Type: filesandordirs; Name: "{app}\backend"
Type: filesandordirs; Name: "{app}\frontend"
Type: filesandordirs; Name: "{app}\scripts"
Type: filesandordirs; Name: "{app}\docs"
Type: filesandordirs; Name: "{app}\models_cache"
Type: filesandordirs; Name: "{app}\data\processed"
Type: filesandordirs; Name: "{app}\data\artifacts"
Type: filesandordirs; Name: "{app}\data\logs"
Type: files; Name: "{app}\data\tn_traffic.db*"
Type: files; Name: "{app}\data\raw\*"
Type: files; Name: "{app}\bootstrap_data.py"
