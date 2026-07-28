use crate::similarity::{normalize_whitespace, similarity};
use crate::types::NativeMatch;

/// Sliding-window fuzzy match — scans `content` for regions similar to `search`.
///
/// * `threshold` – minimum similarity to accept a match (0.0–1.0)
/// * `max_matches` – stop after collecting this many matches
/// * `use_pre_filter` – if true, compare first lines before computing full similarity
/// * `pre_filter_threshold` – first-line similarity gate (bypasses expensive computation)
pub(crate) fn scan_fuzzy_matches_sync(
  content: String,
  search: String,
  threshold: f64,
  max_matches: u32,
  use_pre_filter: bool,
  pre_filter_threshold: f64,
) -> Vec<NativeMatch> {
  let lines: Vec<&str> = content.split('\n').collect();
  let search_lines: Vec<&str> = search.split('\n').collect();
  if search_lines.len() > lines.len() {
    return Vec::new();
  }

  let base_window = search_lines.len();
  let normalized_search = normalize_whitespace(&search);
  let normalized_first_line = normalize_whitespace(search_lines.first().copied().unwrap_or_default());
  let mut matches = Vec::new();

  // Variable window size for large code blocks to improve boundary alignment.
  // When the AI provides a large search block, the actual code may differ by a
  // few lines (added/removed/merged). Trying multiple window sizes at each
  // candidate position helps find the correct boundaries and prevents
  // duplicate boundary lines after replacement.
  let window_delta = if base_window >= 10 {
    (base_window / 5).clamp(3, 15)
  } else {
    0
  };

  for start_index in 0..=lines.len() - base_window {
    if use_pre_filter {
      let normalized_candidate = normalize_whitespace(lines[start_index]);
      if similarity(
        &normalized_first_line,
        &normalized_candidate,
        pre_filter_threshold,
      ) < pre_filter_threshold
      {
        continue;
      }
    }

    // Try exact window size first
    let exact_candidate = lines[start_index..start_index + base_window].join("\n");
    let exact_score = if exact_candidate == search {
      1.0
    } else {
      similarity(&normalized_search, &normalize_whitespace(&exact_candidate), threshold)
    };

    // High-confidence match: accept immediately without trying other sizes
    if exact_score >= 0.9 {
      matches.push(NativeMatch {
        start_line: (start_index + 1) as u32,
        end_line: (start_index + base_window) as u32,
        similarity: exact_score,
      });
      if exact_score >= 0.95 || matches.len() >= max_matches as usize {
        break;
      }
      continue;
    }

    // For large blocks, try variable window sizes for better boundary alignment
    if window_delta > 0 {
      let mut best_score = exact_score;
      let mut best_end = start_index + base_window;

      for delta in 1..=window_delta {
        // Try smaller window
        if base_window > delta {
          let smaller = base_window - delta;
          let candidate = lines[start_index..start_index + smaller].join("\n");
          let score = if candidate == search {
            1.0
          } else {
            similarity(&normalized_search, &normalize_whitespace(&candidate), threshold)
          };
          if score > best_score {
            best_score = score;
            best_end = start_index + smaller;
          }
        }

        // Try larger window
        let larger = base_window + delta;
        if start_index + larger <= lines.len() {
          let candidate = lines[start_index..start_index + larger].join("\n");
          let score = if candidate == search {
            1.0
          } else {
            similarity(&normalized_search, &normalize_whitespace(&candidate), threshold)
          };
          if score > best_score {
            best_score = score;
            best_end = start_index + larger;
          }
        }

        // Early exit on near-perfect match
        if best_score >= 0.95 {
          break;
        }
      }

      if best_score >= threshold {
        matches.push(NativeMatch {
          start_line: (start_index + 1) as u32,
          end_line: best_end as u32,
          similarity: best_score,
        });
        if best_score >= 0.95 || matches.len() >= max_matches as usize {
          break;
        }
      }
    } else if exact_score >= threshold {
      // Small block: use exact window only
      matches.push(NativeMatch {
        start_line: (start_index + 1) as u32,
        end_line: (start_index + base_window) as u32,
        similarity: exact_score,
      });
      if exact_score >= 0.95 || matches.len() >= max_matches as usize {
        break;
      }
    }
  }

  matches.sort_by(|left, right| right.similarity.total_cmp(&left.similarity));
  matches
}
