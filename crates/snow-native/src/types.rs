use napi_derive::napi;

#[napi(object)]
pub struct NativeMatch {
  pub start_line: u32,
  pub end_line: u32,
  pub similarity: f64,
  /// Inline substring match: 0-based UTF-16 column range within start_line.
  /// `None` when the match is a whole-line / multi-line block.
  pub start_column: Option<u32>,
  pub end_column: Option<u32>,
}

#[derive(Clone)]
#[napi(object)]
pub struct NativeTextEdit {
  pub kind: String,
  pub start_line: u32,
  pub end_line: u32,
  pub content: Option<String>,
}

#[napi(object)]
pub struct NativeDirectoryEntry {
  /// Path relative to the scanned root, forward slashes, no `./` prefix.
  pub relative_path: String,
  pub is_directory: bool,
  /// File size in bytes (0 for directories). Used by the caller for the
  /// 10 MiB size cap — computed natively to avoid a stat syscall per file.
  /// `u32` (not `u64`) because `#[napi(object)]` lacks a `u64` impl.
  pub size: u32,
}

#[napi(object)]
pub struct NativeDirectoryScanResult {
  pub entries: Vec<NativeDirectoryEntry>,
  /// True when at least one directory was skipped because it exceeded
  /// `max_depth` (mirrors `hasMoreDepth` in FileList.tsx).
  pub depth_limit_hit: bool,
}
