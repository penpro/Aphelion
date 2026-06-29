/** The Penumbra/Aphelion corona-eclipse mark — a luminous cyan→violet→magenta
 *  ring around a black void. The orbiting planet is dropped at small sizes per
 *  the brand minimum-size rule (<28px). The gradient is fixed brand identity and
 *  intentionally does NOT follow the theme accent. */
export function CoronaMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" aria-hidden="true" style={{ flex: '0 0 auto' }}>
      <defs>
        <linearGradient id="cm-ring" x1="0.12" y1="0.1" x2="0.9" y2="0.92">
          <stop offset="0%" stopColor="#22D3EE" />
          <stop offset="34%" stopColor="#5EEAD4" />
          <stop offset="62%" stopColor="#C084FC" />
          <stop offset="100%" stopColor="#FF79C6" />
        </linearGradient>
        <radialGradient id="cm-bloom" cx="50%" cy="50%" r="50%">
          <stop offset="62%" stopColor="#22D3EE" stopOpacity="0" />
          <stop offset="82%" stopColor="#5EEAD4" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#C084FC" stopOpacity="0" />
        </radialGradient>
        <filter id="cm-soft" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="9" />
        </filter>
      </defs>
      <circle cx="128" cy="128" r="86" fill="url(#cm-bloom)" filter="url(#cm-soft)" />
      <circle cx="128" cy="128" r="72" fill="none" stroke="url(#cm-ring)" strokeWidth="20" filter="url(#cm-soft)" opacity="0.85" />
      <circle cx="128" cy="128" r="70" fill="#000000" />
      <circle cx="128" cy="128" r="71" fill="none" stroke="url(#cm-ring)" strokeWidth="6" />
      <circle cx="128" cy="128" r="71" fill="none" stroke="#ECFEFF" strokeWidth="1.4" opacity="0.9" />
    </svg>
  )
}
