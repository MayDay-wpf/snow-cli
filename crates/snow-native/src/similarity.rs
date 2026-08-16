/// Normalize whitespace: collapse consecutive whitespace into a single space,
/// strip leading/trailing whitespace, and treat BOM as whitespace.
pub(crate) fn normalize_whitespace(content: &str) -> String {
  let mut normalized = String::with_capacity(content.len());
  let mut previous_was_whitespace = true;

  for character in content.chars() {
    let is_whitespace = character.is_whitespace() || character == '\u{feff}';
    if is_whitespace {
      if !previous_was_whitespace {
        normalized.push(' ');
      }
    } else {
      normalized.push(character);
    }
    previous_was_whitespace = is_whitespace;
  }

  normalized.trim_end().to_owned()
}

/// Levenshtein edit distance on UTF-16 code units (matches JS string comparison).
/// Early-exits when the distance exceeds `max_distance`.
pub(crate) fn levenshtein_distance(left: &[u16], right: &[u16], max_distance: usize) -> usize {
  if left == right {
    return 0;
  }

  if left.len().abs_diff(right.len()) > max_distance {
    return max_distance + 1;
  }

  let mut previous: Vec<usize> = (0..=right.len()).collect();
  for (left_index, left_unit) in left.iter().enumerate() {
    let mut current = Vec::with_capacity(right.len() + 1);
    current.push(left_index + 1);
    let mut minimum = left_index + 1;

    for (right_index, right_unit) in right.iter().enumerate() {
      let value = (previous[right_index + 1] + 1)
        .min(current[right_index] + 1)
        .min(previous[right_index] + usize::from(left_unit != right_unit));
      current.push(value);
      minimum = minimum.min(value);
    }

    if minimum > max_distance {
      return max_distance + 1;
    }
    previous = current;
  }

  previous[right.len()]
}

/// Normalized similarity score in [0, 1] based on Levenshtein distance.
/// If `threshold > 0` and the length ratio is below it, returns early with the
/// length ratio to skip the expensive distance computation.
pub(crate) fn similarity(normalized_left: &str, normalized_right: &str, threshold: f64) -> f64 {
  let left: Vec<u16> = normalized_left.encode_utf16().collect();
  let right: Vec<u16> = normalized_right.encode_utf16().collect();
  similarity_units(&left, &right, threshold)
}

/// Similarity over pre-encoded UTF-16 code-unit slices (matches JS string
/// comparison semantics, including surrogate pairs).
pub(crate) fn similarity_units(left: &[u16], right: &[u16], threshold: f64) -> f64 {
  if left.is_empty() {
    return if right.is_empty() { 1.0 } else { 0.0 };
  }
  if right.is_empty() {
    return 0.0;
  }

  let max_length = left.len().max(right.len());
  let length_ratio = left.len().min(right.len()) as f64 / max_length as f64;
  if threshold > 0.0 && length_ratio < threshold {
    return length_ratio;
  }

  let max_distance = (max_length as f64 * (1.0 - threshold)).ceil() as usize;
  let distance = levenshtein_distance(left, right, max_distance);
  1.0 - distance as f64 / max_length as f64
}

/// Normalize a single line (collapse whitespace, trim) and record the mapping
/// from each normalized UTF-16 code unit back to the original line's byte
/// offset.  Useful for inline substring matching where the column range must
/// be translated back to the raw line for slicing.
pub(crate) fn normalize_line_with_map(line: &str) -> (Vec<u16>, Vec<usize>) {
  let mut units: Vec<u16> = Vec::with_capacity(line.len());
  let mut map: Vec<usize> = Vec::with_capacity(line.len());
  let mut previous_was_whitespace = true;

  let mut buffer = [0u16; 2];
  for (byte_index, character) in line.char_indices() {
    let is_whitespace = character.is_whitespace() || character == '\u{feff}';
    if is_whitespace {
      if !previous_was_whitespace {
        units.push(' ' as u16);
        map.push(byte_index);
      }
    } else {
      for unit in character.encode_utf16(&mut buffer) {
        units.push(*unit);
        map.push(byte_index);
      }
    }
    previous_was_whitespace = is_whitespace;
  }

  // Trim trailing whitespace (leading whitespace is already collapsed away).
  while units.last() == Some(&(' ' as u16)) {
    units.pop();
    map.pop();
  }

  (units, map)
}

/// Find the first occurrence of `needle` inside `haystack` (both UTF-16 code
/// units).  Returns the starting index or `None`.
pub(crate) fn find_subslice(haystack: &[u16], needle: &[u16]) -> Option<usize> {
  if needle.is_empty() {
    return Some(0);
  }
  if needle.len() > haystack.len() {
    return None;
  }
  haystack.windows(needle.len()).position(|window| window == needle)
}

/// Convert a byte offset into the UTF-16 code-unit column of the same string.
pub(crate) fn byte_offset_to_utf16_column(s: &str, byte_offset: usize) -> u32 {
  s.get(..byte_offset)
    .map(|prefix| prefix.encode_utf16().count() as u32)
    .unwrap_or_else(|| s.encode_utf16().count() as u32)
}
