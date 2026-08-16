//! NAPI `AsyncTask` wrappers.
//!
//! Every struct implements `napi::Task`, whose `compute()` runs on a **libuv
//! thread-pool thread** — never on the Node main thread.  This is critical:
//! all file I/O and CPU-heavy work happens off-thread, so the Node event loop
//! is never blocked.  `resolve()` runs back on the main thread and only does
//! cheap value conversions.

use napi::bindgen_prelude::{Env, Result, Task};

use crate::dir_scan::{scan_directory_tree_sync, DirScanOptions};
use crate::fuzzy_match::scan_fuzzy_matches_sync;
use crate::io::{read_file_sync, write_file_sync};
use crate::text_edit::apply_text_edits_sync;
use crate::types::{
  NativeDirectoryEntry, NativeDirectoryScanResult, NativeMatch, NativeTextEdit,
};

// ── fuzzy match ───────────────────────────────────────────────────────────

pub struct ScanFuzzyMatchesTask {
  pub content: String,
  pub search: String,
  pub threshold: f64,
  pub max_matches: u32,
  pub use_pre_filter: bool,
  pub pre_filter_threshold: f64,
}

impl Task for ScanFuzzyMatchesTask {
  type Output = Vec<NativeMatch>;
  type JsValue = Vec<NativeMatch>;

  fn compute(&mut self) -> Result<Self::Output> {
    Ok(scan_fuzzy_matches_sync(
      std::mem::take(&mut self.content),
      std::mem::take(&mut self.search),
      self.threshold,
      self.max_matches,
      self.use_pre_filter,
      self.pre_filter_threshold,
    ))
  }

  fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
    Ok(output)
  }
}

// ── text edit ─────────────────────────────────────────────────────────────

pub struct ApplyTextEditsTask {
  pub content: String,
  pub edits: Vec<NativeTextEdit>,
}

impl Task for ApplyTextEditsTask {
  type Output = String;
  type JsValue = String;

  fn compute(&mut self) -> Result<Self::Output> {
    Ok(apply_text_edits_sync(
      std::mem::take(&mut self.content),
      std::mem::take(&mut self.edits),
    ))
  }

  fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
    Ok(output)
  }
}

// ── file read ─────────────────────────────────────────────────────────────

pub struct ReadFileTask {
  pub path: String,
}

impl Task for ReadFileTask {
  type Output = String;
  type JsValue = String;

  /// Runs on a libuv thread — blocking `std::fs` is safe here.
  fn compute(&mut self) -> Result<Self::Output> {
    read_file_sync(std::mem::take(&mut self.path))
  }

  fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
    Ok(output)
  }
}

// ── file write ────────────────────────────────────────────────────────────

pub struct WriteFileTask {
  pub path: String,
  pub content: String,
}

impl Task for WriteFileTask {
  type Output = ();
  type JsValue = ();

  /// Runs on a libuv thread — blocking `std::fs` is safe here.
  fn compute(&mut self) -> Result<Self::Output> {
    write_file_sync(std::mem::take(&mut self.path), std::mem::take(&mut self.content))
  }

  fn resolve(&mut self, _env: Env, _output: Self::Output) -> Result<Self::JsValue> {
    Ok(())
  }
}

// ── directory tree scan ───────────────────────────────────────────────────

pub struct ScanDirectoryTreeTask {
  pub root: String,
  pub max_depth: u32,
  pub gitignore_content: Option<String>,
}

impl Task for ScanDirectoryTreeTask {
  type Output = NativeDirectoryScanResult;
  type JsValue = NativeDirectoryScanResult;

  /// Runs on a libuv thread — blocking `std::fs` reads are safe here.
  fn compute(&mut self) -> Result<Self::Output> {
    let result = scan_directory_tree_sync(DirScanOptions {
      root: std::mem::take(&mut self.root),
      max_depth: self.max_depth,
      gitignore_content: self.gitignore_content.take(),
    })?;

    Ok(NativeDirectoryScanResult {
      entries: result
        .entries
        .into_iter()
        .map(|(relative_path, is_directory, size)| NativeDirectoryEntry {
          relative_path,
          is_directory,
          size,
        })
        .collect(),
      depth_limit_hit: result.depth_limit_hit,
    })
  }

  fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
    Ok(output)
  }
}
