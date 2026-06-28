// Heuristic detection of *new* character names referenced in a message.
// Not perfect (regex over prose), but cheap and instant; the user only acts on
// the real ones. Generation of the actual card happens on click.

const STOP = new Set([
  // pronouns / articles / conjunctions / prepositions
  'I', 'A', 'An', 'The', 'But', 'And', 'Or', 'Nor', 'So', 'Yet', 'For',
  'He', 'She', 'They', 'We', 'You', 'It', 'This', 'That', 'These', 'Those',
  'His', 'Her', 'Hers', 'Their', 'Theirs', 'Our', 'Ours', 'My', 'Mine', 'Your', 'Yours', 'Its',
  'What', 'Who', 'Whom', 'Whose', 'When', 'Where', 'Why', 'How', 'Which',
  'If', 'As', 'At', 'In', 'On', 'Of', 'To', 'By', 'Up', 'Out', 'Off', 'With', 'From', 'About', 'Into', 'Onto', 'Over', 'Under', 'After', 'Before', 'While', 'Because', 'Though', 'Although', 'Until', 'Since',
  // common sentence-starters / interjections / adverbs
  'Yes', 'No', 'Not', 'Maybe', 'Perhaps', 'Okay', 'Oh', 'Ah', 'Hey', 'Well', 'Just', 'Like', 'Look', 'Listen', 'Wait', 'Come', 'Go', 'Stop', 'Please', 'Thanks', 'Thank',
  'Suddenly', 'Meanwhile', 'Later', 'Finally', 'Instead', 'Still', 'Even', 'Once', 'Soon', 'Then', 'Now', 'Here', 'There', 'Always', 'Never', 'Maybe', 'Perhaps', 'Indeed', 'Surely', 'Of course',
  // time
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December',
  'Today', 'Tonight', 'Tomorrow', 'Yesterday',
])

export function detectReferences(text: string, known: string[]): string[] {
  if (!text) return []
  const knownSet = new Set(known.filter(Boolean).map((k) => k.toLowerCase()))
  const out = new Set<string>()
  const re = /([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]+)*)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const name = m[1].trim()
    const first = name.split(/\s+/)[0]
    const isMultiWord = /\s/.test(name)

    // Skip lone capitalized words at a sentence start — those are usually just
    // sentence starters ("Most people…", "Eat.", "Have…"), not names. Names that
    // matter almost always also appear mid-sentence or as a multi-word name.
    if (!isMultiWord) {
      let j = m.index - 1
      while (j >= 0 && /[\s"'(*_>~\-]/.test(text[j])) j--
      const prev = j >= 0 ? text[j] : ''
      if (prev === '' || '.!?:;\n'.includes(prev)) continue
    }

    if (STOP.has(first) || STOP.has(name)) continue
    if (knownSet.has(name.toLowerCase()) || knownSet.has(first.toLowerCase())) continue
    out.add(name)
    if (out.size >= 4) break
  }
  return [...out]
}
