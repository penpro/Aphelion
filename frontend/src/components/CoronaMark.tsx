/** The Penumbra corona-eclipse mark — a glowing ring around a dark moon. Themes
 *  with the active accent. */
export function CoronaMark({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={{ flex: '0 0 auto', filter: 'drop-shadow(0 0 4px var(--accent))' }}
    >
      <circle cx="12" cy="12" r="9" fill="none" stroke="var(--accent)" strokeWidth="4" opacity="0.18" />
      <circle cx="12" cy="12" r="9" fill="none" stroke="var(--accent)" strokeWidth="1.8" />
      <circle cx="12" cy="12" r="6" fill="var(--bg)" />
    </svg>
  )
}
