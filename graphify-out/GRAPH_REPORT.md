# Graph Report - .  (2026-05-11)

## Corpus Check
- Large corpus: 679 files · ~1,066,099 words. Semantic extraction will be expensive (many Claude tokens). Consider running on a subfolder, or use --no-semantic to run AST-only.

## Summary
- 1896 nodes · 2680 edges · 192 communities detected
- Extraction: 95% EXTRACTED · 5% INFERRED · 0% AMBIGUOUS · INFERRED: 131 edges (avg confidence: 0.81)
- Token cost: 0 input · 0 output

## God Nodes (most connected - your core abstractions)
1. `imRequest()` - 125 edges
2. `WebSocketClient` - 28 edges
3. `getCache()` - 21 edges
4. `w()` - 20 edges
5. `VideoMessageStrategyImpl` - 13 edges
6. `WebSocketWebClient` - 13 edges
7. `AudioManager` - 12 edges
8. `get_websocket_client_container()` - 12 edges
9. `HuLa Development Workflow Skill (Claude Code)` - 12 edges
10. `ImageMessageStrategyImpl` - 11 edges

## Surprising Connections (you probably didn't know these)
- `Secondary Panel View (Settings or File Manager)` --conceptually_related_to--> `File Manager Component`  [AMBIGUOUS]
  preview/img2-3.webp → src/views/fileManagerWindow/index.vue
- `Integrated Browser / Web Article Viewer` --conceptually_related_to--> `Preview File / Web View Component`  [AMBIGUOUS]
  preview/img2-6.webp → src/views/previewFileWindow/index.vue
- `Mobile Login / QR Code Screen` --conceptually_related_to--> `Mobile Login Component`  [AMBIGUOUS]
  preview/img2-4.webp → src/mobile/login.vue
- `Mobile Login / QR Code Screen` --conceptually_related_to--> `QR Code Display / Card`  [AMBIGUOUS]
  preview/img2-4.webp → src/views/loginWindow/QRCode.vue
- `Chat Conversation View with Messages` --visually_contains--> `HuLa Desktop Application Shell`  [INFERRED]
  preview/img2-1.webp → src/layout/index.vue

## Communities

### Community 0 - "Aiclaw Utilities & Pinia Stores"
Cohesion: 0.02
Nodes (53): ensureAppStateReady(), waitForReadyEvent(), getAllTypeEmojis(), splitEmoji(), AppException, getWasmMd5(), md5FromString(), sendMessageViaHttp() (+45 more)

### Community 1 - "Frontend Hooks & API Requests"
Cohesion: 0.03
Nodes (127): addAdmin(), addEmoji(), apiKeyBalance(), apiKeyCreate(), apiKeyDelete(), apiKeyPage(), apiKeySimpleList(), apiKeyUpdate() (+119 more)

### Community 2 - "Audio Processing Pipeline"
Cohesion: 0.02
Nodes (24): compressAudioToMp3(), convertToInt16Array(), encodeToMp3(), mixToMono(), resampleAudio(), processClipboardImage(), rgbaToFile(), AudioCallMessageStrategyImpl (+16 more)

### Community 3 - "Aiclaw Architecture & Design Docs"
Cohesion: 0.03
Nodes (99): ADR-20260309 开发测试发布流程与分支策略, aichat-plugins 通讯插件, Aiclaw AI助理, 好友申请转发机制 (target_id→owner), Aiclaw Friend Application Forwarding (target_id→aiclaw_uid, business layer→owner), Aiclaw HTTP API集 (create/list/profile/reset-token/deactivate/restore/auth-confirm), 移除好友级联操作 (7步), Aiclaw Stream Processing (streamStart/Delta/End, SSE relay, rAF throttling) (+91 more)

### Community 4 - "Draco 3D Decoder JS"
Cohesion: 0.04
Nodes (53): abort(), addOnPostRun(), addOnPreRun(), addRunDependency(), assert(), AttributeOctahedronTransform(), AttributeQuantizationTransform(), AttributeTransformData() (+45 more)

### Community 5 - "Rust WebSocket & API Layer"
Cohesion: 0.04
Nodes (41): AckMessage, ApiResult, CursorPageParam, CursorPageResp, LoginParam, LoginResp, Page, PageParam (+33 more)

### Community 6 - "Aiclaw ADR Decisions"
Cohesion: 0.04
Nodes (70): D1: im_aiclaw扩展表 + user_type=4, D11: 首期支持移动端+Web端/桌面端, D12: msgId由server端StreamProcessor生成, D13: 流式断流兜底 (30s超时+异常恢复), D15: 双token模型+CLI一键激活, D2: UUID+bcrypt Token方案独立于OAuth, D3: plugins复用现有WS通道作为aiclaw设备接入, D4: 复用现有PushService推送链路,不引入额外MQ (+62 more)

### Community 7 - "Contact Management Commands"
Cohesion: 0.03
Nodes (30): fetch_and_update_contacts(), HideContactRequest, list_contacts_command(), Model, Relation, get_config_by_key(), save_or_update_config(), Model (+22 more)

### Community 8 - "App Events & Badge Management"
Cohesion: 0.04
Nodes (40): request_authorization(), request_ios_badge_authorization(), set_badge(), set_badge_count(), set_ios_badge(), BackendSettings, DatabaseSettings, Environment (+32 more)

### Community 9 - "AI Features & Project Config"
Cohesion: 0.03
Nodes (62): AGENTS.md: HuLa Project Context for AI Agents, AI Stop Reply Feature (v3.0.8), Deep Thinking AI Model (v3.0.6), AI Message Reply via SSE (v3.0.3), Theme Preference Persistence on Restart (v3.0.9), CSS Variable Strategy (per-element UnoCSS, promote semantic tokens to variable.scss), Git Submodule Management Workflow, Import Aliases (@/ -> src/, ~/ -> repo root) (+54 more)

### Community 10 - "File & Attachment Management"
Cohesion: 0.06
Nodes (17): normalizeSavePath(), saveAttachmentAs(), saveFileAttachmentAs(), saveVideoAttachmentAs(), AvatarUtils, checkFileType(), fixFileMimeType(), getAudioMimeType() (+9 more)

### Community 11 - "Chat History Query Commands"
Cohesion: 0.09
Nodes (30): ChatHistoryQueryCondition, ChatHistoryQueryParam, ChatHistoryResponse, DateRange, PaginationParam, parse_message_type(), parse_sort_order(), query_chat_history() (+22 more)

### Community 12 - "FFI Bindings & Time Formatting"
Cohesion: 0.08
Nodes (10): isDiffNow(), isDiffNow10Min(), findLocales(), getLangPrefix(), loadLanguage(), mapByPrefix(), normalizeLang(), resolveAutoLanguage() (+2 more)

### Community 13 - "Desktop Window & Audio Utils"
Cohesion: 0.15
Nodes (27): apply_macos_traffic_lights_spacing_default(), apply_traffic_lights_spacing(), audio(), ensure_live_resize_traffic_lights_task(), ensure_traffic_lights_resize_observer(), get_desired_traffic_lights_spacing(), get_nswindow_from_webview_window(), get_text_scale_from_registry() (+19 more)

### Community 14 - "Backend Command Architecture"
Cohesion: 0.08
Nodes (30): Backend Command Locations: command/ (Shared), desktops/ (Desktop), mobiles/ (Mobile), Command Registration: #[tauri::command], mod.rs Export, generate_handler! in lib.rs, SeaORM: Entities in entity/, Migrations in migration/, Shared State: tauri::State<'_, AppData>, Async for IO/DB, Build/Release Commands: pnpm install, tauri:dev, tauri:build, check, test:run, commit, Secrets Policy: .env.local for Tokens, Never Commit Secrets, Backend Checklist: #[tauri::command], lib.rs Registration, SeaORM, Build/Release Checklist: pnpm Scripts, No .rules Changes (+22 more)

### Community 15 - "File Manager Command Handlers"
Cohesion: 0.1
Nodes (23): convert_message_to_file_info(), extract_file_size(), extract_user_list(), FileInfo, FileQueryParam, FileQueryResponse, format_display_date(), format_timestamp() (+15 more)

### Community 16 - "WebSocket Client (Rust)"
Cohesion: 0.15
Nodes (1): WebSocketClient

### Community 17 - "WebSocket Protocol Commands"
Cohesion: 0.13
Nodes (21): get_websocket_client_container(), InitWsParams, SendMessageParams, SuccessResponse, UpdateConfigParams, ws_disconnect(), ws_force_reconnect(), ws_get_app_background_state() (+13 more)

### Community 18 - "Draco Wasm Wrapper"
Cohesion: 0.17
Nodes (24): A(), B(), C(), D(), E(), f(), G(), H() (+16 more)

### Community 19 - "UI Components & Design Tokens"
Cohesion: 0.22
Nodes (22): User Avatar Display System, Chat History / Conversation List Component, Dark Theme Design System, HuLa Desktop Application Shell, Empty State / Placeholder Content Area, File Manager Component, Chat Conversation View with Messages, Conversation List / Chat History View (+14 more)

### Community 20 - "App State & Init Config"
Cohesion: 0.23
Nodes (22): HuLa Desktop IM Application, Blue-Tinted Header Bars, Dark Theme as Default UI, Dual-Pane Sidebar+Content Layout, Landscape Desktop Layout, Rounded Card UI Style, Chat Messaging Feature, Contacts and Friends Management (+14 more)

### Community 21 - "Screenshot & System Commands"
Cohesion: 0.22
Nodes (10): bd09ToGcj02(), bd09ToWgs84(), gcj02ToBd09(), gcj02ToWgs84(), isInChina(), transformCoordinate(), transformLat(), transformLng() (+2 more)

### Community 22 - "Tauri Plugin Core"
Cohesion: 0.18
Nodes (7): MessageProcessor, ProcessResult, test_message_sanitization(), test_message_validation(), ValidationResult, firstLine(), renderReplyContent()

### Community 23 - "Mobile Init & Keyboard"
Cohesion: 0.16
Nodes (5): getAllRoutes(), getCommonRoutes(), getDesktopRoutes(), getMobileRoutes(), UnifiedTriggerStrategy

### Community 24 - "iOS Build Support"
Cohesion: 0.13
Nodes (2): ListenerController, RustWebSocketClient

### Community 25 - "Image Processing Utils"
Cohesion: 0.19
Nodes (1): AudioManager

### Community 26 - "User Status & Online State"
Cohesion: 0.22
Nodes (1): WebSocketWebClient

### Community 27 - "Room Member Repository"
Cohesion: 0.31
Nodes (10): checkUserAuthentication(), clearListener(), clearQueue(), initListener(), initWorker(), readCountQueue(), startTimer(), stopTimer() (+2 more)

### Community 28 - "Message Repository"
Cohesion: 0.19
Nodes (8): create_observer(), initialize_keyboard_adjustment(), KeyboardDelegateHolder, KeyboardHandlingMode, KeyboardLockDelegate, KeyboardLockDelegateState, KeyboardScrollPreventDelegateState, should_adjust()

### Community 29 - "Configuration & Timeout"
Cohesion: 0.33
Nodes (13): Dark Theme Desktop Design System, Desktop Conversation View (Dark Mode), Desktop Message Detail View (Dark Mode), Desktop Contact/Friend Panel (Dark Mode), Desktop Chat Content View (Dark Mode), Desktop Wide Settings/Profile View (Dark Mode), Desktop Extended Contacts View (Dark Mode), Desktop Chat List Interface (Dark Mode) (+5 more)

### Community 30 - "AI Platform Commands"
Cohesion: 0.31
Nodes (13): Bottom Tab Navigation Bar, Chat Bubble Design Pattern, Dark Mode UI Element, HuLa Mobile UI Layout, Chat Conversation Screen with Bubbles, Chat Screen with Sidebar Contact Panel, Rich Media Chat with Images and Colored Bubbles, Dark Modal Overlay or Dark Mode Card UI (+5 more)

### Community 31 - "Frontend Hooks & Network"
Cohesion: 0.23
Nodes (3): initializePlatform(), isInTauriEnv(), PlatformDetector

### Community 32 - "File Upload Queue & Download"
Cohesion: 0.26
Nodes (11): build_qiniu_key(), hex_lower(), qiniu_resumable_upload(), qiniu_upload_resumable(), QiniuKeyOptions, QiniuMkblkResponse, QiniuMkfileResponse, resolve_upload_path() (+3 more)

### Community 33 - "Message Send Strategy"
Cohesion: 0.2
Nodes (7): Decodable, ExamplePlugin, initPlugin(), PingArgs, Plugin, ExamplePluginTests, XCTestCase

### Community 34 - "Preview Screenshot Images"
Cohesion: 0.38
Nodes (9): executeBuild(), getBundleOptions(), getCurrentPlatform(), getDebugOptions(), getPlatformOptions(), main(), selectBundle(), selectDebugMode() (+1 more)

### Community 35 - "Web Login & OAuth Commands"
Cohesion: 0.24
Nodes (1): UnreadCountManager

### Community 36 - "Message Mark Commands"
Cohesion: 0.2
Nodes (10): Multi-ABI Android Build (arm64/armeabi/x86/x86_64), iOS Crash and Auto-Login Fix (v3.0.9), Android Multi-ABI Rationale: Maximize coverage and compatibility, Android UI Debug via Chrome inspect, Android Multi-ABI Build Strategy, Android SDK Tools (build-tools/emulator/ndk/platform-tools), Android Manual Environment Setup Guide, Android Wireless Debug (ADB over TCP/IP) (+2 more)

### Community 37 - "Android Build & Gradle Config"
Cohesion: 0.36
Nodes (6): checkDependency(), checkWindowsDependency(), compareVersions(), getFriendlyErrorMessage(), main(), satisfiesVersionRange()

### Community 38 - "Emoticon & Emoji Management"
Cohesion: 0.39
Nodes (8): convert_hbitmap_to_image_data(), generate_thumbnail_linux(), generate_thumbnail_macos(), generate_thumbnail_windows(), generate_video_thumbnail(), get_video_duration_macos(), get_video_thumbnail(), VideoThumbnailInfo

### Community 39 - "Draco Decoder Binding"
Cohesion: 0.46
Nodes (7): createConsolePromptContext(), ensureLink(), getTargetLinkStatus(), isChineseLocale(), isSkillLinked(), linkSkillsToTarget(), main()

### Community 40 - "iOS Plugin & Swift Bridge"
Cohesion: 0.43
Nodes (7): buildQiniuThumbnailUrl(), canUseDataUrl(), detectPreferredFormat(), extractHostname(), getPreferredQiniuFormat(), getQiniuHostKeywords(), isQiniuHost()

### Community 41 - "User Repository & VO Layer"
Cohesion: 0.25
Nodes (1): MainActivity

### Community 42 - "Tauri Command Enums & Types"
Cohesion: 0.43
Nodes (8): HuLa App QR Code for Distribution, HuLa Light Theme Three-Panel Contacts Page, HuLa Light Theme Sidebar Detail Page, HuLa Dark Theme Chat Interface, QQ Mobile IM Reference Screenshot, WeChat Mobile IM Reference Screenshot, Alipay Mobile Reference Screenshot, Third-Party App Reference with Gold Bottom Bar

### Community 43 - "WebSocket Service Adapter"
Cohesion: 0.25
Nodes (8): Minio Storage Integration (v3.0.6), Qiniu Chunked Upload Rationale: Resumable, better success rate, network optimization, Qiniu Chunked/Resumable Upload, MessageStrategy Integration for Upload, Qiniu Multi-Region Support (East/North/South/NA/SEA), UploadProviderEnum (DEFAULT/QINIU), Qiniu Cloud Upload Integration Guide, Qiniu Cloud File Upload

### Community 44 - "Directives & Layout Models"
Cohesion: 0.38
Nodes (7): Conventional Commits (feat/fix/refactor/docs/chore), dev Branch (Test Integration Baseline), feature/* Branches (Feature Development), hotfix/* Branches (Emergency Production Fixes), master Branch (Production Stable), Merge Strategy: feature→dev→QA→master, Branch Protection: No Direct Push, PR + Review + CI Required

### Community 45 - "Security & Privacy Docs"
Cohesion: 0.29
Nodes (7): Biome Linter/Formatter, Commitizen Conventional Commits, Vitest Testing Framework, Conventional Commits via pnpm commit, Pre-commit Lint via lint:staged, Conventional Commits Specification (feat/fix/docs/style/refactor/perf/test/chore), Recommended VSCode Plugins (Volar/Rust-Analyzer/Tauri/Biome)

### Community 46 - "WebVitals & Performance"
Cohesion: 0.29
Nodes (7): Release CI Production Config Injection, GitHub Actions release.yml Workflow, production.yaml Generation in CI, CI Secrets (YOUDAO/TENCENT API Keys), Tencent Map Key Configuration, Tencent Translation Service Integration, Youdao Translation Service Integration

### Community 47 - "Frontend File & Upload Utils"
Cohesion: 0.33
Nodes (1): RequestQueue

### Community 48 - "Router & Navigation"
Cohesion: 0.47
Nodes (1): SqlDebug

### Community 49 - "Message Utils & Reply"
Cohesion: 0.6
Nodes (5): apply_runtime_guards(), debugger_attached(), enforce_debugger_policy(), sanitize_sensitive_env(), set_dumpable()

### Community 50 - "Canvas & ImageViewer"
Cohesion: 0.6
Nodes (5): find_repo_root(), list_stores(), list_views(), main(), print_paths()

### Community 51 - "Trigger Strategy & Enums"
Cohesion: 0.6
Nodes (5): find_repo_root(), main(), print_hits(), scan_invoke_usage(), scan_rust_commands()

### Community 52 - "Tauri Plugin PB & Build Config"
Cohesion: 0.5
Nodes (2): normalizeExternalUrl(), openExternalUrl()

### Community 53 - "Desktop Init & Tray"
Cohesion: 0.6
Nodes (1): FileUtil

### Community 54 - "Frontend Stores (Chat/WS/File)"
Cohesion: 0.6
Nodes (4): build_log_plugin(), CustomInit, DesktopCustomInit, init_common_plugins()

### Community 55 - "Video & Audio File Viewers"
Cohesion: 0.4
Nodes (2): AiMessageRequest, SseStreamEvent

### Community 56 - "Geolocation & Map Services"
Cohesion: 0.7
Nodes (4): apply_runtime_guards(), enforce_debugger_policy(), prevent_debugger_attach(), sanitize_sensitive_env()

### Community 57 - "Vue Components UI"
Cohesion: 0.7
Nodes (4): apply_runtime_guards(), debugger_attached(), enforce_debugger_policy(), sanitize_sensitive_env()

### Community 58 - "Web Worker Scripts"
Cohesion: 0.4
Nodes (4): ChatMessageReq, LoginReq, LoginResp, MyRoomInfoReq

### Community 59 - "Platform Constants & Paths"
Cohesion: 0.4
Nodes (5): Architecture Decision Records (ADR) Adoption, hula-docs Centralized Documentation, hula-server-dev Development Container (JDK21 + Maven), R-001: Incomplete Environment Blocks Backend Build (Closed 2026-03-14), R-002: Scattered Multi-Repo Collaboration Information

### Community 60 - "Login History & Announcement"
Cohesion: 0.5
Nodes (0): 

### Community 61 - "Fingerprint & Image Viewers"
Cohesion: 0.5
Nodes (0): 

### Community 62 - "i18n & Translate Services"
Cohesion: 0.5
Nodes (0): 

### Community 63 - "Frontend Stores (Config/Guide)"
Cohesion: 0.5
Nodes (0): 

### Community 64 - "Channel Setting & Plugin Stores"
Cohesion: 0.5
Nodes (0): 

### Community 65 - "WebSocket Web & Rust Adapter"
Cohesion: 0.83
Nodes (3): detectBrowserFeatures(), djb2Hash(), generateFingerprint()

### Community 66 - "Aiclaw Conversation UI"
Cohesion: 0.67
Nodes (2): isBelowViewport(), mounted()

### Community 67 - "Group & Contacts Stores"
Cohesion: 0.83
Nodes (3): get_readme_html(), parse_markdown(), process_image_url()

### Community 68 - "Frontend Stores (Mobile/Global)"
Cohesion: 0.5
Nodes (1): OauthServerState

### Community 69 - "Mobile UI Components"
Cohesion: 0.5
Nodes (1): tauri::Builder<R>

### Community 70 - "Chat Message Input Hooks"
Cohesion: 0.5
Nodes (1): BuildTask

### Community 71 - "Online Status & Auto Scroll"
Cohesion: 0.5
Nodes (2): Config, RustPlugin

### Community 72 - "Session Unread Management"
Cohesion: 0.5
Nodes (1): SplashScreen

### Community 73 - "Rust Migration Scripts"
Cohesion: 0.5
Nodes (4): tauri-plugin-hula Custom Plugin, Project Disclaimer (AS-IS, No Warranty), hula Plugin Permissions (allow-ping/deny-ping), Tauri Plugin hula (Custom Local Plugin)

### Community 74 - "Desktop Directory Scanner"
Cohesion: 1.0
Nodes (2): main(), runScript()

### Community 75 - "AI Command & Markdown Render"
Cohesion: 0.67
Nodes (0): 

### Community 76 - "Upload & Video Thumbnail"
Cohesion: 0.67
Nodes (0): 

### Community 77 - "Room & Config Entity"
Cohesion: 1.0
Nodes (2): ensure_frontend_dist(), main()

### Community 78 - "Environment Setup & CI Docs"
Cohesion: 0.67
Nodes (1): ExampleUnitTest

### Community 79 - "Plugin Robot & Chat Settings"
Cohesion: 0.67
Nodes (1): Example

### Community 80 - "Timers & Fixed Scale"
Cohesion: 0.67
Nodes (1): ExampleInstrumentedTest

### Community 81 - "Android Splash & Tray Assets"
Cohesion: 0.67
Nodes (1): TimeoutConfig

### Community 82 - "macOS Runtime Guard"
Cohesion: 0.67
Nodes (1): FileMeta

### Community 83 - "iOS Badge Bridge"
Cohesion: 0.67
Nodes (0): 

### Community 84 - "Linux Runtime Guard"
Cohesion: 0.67
Nodes (2): _NoInputAccessoryView, -inputAccessoryView

### Community 85 - "Store Index & Plugin Registry"
Cohesion: 0.67
Nodes (3): D10: 离线消息由plugins主动拉取REST API+防抖合并, D14: 统一防抖+堆积,不做严格串行, 防抖机制 (2s缓冲/5条上限/10s最大等待)

### Community 86 - "Rust Common & Error Types"
Cohesion: 0.67
Nodes (3): CI Gating: Compile, Unit Tests, Key Checks, Traceable Image Tag Convention (dev-<shortsha>), Test Submission Requirements (Summary, Scope, Test Points, Rollback)

### Community 87 - "Win Runtime Guard"
Cohesion: 0.67
Nodes (3): GiteCode Login (v3.0.9), Gitee and GitHub OAuth Login (v3.0.8), User Authentication System (Password/QR/Multi-device)

### Community 88 - "Contact & User Entity Models"
Cohesion: 0.67
Nodes (3): WeChat Moments / Dynamic Posts (v3.0.3), Message Communication Features, Social Management Features

### Community 89 - "Message & Member Entity Models"
Cohesion: 0.67
Nodes (3): Mobile i18n Support (v3.0.8), i18n Internationalization Progress (98%), vue-i18n Internationalization

### Community 90 - "Member & Contact Repository"
Cohesion: 0.67
Nodes (3): Contributor Covenant Code of Conduct v2.0, Code of Conduct Enforcement (Correction/Warning/TempBan/PermanentBan), FOSSA License Compliance

### Community 91 - "User Config & Preferences"
Cohesion: 1.0
Nodes (1): ColorThief

### Community 92 - "Config & Room Entity Models"
Cohesion: 1.0
Nodes (1): Mp3Encoder

### Community 93 - "Message Delete & File Type"
Cohesion: 1.0
Nodes (0): 

### Community 94 - "Temp File Manager"
Cohesion: 1.0
Nodes (0): 

### Community 95 - "Overlay Controller & Popover"
Cohesion: 1.0
Nodes (0): 

### Community 96 - "Aiclaw Type Extensions"
Cohesion: 1.0
Nodes (0): 

### Community 97 - "ImRequest & API Utils"
Cohesion: 1.0
Nodes (0): 

### Community 98 - "Emoji & Video Viewer Stores"
Cohesion: 1.0
Nodes (0): 

### Community 99 - "Thumbnail Cache & Scanner"
Cohesion: 1.0
Nodes (0): 

### Community 100 - "Message Select & Render Reply"
Cohesion: 1.0
Nodes (0): 

### Community 101 - "Read Count Queue"
Cohesion: 1.0
Nodes (0): 

### Community 102 - "Image & Voice Drag Control"
Cohesion: 1.0
Nodes (0): 

### Community 103 - "Community 103"
Cohesion: 1.0
Nodes (0): 

### Community 104 - "Window Management Hooks"
Cohesion: 1.0
Nodes (0): 

### Community 105 - "Check Update & Driver Hooks"
Cohesion: 1.0
Nodes (0): 

### Community 106 - "Platform Enums & Types"
Cohesion: 1.0
Nodes (1): Hula<R>

### Community 107 - "Coord Transform & Canvas2Dom"
Cohesion: 1.0
Nodes (1): Hula<R>

### Community 108 - "Chat & ImageViewer Stores"
Cohesion: 1.0
Nodes (1): T

### Community 109 - "Initial Sync & Notice Stores"
Cohesion: 1.0
Nodes (1): String

### Community 110 - "My Room Info Updater"
Cohesion: 1.0
Nodes (1): KeyboardScrollPreventDelegate

### Community 111 - "macOS Splash Screen"
Cohesion: 1.0
Nodes (0): 

### Community 112 - "Router Index Config"
Cohesion: 1.0
Nodes (0): 

### Community 113 - "User Store & Login History"
Cohesion: 1.0
Nodes (0): 

### Community 114 - "MenuTop & Guide Stores"
Cohesion: 1.0
Nodes (0): 

### Community 115 - "Custom Forward & Mock Msg"
Cohesion: 1.0
Nodes (2): D7: UUID机器码持久化到本地文件, D8: 独立AICLAW_AUTH_REQUEST WS事件

### Community 116 - "Assistant Model Presets"
Cohesion: 1.0
Nodes (2): ADR决策记录规范 (Proposed/Accepted/Superseded/Rejected), R-002: 多仓协作信息分散 (统一进入hula-docs+ADR)

### Community 117 - "Audio Playback & File Mgr"
Cohesion: 1.0
Nodes (2): B8 24h延迟注销定时任务 (REQ-002遗留), XXL-Job 24h延迟注销定时任务

### Community 118 - "Audio File Manager Storage"
Cohesion: 1.0
Nodes (2): Naive UI Desktop Library, Vant Mobile UI Library

### Community 119 - "Pinia-Store Template"
Cohesion: 1.0
Nodes (2): Rodio Audio, Voice and Video Calling

### Community 120 - "Tauri Command Rust Template"
Cohesion: 1.0
Nodes (2): Development Memory Monitor Component (v3.0.9), pnpm Package Manager

### Community 121 - "Tauri Command TS Template"
Cohesion: 1.0
Nodes (2): Fork-PR Contribution Workflow, Issue and PR Submission Process

### Community 122 - "Pinia Store Symbol Enum"
Cohesion: 1.0
Nodes (2): Contributor Recognition via Openomy, Sponsor Tiers (Diamond/Gold/Silver/Bronze)

### Community 123 - "Aiclaw Token Dialog"
Cohesion: 1.0
Nodes (2): macOS Certificate Workaround (xattr quarantine), Windows Code Signing for Installer

### Community 124 - "Cache Config & Validation"
Cohesion: 1.0
Nodes (2): HuLa Version Changelog (v3.0.0-v3.0.9), HuLa Version Support Policy (1.4-2.x)

### Community 125 - "Common Constants & Console"
Cohesion: 1.0
Nodes (2): SQLCipher Encryption Feature (v3.0.7), SQLite with SeaORM and SQLCipher

### Community 126 - "Persistence & Resize"
Cohesion: 1.0
Nodes (2): Webview Intrusion Protection (macOS/Linux), Windows Runtime Security Guards (v3.0.6)

### Community 127 - "Avatar Upload & Canvas Tool"
Cohesion: 1.0
Nodes (2): WebSocket Auto Message Sync after Reconnection (v3.0.5), tokio-tungstenite WebSocket

### Community 128 - "Presets & Aiclaw Utils"
Cohesion: 1.0
Nodes (2): DPI/Multi-Screen Scaling Fix (Windows 10), NSIS Installer Permission Fix

### Community 129 - "Community 129"
Cohesion: 1.0
Nodes (2): src-tauri/docs Chinese README, src-tauri/docs English README

### Community 130 - "Community 130"
Cohesion: 1.0
Nodes (0): 

### Community 131 - "Community 131"
Cohesion: 1.0
Nodes (0): 

### Community 132 - "Community 132"
Cohesion: 1.0
Nodes (0): 

### Community 133 - "Community 133"
Cohesion: 1.0
Nodes (0): 

### Community 134 - "Community 134"
Cohesion: 1.0
Nodes (0): 

### Community 135 - "Community 135"
Cohesion: 1.0
Nodes (0): 

### Community 136 - "Community 136"
Cohesion: 1.0
Nodes (0): 

### Community 137 - "Community 137"
Cohesion: 1.0
Nodes (0): 

### Community 138 - "Community 138"
Cohesion: 1.0
Nodes (0): 

### Community 139 - "Community 139"
Cohesion: 1.0
Nodes (0): 

### Community 140 - "Community 140"
Cohesion: 1.0
Nodes (0): 

### Community 141 - "Community 141"
Cohesion: 1.0
Nodes (0): 

### Community 142 - "Community 142"
Cohesion: 1.0
Nodes (0): 

### Community 143 - "Community 143"
Cohesion: 1.0
Nodes (0): 

### Community 144 - "Community 144"
Cohesion: 1.0
Nodes (0): 

### Community 145 - "Community 145"
Cohesion: 1.0
Nodes (0): 

### Community 146 - "Community 146"
Cohesion: 1.0
Nodes (0): 

### Community 147 - "Community 147"
Cohesion: 1.0
Nodes (0): 

### Community 148 - "Community 148"
Cohesion: 1.0
Nodes (0): 

### Community 149 - "Community 149"
Cohesion: 1.0
Nodes (0): 

### Community 150 - "Community 150"
Cohesion: 1.0
Nodes (0): 

### Community 151 - "Community 151"
Cohesion: 1.0
Nodes (0): 

### Community 152 - "Community 152"
Cohesion: 1.0
Nodes (0): 

### Community 153 - "Community 153"
Cohesion: 1.0
Nodes (0): 

### Community 154 - "Community 154"
Cohesion: 1.0
Nodes (0): 

### Community 155 - "Community 155"
Cohesion: 1.0
Nodes (0): 

### Community 156 - "Community 156"
Cohesion: 1.0
Nodes (0): 

### Community 157 - "Community 157"
Cohesion: 1.0
Nodes (1): ActiveModel

### Community 158 - "Community 158"
Cohesion: 1.0
Nodes (1): ActiveModel

### Community 159 - "Community 159"
Cohesion: 1.0
Nodes (1): ActiveModel

### Community 160 - "Community 160"
Cohesion: 1.0
Nodes (1): ActiveModel

### Community 161 - "Community 161"
Cohesion: 1.0
Nodes (1): ActiveModel

### Community 162 - "Community 162"
Cohesion: 1.0
Nodes (1): ActiveModel

### Community 163 - "Community 163"
Cohesion: 1.0
Nodes (0): 

### Community 164 - "Community 164"
Cohesion: 1.0
Nodes (0): 

### Community 165 - "Community 165"
Cohesion: 1.0
Nodes (0): 

### Community 166 - "Community 166"
Cohesion: 1.0
Nodes (0): 

### Community 167 - "Community 167"
Cohesion: 1.0
Nodes (1): Issue Management Process

### Community 168 - "Community 168"
Cohesion: 1.0
Nodes (1): No Open Issues

### Community 169 - "Community 169"
Cohesion: 1.0
Nodes (1): Closed: Push Permission Validation for Three Repos (2026-03-09)

### Community 170 - "Community 170"
Cohesion: 1.0
Nodes (1): Three-Layer Git Branch Model (master/dev/feature)

### Community 171 - "Community 171"
Cohesion: 1.0
Nodes (1): release/* Branches (Optional Version Freeze)

### Community 172 - "Community 172"
Cohesion: 1.0
Nodes (1): Workspace Standards: Independent Dev Clones, Separate Ops Dir, QA Test Env Only

### Community 173 - "Community 173"
Cohesion: 1.0
Nodes (1): Tokio Async Runtime

### Community 174 - "Community 174"
Cohesion: 1.0
Nodes (1): Reqwest HTTP Client

### Community 175 - "Community 175"
Cohesion: 1.0
Nodes (1): Vue Router

### Community 176 - "Community 176"
Cohesion: 1.0
Nodes (1): Auto-Update System

### Community 177 - "Community 177"
Cohesion: 1.0
Nodes (1): Discord Community

### Community 178 - "Community 178"
Cohesion: 1.0
Nodes (1): CII Best Practices Badge

### Community 179 - "Community 179"
Cohesion: 1.0
Nodes (1): Installation and Build Commands

### Community 180 - "Community 180"
Cohesion: 1.0
Nodes (1): Community Groups (WeChat/QQ/HuLa Issues)

### Community 181 - "Community 181"
Cohesion: 1.0
Nodes (1): Drag File Upload Feature (v3.0.8)

### Community 182 - "Community 182"
Cohesion: 1.0
Nodes (1): Message Sync Throttling (v3.0.5)

### Community 183 - "Community 183"
Cohesion: 1.0
Nodes (1): macOS Traffic Light Button Spacing (v3.0.8)

### Community 184 - "Community 184"
Cohesion: 1.0
Nodes (1): Group QR Code Save and Forward (v3.0.8)

### Community 185 - "Community 185"
Cohesion: 1.0
Nodes (1): Message Alert Sound Volume Control (v3.0.9)

### Community 186 - "Community 186"
Cohesion: 1.0
Nodes (1): Unread Count Accuracy Fixes (Mac Dock/Platform)

### Community 187 - "Community 187"
Cohesion: 1.0
Nodes (1): Tauri Plugin hula iOS Platform Notes

### Community 188 - "Community 188"
Cohesion: 1.0
Nodes (1): UpgradeLink Sponsor (toolsetlink.com)

### Community 189 - "Community 189"
Cohesion: 1.0
Nodes (1): Trendshift Repository Ranking

### Community 190 - "Community 190"
Cohesion: 1.0
Nodes (1): HelloGitHub Featured Project

### Community 191 - "Community 191"
Cohesion: 1.0
Nodes (1): DeepWiki Documentation

## Ambiguous Edges - Review These
- `Secondary Panel View (Settings or File Manager)` → `File Manager Component`  [AMBIGUOUS]
  preview/img2-3.webp · relation: conceptually_related_to
- `Mobile Login / QR Code Screen` → `Mobile Login Component`  [AMBIGUOUS]
  preview/img2-4.webp · relation: conceptually_related_to
- `Mobile Login / QR Code Screen` → `QR Code Display / Card`  [AMBIGUOUS]
  preview/img2-4.webp · relation: conceptually_related_to
- `Full Desktop Multi-Panel Layout` → `Notification Badge Indicator`  [AMBIGUOUS]
  preview/img2-5.webp · relation: visually_contains
- `Integrated Browser / Web Article Viewer` → `Preview File / Web View Component`  [AMBIGUOUS]
  preview/img2-6.webp · relation: conceptually_related_to
- `Chat View Empty State or Alternate Selection` → `Empty State / Placeholder Content Area`  [AMBIGUOUS]
  preview/img2-8.webp · relation: visually_contains
- `Desktop Chat List Interface (Dark Mode)` → `Mobile Light-Theme Landing Screen`  [AMBIGUOUS]
  preview/img3-1.webp · relation: conceptually_related_to
- `Dark Theme Desktop Design System` → `Light Theme Mobile Design System`  [AMBIGUOUS]
  preview/img3-1.webp · relation: conceptually_related_to
- `HuLa Dark Theme Chat Interface` → `Third-Party App Reference with Gold Bottom Bar`  [AMBIGUOUS]
  preview/zs.jpg · relation: conceptually_related_to
- `Alipay Mobile Reference Screenshot` → `Third-Party App Reference with Gold Bottom Bar`  [AMBIGUOUS]
  preview/zs.jpg · relation: conceptually_related_to
- `pnpm Package Manager` → `Development Memory Monitor Component (v3.0.9)`  [AMBIGUOUS]
  CHANGELOG.md · relation: conceptually_related_to
- `tauri-plugin-hula Custom Plugin` → `Project Disclaimer (AS-IS, No Warranty)`  [AMBIGUOUS]
  README.md · relation: conceptually_related_to
- `Settings Interface Screenshot` → `Dual-Pane Sidebar+Content Layout`  [AMBIGUOUS]
  preview/img_3.png · relation: conceptually_related_to

## Knowledge Gaps
- **307 isolated node(s):** `ColorThief`, `Mp3Encoder`, `Hula<R>`, `Hula<R>`, `HulaExt` (+302 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `User Config & Preferences`** (2 nodes): `colorthief.d.ts`, `ColorThief`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Config & Room Entity Models`** (2 nodes): `lamejs.d.ts`, `Mp3Encoder`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Message Delete & File Type`** (2 nodes): `useContextMenu.ts`, `useContextMenu()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Temp File Manager`** (2 nodes): `usePopover.ts`, `usePopover()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Overlay Controller & Popover`** (2 nodes): `useIntersectionTaskQueue.ts`, `useIntersectionTaskQueue()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Aiclaw Type Extensions`** (2 nodes): `useCanvasTool.ts`, `useCanvasTool()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `ImRequest & API Utils`** (2 nodes): `useViewport.ts`, `useViewport()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Emoji & Video Viewer Stores`** (2 nodes): `useWaveformRenderer.ts`, `useWaveformRenderer()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Thumbnail Cache & Scanner`** (2 nodes): `useAutoScrollGuard.ts`, `useAutoScrollGuard()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Message Select & Render Reply`** (2 nodes): `useOverlayController.ts`, `useOverlayController()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Read Count Queue`** (2 nodes): `StringUtils.ts`, `addSlashToHead()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Image & Voice Drag Control`** (2 nodes): `MessageSelect.ts`, `isMessageMultiSelectEnabled()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 103`** (2 nodes): `Canvas2Dom.ts`, `canvasToImageBytes()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Window Management Hooks`** (2 nodes): `markdown.ts`, `initMarkdownRenderer()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Check Update & Driver Hooks`** (2 nodes): `icon.js`, `c()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Platform Enums & Types`** (2 nodes): `Hula<R>`, `.ping()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Coord Transform & Canvas2Dom`** (2 nodes): `Hula<R>`, `.ping()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Chat & ImageViewer Stores`** (2 nodes): `T`, `.hula()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Initial Sync & Notice Stores`** (2 nodes): `String`, `.from()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `My Room Info Updater`** (2 nodes): `KeyboardScrollPreventDelegate`, `.new()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `macOS Splash Screen`** (2 nodes): `app_state_command.rs`, `is_app_state_ready()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Router Index Config`** (2 nodes): `database_command.rs`, `switch_user_database()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `User Store & Login History`** (2 nodes): `keyboard.rs`, `set_webview_keyboard_adjustment()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `MenuTop & Guide Stores`** (2 nodes): `tray.rs`, `create_tray()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Custom Forward & Mock Msg`** (2 nodes): `D7: UUID机器码持久化到本地文件`, `D8: 独立AICLAW_AUTH_REQUEST WS事件`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Assistant Model Presets`** (2 nodes): `ADR决策记录规范 (Proposed/Accepted/Superseded/Rejected)`, `R-002: 多仓协作信息分散 (统一进入hula-docs+ADR)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Audio Playback & File Mgr`** (2 nodes): `B8 24h延迟注销定时任务 (REQ-002遗留)`, `XXL-Job 24h延迟注销定时任务`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Audio File Manager Storage`** (2 nodes): `Naive UI Desktop Library`, `Vant Mobile UI Library`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Pinia-Store Template`** (2 nodes): `Rodio Audio`, `Voice and Video Calling`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Tauri Command Rust Template`** (2 nodes): `Development Memory Monitor Component (v3.0.9)`, `pnpm Package Manager`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Tauri Command TS Template`** (2 nodes): `Fork-PR Contribution Workflow`, `Issue and PR Submission Process`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Pinia Store Symbol Enum`** (2 nodes): `Contributor Recognition via Openomy`, `Sponsor Tiers (Diamond/Gold/Silver/Bronze)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Aiclaw Token Dialog`** (2 nodes): `macOS Certificate Workaround (xattr quarantine)`, `Windows Code Signing for Installer`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Cache Config & Validation`** (2 nodes): `HuLa Version Changelog (v3.0.0-v3.0.9)`, `HuLa Version Support Policy (1.4-2.x)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Common Constants & Console`** (2 nodes): `SQLCipher Encryption Feature (v3.0.7)`, `SQLite with SeaORM and SQLCipher`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Persistence & Resize`** (2 nodes): `Webview Intrusion Protection (macOS/Linux)`, `Windows Runtime Security Guards (v3.0.6)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Avatar Upload & Canvas Tool`** (2 nodes): `WebSocket Auto Message Sync after Reconnection (v3.0.5)`, `tokio-tungstenite WebSocket`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Presets & Aiclaw Utils`** (2 nodes): `DPI/Multi-Screen Scaling Fix (Windows 10)`, `NSIS Installer Permission Fix`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 129`** (2 nodes): `src-tauri/docs Chinese README`, `src-tauri/docs English README`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 130`** (1 nodes): `uno.config.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 131`** (1 nodes): `check-local.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 132`** (1 nodes): `vue-office-pdf.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 133`** (1 nodes): `env.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 134`** (1 nodes): `global.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 135`** (1 nodes): `vue-virtual-scroller.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 136`** (1 nodes): `postcss-pxtorem.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 137`** (1 nodes): `components.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 138`** (1 nodes): `vue-office-pptx.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 139`** (1 nodes): `auto-imports.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 140`** (1 nodes): `vue-office-excel.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 141`** (1 nodes): `options.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 142`** (1 nodes): `vue-office-docx.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 143`** (1 nodes): `server.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 144`** (1 nodes): `privacy.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 145`** (1 nodes): `imageDownloader.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 146`** (1 nodes): `history.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 147`** (1 nodes): `feedNotification.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 148`** (1 nodes): `alwaysOnTop.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 149`** (1 nodes): `notice.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 150`** (1 nodes): `downloadQuenu.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 151`** (1 nodes): `menuTop.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 152`** (1 nodes): `bot.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 153`** (1 nodes): `plugins.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 154`** (1 nodes): `rollup.config.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 155`** (1 nodes): `build.gradle.kts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 156`** (1 nodes): `Package.swift`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 157`** (1 nodes): `ActiveModel`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 158`** (1 nodes): `ActiveModel`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 159`** (1 nodes): `ActiveModel`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 160`** (1 nodes): `ActiveModel`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 161`** (1 nodes): `ActiveModel`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 162`** (1 nodes): `ActiveModel`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 163`** (1 nodes): `user_info.rs`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 164`** (1 nodes): `settings.gradle.kts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 165`** (1 nodes): `BadgeBridge.mm`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 166`** (1 nodes): `pinia-store.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 167`** (1 nodes): `Issue Management Process`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 168`** (1 nodes): `No Open Issues`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 169`** (1 nodes): `Closed: Push Permission Validation for Three Repos (2026-03-09)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 170`** (1 nodes): `Three-Layer Git Branch Model (master/dev/feature)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 171`** (1 nodes): `release/* Branches (Optional Version Freeze)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 172`** (1 nodes): `Workspace Standards: Independent Dev Clones, Separate Ops Dir, QA Test Env Only`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 173`** (1 nodes): `Tokio Async Runtime`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 174`** (1 nodes): `Reqwest HTTP Client`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 175`** (1 nodes): `Vue Router`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 176`** (1 nodes): `Auto-Update System`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 177`** (1 nodes): `Discord Community`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 178`** (1 nodes): `CII Best Practices Badge`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 179`** (1 nodes): `Installation and Build Commands`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 180`** (1 nodes): `Community Groups (WeChat/QQ/HuLa Issues)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 181`** (1 nodes): `Drag File Upload Feature (v3.0.8)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 182`** (1 nodes): `Message Sync Throttling (v3.0.5)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 183`** (1 nodes): `macOS Traffic Light Button Spacing (v3.0.8)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 184`** (1 nodes): `Group QR Code Save and Forward (v3.0.8)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 185`** (1 nodes): `Message Alert Sound Volume Control (v3.0.9)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 186`** (1 nodes): `Unread Count Accuracy Fixes (Mac Dock/Platform)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 187`** (1 nodes): `Tauri Plugin hula iOS Platform Notes`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 188`** (1 nodes): `UpgradeLink Sponsor (toolsetlink.com)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 189`** (1 nodes): `Trendshift Repository Ranking`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 190`** (1 nodes): `HelloGitHub Featured Project`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 191`** (1 nodes): `DeepWiki Documentation`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Secondary Panel View (Settings or File Manager)` and `File Manager Component`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Mobile Login / QR Code Screen` and `Mobile Login Component`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Mobile Login / QR Code Screen` and `QR Code Display / Card`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Full Desktop Multi-Panel Layout` and `Notification Badge Indicator`?**
  _Edge tagged AMBIGUOUS (relation: visually_contains) - confidence is low._
- **What is the exact relationship between `Integrated Browser / Web Article Viewer` and `Preview File / Web View Component`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Chat View Empty State or Alternate Selection` and `Empty State / Placeholder Content Area`?**
  _Edge tagged AMBIGUOUS (relation: visually_contains) - confidence is low._
- **What is the exact relationship between `Desktop Chat List Interface (Dark Mode)` and `Mobile Light-Theme Landing Screen`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._