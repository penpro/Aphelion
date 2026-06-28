/**
 * Extract the first balanced JSON object/array from a string.
 *
 * The reasoning model puts its planning in a separate `reasoning` field, so the
 * `content` we parse is usually clean JSON — but we still tolerate code fences
 * and leading/trailing prose by scanning for the first balanced {...} or [...].
 */
export function extractJSON(text: string): unknown {
  if (!text) return null
  let t = text.trim()

  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) t = fence[1].trim()

  const start = t.search(/[{[]/)
  if (start < 0) return null
  const open = t[start]
  const close = open === '{' ? '}' : ']'

  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < t.length; i++) {
    const ch = t[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') inStr = true
    else if (ch === open) depth++
    else if (ch === close) {
      depth--
      if (depth === 0) {
        try {
          return JSON.parse(t.slice(start, i + 1))
        } catch {
          return null
        }
      }
    }
  }
  return null
}
