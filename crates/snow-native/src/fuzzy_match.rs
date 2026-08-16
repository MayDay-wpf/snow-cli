use crate::similarity::{
  byte_offset_to_utf16_column, find_subslice, normalize_line_with_map, normalize_whitespace,
  similarity, similarity_units,
};
use crate::types::NativeMatch;

/// A within-line (inline) substring match, with a 0-based UTF-16 column range
/// (end exclusive) that is safe to use for slicing the raw line.
struct InlineMatch {
  start: u32,
  end: u32,
  similarity: f64,
}

/// Find the best inline substring match of `search` inside a single `line`.
///
/// This handles the common case where the AI only provides *part* of a line
/// (e.g. a Chinese comment fragment) instead of the whole line: the whole-line
/// similarity would fail the length-ratio check, so we scan inside the line.
///
/// Match order:
/// 1. Exact substring on the raw line (fast path, similarity 1.0).
/// 2. Exact substring on the whitespace-normalized line.
/// 3. Fuzzy scan with window length `search_len ± 2`, anchored at occurrences
///    of the first non-whitespace search unit to bound the cost.
fn find_inline_match(
  line: &str,
  search_raw: &str,
  normalized_search_units: &[u16],
  threshold: f64,
) -> Option<InlineMatch> {
  if normalized_search_units.is_empty() {
    return None;
  }

  // 1. Exact match on the raw line (most common path).
  if let Some(byte_start) = line.find(search_raw) {
    let byte_end = byte_start + search_raw.len();
    return Some(InlineMatch {
      start: byte_offset_to_utf16_column(line, byte_start),
      end: byte_offset_to_utf16_column(line, byte_end),
      similarity: 1.0,
    });
  }

  // 2. Normalize the line and keep the code-unit -> byte map.
  let (units, _map) = normalize_line_with_map(line);
  if normalized_search_units.len() > units.len() {
    return None;
  }

  // 2a. Exact match on the normalized line.
  if let Some(position) = find_subslice(&units, normalized_search_units) {
    return Some(InlineMatch {
      start: position as u32,
      end: (position + normalized_search_units.len()) as u32,
      similarity: 1.0,
    });
  }

  // 2b. Fuzzy match: scan windows of length search_len ± 2 anchored at
  // occurrences of the first non-whitespace search unit.
  let search_len = normalized_search_units.len();
  let window_min = search_len.saturating_sub(2).max(1);
  let window_max = (search_len + 2).min(units.len());
  if window_min > window_max {
    return None;
  }

  let anchor = normalized_search_units
    .iter()
    .copied()
    .find(|unit| *unit != 0x20 && !(*unit as u8).is_ascii_whitespace())
    .unwrap_or(normalized_search_units[0]);

  let mut best: Option<(u32, u32, f64)> = None;
  let mut anchor_positions: Vec<usize> = Vec::new();
  for (index, unit) in units.iter().enumerate() {
    if *unit == anchor {
      anchor_positions.push(index);
    }
  }

  // Cap the number of anchor candidates to bound worst-case cost.
  let max_anchors = 200;
  let last_valid_start = units.len().saturating_sub(window_min);
  for anchor_pos in anchor_positions.into_iter().take(max_anchors) {
    let start_low = anchor_pos.saturating_sub(2);
    let start_high = (anchor_pos + 2).min(last_valid_start);
    if start_low > start_high {
      continue;
    }
    for start in start_low..=start_high {
      for win_len in window_min..=window_max {
        let end = start + win_len;
        if end > units.len() {
          continue;
        }
        let sim = similarity_units(&units[start..end], normalized_search_units, threshold);
        if best.map_or(true, |(_, _, current)| sim > current) {
          best = Some((start as u32, end as u32, sim));
        }
      }
    }
  }

  let (start, end, sim) = best?;
  if sim >= threshold {
    Some(InlineMatch {
      start,
      end,
      similarity: sim,
    })
  } else {
    None
  }
}

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
  let normalized_search_units: Vec<u16> = normalized_search.encode_utf16().collect();
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

    // Single-line search: also try inline (within-line substring) matching.
    // This covers the common case where the AI only provides part of a line
    // (e.g. a Chinese comment fragment) instead of the whole line — the
    // whole-line similarity would otherwise fail the length-ratio check.
    let inline_match = if base_window == 1 {
      find_inline_match(lines[start_index], &search, &normalized_search_units, threshold)
    } else {
      None
    };

    // Exact inline hit (1.0): prefer it over any whole-line fuzzy score so we
    // never replace the whole line with a partial substring.
    if let Some(inline) = &inline_match {
      if inline.similarity >= 1.0 {
        matches.push(NativeMatch {
          start_line: (start_index + 1) as u32,
          end_line: (start_index + 1) as u32,
          similarity: 1.0,
          start_column: Some(inline.start),
          end_column: Some(inline.end),
        });
        break;
      }
    }

    // High-confidence match: accept immediately without trying other sizes
    if exact_score >= 0.9 {
      matches.push(NativeMatch {
        start_line: (start_index + 1) as u32,
        end_line: (start_index + base_window) as u32,
        similarity: exact_score,
        start_column: None,
        end_column: None,
      });
      if exact_score >= 0.95 || matches.len() >= max_matches as usize {
        break;
      }
      continue;
    }

    // Single line: pick the better of inline vs whole-line fuzzy score.
    if base_window == 1 {
      let inline_score = inline_match.as_ref().map_or(0.0, |m| m.similarity);
      if inline_score >= threshold && inline_score >= exact_score {
        if let Some(inline) = inline_match {
          matches.push(NativeMatch {
            start_line: (start_index + 1) as u32,
            end_line: (start_index + 1) as u32,
            similarity: inline.similarity,
            start_column: Some(inline.start),
            end_column: Some(inline.end),
          });
          if inline.similarity >= 0.95 || matches.len() >= max_matches as usize {
            break;
          }
        }
        continue;
      }
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
          start_column: None,
          end_column: None,
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
        start_column: None,
        end_column: None,
      });
      if exact_score >= 0.95 || matches.len() >= max_matches as usize {
        break;
      }
    }
  }

  matches.sort_by(|left, right| right.similarity.total_cmp(&left.similarity));
  matches
}
