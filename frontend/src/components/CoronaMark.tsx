/** The Penumbra/Aphelion corona-eclipse mark — a luminous cyan→violet→magenta
 *  ring around a black void, orbited by a lone planet at its aphelion (far vertex).
 *  The orbit + planet only render at larger sizes (>=40px); below that they can't
 *  read, so per the brand minimum-size rule the mark falls back to the ring alone
 *  (e.g. the 20px title-bar mark). The gradient is fixed brand identity and
 *  intentionally does NOT follow the theme accent. */
export function CoronaMark({ size = 22 }: { size?: number }) {
  const showOrbit = size >= 40
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
        <radialGradient id="cm-planet" cx="38%" cy="34%" r="72%">
          <stop offset="0%" stopColor="#FFE6F5" />
          <stop offset="45%" stopColor="#FF79C6" />
          <stop offset="100%" stopColor="#C084FC" />
        </radialGradient>
        <filter id="cm-soft" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="9" />
        </filter>
        <filter id="cm-halo" x="-120%" y="-120%" width="340%" height="340%">
          <feGaussianBlur stdDeviation="5" />
        </filter>
      </defs>
      {showOrbit && (
        <g transform="rotate(-22 128 128)">
          <ellipse cx="128" cy="128" rx="108" ry="86" fill="none" stroke="url(#cm-ring)" strokeWidth="2.4" opacity="0.3" />
          <ellipse cx="128" cy="128" rx="108" ry="86" fill="none" stroke="url(#cm-ring)" strokeWidth="1.3" opacity="0.7" />
          <circle cx="236" cy="128" r="16" fill="#FF79C6" opacity="0.5" filter="url(#cm-halo)" />
          <circle cx="236" cy="128" r="7" fill="url(#cm-planet)" />
          <circle cx="233" cy="125" r="2" fill="#FFFFFF" opacity="0.9" />
        </g>
      )}
      <circle cx="128" cy="128" r="86" fill="url(#cm-bloom)" filter="url(#cm-soft)" />
      <circle cx="128" cy="128" r="72" fill="none" stroke="url(#cm-ring)" strokeWidth="20" filter="url(#cm-soft)" opacity="0.85" />
      <circle cx="128" cy="128" r="70" fill="#000000" />
      <circle cx="128" cy="128" r="71" fill="none" stroke="url(#cm-ring)" strokeWidth="6" />
      <circle cx="128" cy="128" r="71" fill="none" stroke="#ECFEFF" strokeWidth="1.4" opacity="0.9" />
    </svg>
  )
}
