use crate::error::CommonError;
use sea_orm::{ConnectOptions, Database, DatabaseConnection};
use std::io::Read;
use std::path::PathBuf;
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tracing::info;

// 应用程序设置结构体
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug)]
pub struct Settings {
    pub database: DatabaseSettings,
    pub backend: BackendSettings,
    pub youdao: Option<Youdao>,
    pub tencent: Option<Tencent>,
    pub minio: Option<MinioSettings>,
    pub ice_server: Option<IceServer>,
}

// 数据库配置设置
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug)]
pub struct DatabaseSettings {
    pub sqlite_file: String,
}

// 后端服务配置设置
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug)]
pub struct BackendSettings {
    pub base_url: String,
    pub ws_url: String,
}

#[derive(serde::Deserialize, serde::Serialize, Clone, Debug)]
pub struct Youdao {
    pub app_key: String,
    pub app_secret: String,
}

#[derive(serde::Deserialize, serde::Serialize, Clone, Debug)]
pub struct IceServer {
    pub urls: Vec<String>,
    pub username: String,
    pub credential: String,
}

#[derive(serde::Deserialize, serde::Serialize, Clone, Debug)]
pub struct Tencent {
    pub api_key: String,
    pub secret_id: String,
    pub map_key: String,
}

#[derive(serde::Deserialize, serde::Serialize, Clone, Debug)]
pub struct MinioSettings {
    pub endpoint: String,
    pub bucket: String,
    pub access_key: String,
    pub secret_key: String,
    pub region: String,
    pub download_domain: String,
}

// 应用程序运行环境枚举
#[derive(Debug)]
pub enum Environment {
    Local,
    Production,
}

impl DatabaseSettings {
    /// 根据用户ID生成数据库文件名
    /// 如果提供了用户ID，则生成 `db_{uid}.sqlite` 格式的文件名
    /// 否则使用默认的 `db.sqlite`
    fn get_db_filename(uid: Option<&str>) -> String {
        match uid {
            Some(id) if !id.is_empty() => format!("db_{}.sqlite", id),
            _ => "db.sqlite".to_string(),
        }
    }

    /// 创建数据库连接
    /// 根据不同的运行环境（桌面开发、移动端、桌面生产）选择合适的数据库路径
    /// 并配置数据库连接选项，返回数据库连接实例
    ///
    /// # 参数
    /// * `app_handle` - Tauri应用句柄，用于获取应用路径
    /// * `uid` - 可选的用户ID，用于生成用户专属的数据库文件
    ///
    /// # 返回值
    /// * `Ok(DatabaseConnection)` - 成功时返回数据库连接
    /// * `Err(CommonError)` - 失败时返回错误信息
    pub async fn connection_string(
        &self,
        app_handle: &AppHandle,
        uid: Option<&str>,
    ) -> Result<DatabaseConnection, CommonError> {
        let db_filename = Self::get_db_filename(uid);
        info!("Database filename: {}", db_filename);

        // 数据库路径配置：
        let db_path = if cfg!(debug_assertions) && cfg!(desktop) {
            // 桌面端开发环境：使用项目根目录（src-tauri）
            let mut path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
            path.push(&db_filename);
            path
        } else {
            match app_handle.path().app_data_dir() {
                Ok(app_data_dir) => {
                    if let Err(create_err) = std::fs::create_dir_all(&app_data_dir) {
                        tracing::warn!("Failed to create app_data_dir: {}", create_err);
                    }
                    let db_path = app_data_dir.join(&db_filename);
                    info!("Using app_data_dir database path: {:?}", db_path);
                    db_path
                }
                Err(e) => {
                    let error_msg = format!("Failed to get app_data_dir: {}", e);
                    tracing::error!("{}", error_msg);
                    return Err(CommonError::RequestError(error_msg).into());
                }
            }
        };
        info!("Database path: {:?}", db_path);

        if db_path.exists() {
            let mut header = [0u8; 16];
            let need_repair = match std::fs::File::open(&db_path) {
                Ok(mut f) => {
                    let _ = f.read(&mut header);
                    header != *b"SQLite format 3\0"
                }
                Err(_) => false,
            };
            if need_repair {
                let backup = db_path.with_extension("corrupted");
                let _ =
                    std::fs::rename(&db_path, &backup).or_else(|_| std::fs::remove_file(&db_path));
            }
        }

        let db_url = format!("sqlite:{}?mode=rwc", db_path.display());

        // 配置数据库连接选项
        let mut opt = ConnectOptions::new(db_url);
        opt.max_connections(20) // 降低最大连接数，避免资源浪费
            .min_connections(2) // 降低最小连接数
            .connect_timeout(Duration::from_secs(30)) // 增加连接超时时间
            .acquire_timeout(Duration::from_secs(30)) // 增加获取连接超时时间
            .idle_timeout(Duration::from_secs(600)) // 10分钟空闲超时
            .max_lifetime(Duration::from_secs(1800)) // 30分钟连接生命周期，避免频繁重建
            // 启用 SQL 日志记录，但只在 debug 模式下
            .sqlx_logging(cfg!(debug_assertions))
            .sqlx_logging_level(tracing::log::LevelFilter::Info);

        match Database::connect(opt).await {
            Ok(db) => Ok(db),
            Err(e) => {
                let msg = e.to_string();
                if msg.contains("file is not a database") || msg.contains("code: 26") {
                    let _ = std::fs::remove_file(&db_path);
                    let mut opt2 =
                        ConnectOptions::new(format!("sqlite:{}?mode=rwc", db_path.display()));
                    opt2.max_connections(20)
                        .min_connections(2)
                        .connect_timeout(Duration::from_secs(30))
                        .acquire_timeout(Duration::from_secs(30))
                        .idle_timeout(Duration::from_secs(600))
                        .max_lifetime(Duration::from_secs(1800))
                        .sqlx_logging(cfg!(debug_assertions))
                        .sqlx_logging_level(tracing::log::LevelFilter::Info);
                    let db = Database::connect(opt2)
                        .await
                        .map_err(|e| anyhow::anyhow!("Database connection failed: {}", e))?;
                    Ok(db)
                } else {
                    Err(anyhow::anyhow!("Database connection failed: {}", e).into())
                }
            }
        }
    }
}

impl Environment {
    /// 将Environment枚举转换为字符串
    /// 用于文件名和路径构建
    ///
    /// # 返回值
    /// * `&'static str` - 对应的环境字符串
    pub fn as_str(&self) -> &'static str {
        match self {
            Environment::Local => "local",
            Environment::Production => "production",
        }
    }
}

impl TryFrom<String> for Environment {
    type Error = String;

    /// 从字符串解析Environment枚举
    /// 支持大小写不敏感的解析
    ///
    /// # 参数
    /// * `s` - 要解析的字符串
    ///
    /// # 返回值
    /// * `Ok(Environment)` - 解析成功时返回环境枚举
    /// * `Err(String)` - 解析失败时返回错误信息
    fn try_from(s: String) -> Result<Self, Self::Error> {
        match s.to_lowercase().as_str() {
            "local" => Ok(Self::Local),
            "production" => Ok(Self::Production),
            other => Err(format!(
                "{} is not a supported environment. Use either `local` or `production`.",
                other
            )),
        }
    }
}

/// 获取应用程序配置
/// 配置文件选择由编译 profile 驱动（active_config 机制已退役，见 active_config_filename）：
/// debug 构建合并 local.yaml（开发节点），release 构建合并 production.yaml（生产节点），
/// 均叠加在 base.yaml 之上，最后可被 APP__ 前缀环境变量覆盖。
/// 按优先级加载配置：
/// 1. 桌面开发环境：文件系统配置文件
/// 2. 其他环境：资源目录配置文件
/// 3. 回退：编译时嵌入的配置文件
///
/// # 参数
/// * `app_handle` - Tauri应用句柄
///
/// # 返回值
/// * `Ok(Settings)` - 成功时返回配置设置
/// * `Err(config::ConfigError)` - 失败时返回配置错误
pub fn get_configuration(app_handle: &AppHandle) -> Result<Settings, config::ConfigError> {
    #[cfg(not(target_os = "android"))]
    {
        let is_desktop_dev = cfg!(debug_assertions) && cfg!(desktop);

        let config_path_buf = get_config_path_buf(app_handle, is_desktop_dev)?;

        let settings = config::Config::builder()
            .add_source(config::File::from(config_path_buf.0))
            .add_source(config::File::from(config_path_buf.1))
            .add_source(
                config::Environment::with_prefix("APP")
                    .prefix_separator("_")
                    .separator("__"),
            )
            .build()?;

        let settings = settings.try_deserialize::<Settings>()?;
        // 解析结果落日志：release 验收与线上排障的第一手证据（地址非机密）
        info!(
            "Backend config resolved: base_url={}, ws_url={}",
            settings.backend.base_url, settings.backend.ws_url
        );
        Ok(settings)
    }

    #[cfg(target_os = "android")]
    {
        let _ = app_handle;
        // 读取 base.yaml 内容
        let base_content = std::str::from_utf8(include_bytes!("../configuration/base.yaml"))
            .map_err(|e| config::ConfigError::Message(e.to_string()))?;

        // active_config 机制已退役（aichatoverview#249）——改由编译 profile 驱动选择内嵌配置：
        // debug 构建内嵌 local.yaml（开发节点），release 构建内嵌 production.yaml（生产节点）。
        // 用 #[cfg] 属性而非 if cfg!()，让 release 编译不再依赖 local.yaml 文件存在，
        // 且 release 二进制不内嵌任何开发机地址。
        #[cfg(debug_assertions)]
        let config_file_bytes: &[u8] = include_bytes!("../configuration/local.yaml").as_ref();
        #[cfg(not(debug_assertions))]
        let config_file_bytes: &[u8] = include_bytes!("../configuration/production.yaml").as_ref();

        let active_content = std::str::from_utf8(config_file_bytes)
            .map_err(|e| config::ConfigError::Message(e.to_string()))?;

        // 构建最终配置对象
        let merged = config::Config::builder()
            .add_source(config::File::from_str(
                base_content,
                config::FileFormat::Yaml,
            ))
            .add_source(config::File::from_str(
                active_content,
                config::FileFormat::Yaml,
            ))
            .add_source(
                config::Environment::with_prefix("APP")
                    .prefix_separator("_")
                    .separator("__"),
            )
            .build()?;
        let settings = merged.try_deserialize::<Settings>()?;
        info!(
            "Backend config resolved: base_url={}, ws_url={}",
            settings.backend.base_url, settings.backend.ws_url
        );
        Ok(settings)
    }
}

/// active_config 机制已退役（aichatoverview#249）：配置文件选择改由编译 profile 驱动。
/// debug 构建（tauri:dev / cargo test）→ local.yaml（开发节点，gitignored，各开发机自己的）；
/// release 构建（tauri build）→ production.yaml（生产节点）。
/// 从机制上杜绝 release 包打进开发机地址（历史事故：base.yaml 的 active_config: local
/// 导致 release 默认连测试服）。
fn active_config_filename() -> &'static str {
    if cfg!(debug_assertions) {
        "local.yaml"
    } else {
        "production.yaml"
    }
}

fn get_config_path_buf(
    app_handle: &AppHandle,
    is_desktop_dev: bool,
) -> Result<(PathBuf, PathBuf), config::ConfigError> {
    let dir = if is_desktop_dev {
        let base_path = std::env::current_dir().map_err(|e| {
            config::ConfigError::Message(format!("Failed to get current dir: {}", e))
        })?;

        base_path.join("configuration")
    } else {
        app_handle
            .path()
            .resource_dir()
            .map_err(|e| config::ConfigError::NotFound(format!("resource not find: {}", e)))?
            .join("configuration")
    };

    let base_path = dir.join("base.yaml");
    let active_config_path_buf = dir.join(active_config_filename());
    Ok((base_path, active_config_path_buf))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// cargo test 恒为 debug profile（debug_assertions=true）→ 必须选 local.yaml；
    /// release 分支（production.yaml）由 release 构建的自检与安装包验证覆盖。
    #[test]
    fn active_config_filename_debug_selects_local() {
        assert_eq!(active_config_filename(), "local.yaml");
    }

    /// 锁死 aichatoverview#249 验收核心：base.yaml + production.yaml 按运行时相同的
    /// 合并顺序叠加后，release 默认解析必须落在生产 19778，且 base.yaml 不再携带
    /// 已退役的 active_config 字段。
    #[test]
    fn release_default_merges_to_production_19778() {
        let base_content = include_str!("../configuration/base.yaml");
        let production_content = include_str!("../configuration/production.yaml");

        let base_only = config::Config::builder()
            .add_source(config::File::from_str(
                base_content,
                config::FileFormat::Yaml,
            ))
            .build()
            .expect("base.yaml should parse");
        assert!(
            base_only.get_string("active_config").is_err(),
            "base.yaml must not carry the retired active_config field"
        );

        let settings = config::Config::builder()
            .add_source(config::File::from_str(
                base_content,
                config::FileFormat::Yaml,
            ))
            .add_source(config::File::from_str(
                production_content,
                config::FileFormat::Yaml,
            ))
            .build()
            .expect("base+production should merge")
            .try_deserialize::<Settings>()
            .expect("merged config should deserialize into Settings");

        assert_eq!(
            settings.backend.base_url,
            "http://hula.huahome.top:19778/api"
        );
        assert_eq!(
            settings.backend.ws_url,
            "ws://hula.huahome.top:19778/api/ws/ws"
        );
    }
}
