//! Recursive directory tree scan (BFS) with gitignore-aware filtering.
//!
//! This is the native counterpart of the `loadFiles` walk in
//! `source/ui/components/tools/FileList.tsx`. It performs the whole
//! readdir + metadata walk in a single NAPI call (on a libuv thread via
//! `AsyncTask`), which removes the per-file `fs.stat` round-trips that the
//! JavaScript implementation needs. Filtering semantics intentionally mirror
//! the JS side:
//!
//! 1. hidden entries (dotfiles) are skipped, except `.snow`;
//! 2. the root `.gitignore` is honoured (path rules, globs, `!` negation);
//! 3. files larger than 10 MiB are skipped;
//! 4. directories deeper than `max_depth` are not enqueued and set
//!    `depth_limit_hit` (the caller can rescan with a larger depth).
//!
//! Every fallible operation returns `napi::Result` — no unwrap/expect/panic.

use std::collections::VecDeque;
use std::path::{Path, PathBuf};

use ignore::gitignore::{Gitignore, GitignoreBuilder};
use napi::Error as NapiError;

/// 10 MiB — mirrors the `stats.size > 10 * 1024 * 1024` cap in FileList.tsx.
/// `u32` to compare directly against the u32 sizes in `DirScanResult`.
const MAX_FILE_SIZE_BYTES: u32 = 10 * 1024 * 1024;

pub(crate) struct DirScanOptions {
  pub root: String,
  pub max_depth: u32,
  pub gitignore_content: Option<String>,
}

pub(crate) struct DirScanResult {
  /// (relative_path, is_directory, size)
  pub entries: Vec<(String, bool, u32)>,
  pub depth_limit_hit: bool,
}

/// Parse `.gitignore` content anchored at `root` so that anchored rules
/// (e.g. `/native/target/`) resolve relative to the scanned root, matching
/// git semantics. Invalid lines are skipped.
fn parse_gitignore(root: &Path, content: &str) -> napi::Result<Gitignore> {
  let mut builder = GitignoreBuilder::new(root);
  for line in content.lines() {
    // Ok(false) = blank/comment line; Err = malformed line — both skipped.
    let _ = builder.add_line(None, line);
  }

  builder
    .build()
    .map_err(|e| NapiError::from_reason(format!("Failed to parse .gitignore: {e}")))
}

pub(crate) fn scan_directory_tree_sync(opts: DirScanOptions) -> napi::Result<DirScanResult> {
  let root = PathBuf::from(&opts.root);
  let gitignore = match &opts.gitignore_content {
    Some(content) => Some(parse_gitignore(&root, content)?),
    None => None,
  };

  let mut entries: Vec<(String, bool, u32)> = Vec::new();
  let mut depth_limit_hit = false;
  let mut queue: VecDeque<(PathBuf, u32)> = VecDeque::new();
  queue.push_back((root.clone(), 0));

  while let Some((dir, depth)) = queue.pop_front() {
    // Unreadable directories are skipped (mirrors the JS catch/continue).
    let read_dir = match std::fs::read_dir(&dir) {
      Ok(rd) => rd,
      Err(_) => continue,
    };

    for entry in read_dir.flatten() {
      let name = entry.file_name();
      let name_str = name.to_string_lossy();

      // Hidden filter: skip dot entries, except `.snow` (mirrors JS).
      if name_str.starts_with('.') && name_str != ".snow" {
        continue;
      }

      // Symlinks are not followed for is_directory (mirrors Dirent.isDirectory()).
      let file_type = match entry.file_type() {
        Ok(ft) => ft,
        Err(_) => continue,
      };
      let is_directory = file_type.is_dir();

      let relative_path = match entry.path().strip_prefix(&root) {
        Ok(rel) => rel.to_path_buf(),
        Err(_) => continue,
      };

      // Gitignore filter. `matched_path_or_any_parents` checks the path and
      // each ancestor; `is_dir` makes directory-only patterns (e.g. `dist/`)
      // match the directory itself. A whitelist (`!pattern`) result is not an
      // ignore, exactly like `filter.ignores()` returning false.
      if let Some(gi) = &gitignore {
        if gi
          .matched_path_or_any_parents(&relative_path, is_directory)
          .is_ignore()
        {
          continue;
        }
      }

      // Size cap for files. On Windows this metadata is free (comes from the
      // FindFirstFile data); on Unix it costs one stat — same as the JS walk.
      let size = if is_directory {
        0
      } else {
        match entry.metadata() {
          // `as u32` is safe: files larger than MAX_FILE_SIZE_BYTES are
          // filtered below, so the value is at most 10 MiB.
          Ok(m) => m.len() as u32,
          Err(_) => continue,
        }
      };
      if !is_directory && size > MAX_FILE_SIZE_BYTES {
        continue;
      }

      let relative_str = relative_path.to_string_lossy().replace('\\', "/");
      entries.push((relative_str, is_directory, size));

      if is_directory {
        if depth < opts.max_depth {
          queue.push_back((dir.join(&name), depth + 1));
        } else {
          depth_limit_hit = true;
        }
      }
    }
  }

  Ok(DirScanResult {
    entries,
    depth_limit_hit,
  })
}
