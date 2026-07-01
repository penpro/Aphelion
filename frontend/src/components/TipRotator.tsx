import { useEffect, useState } from 'react'

// Small rotating helper tips above the sidebar footer menu. Advances on a timer (~5 min) and on
// click. Copy stays accurate to where things actually live: "below" = the footer menu right under it.
const TIPS: string[] = [
  'We ship updates often — open Settings below and hit “Check for updates.”',
  'Lost? Replay the walkthrough anytime with Quick tour, just below.',
  'Give a character portrait sets — named looks, each with its own 8 emotions — in the editor.',
  'Turn on the live portrait in a chat’s Tuning panel and watch expressions follow the scene.',
  'In Ask mode your question is routed to the right expert — or pick one yourself.',
  'It’s all local: once a model is downloaded, Aphelion keeps working with the internet unplugged.',
  'Long chats never overflow — older turns fold into a running “story so far” memory automatically.',
  'Fine-tune the model under Settings → Advanced sampling; every knob has an explainer.',
  'Change the whole look under Settings → Theme — five accent presets to choose from.',
  'Drop reference docs into a chat’s Sources and the model can pull from them as you talk.',
  'Add more characters to a chat with the ＋＋ button to run a group scene.',
]

const ROTATE_MS = 5 * 60 * 1000

export function TipRotator() {
  // Vary the starting tip by wall-clock so it isn't always the same one on launch.
  const [i, setI] = useState(() => Math.floor(Date.now() / ROTATE_MS) % TIPS.length)

  useEffect(() => {
    const t = setInterval(() => setI((n) => (n + 1) % TIPS.length), ROTATE_MS)
    return () => clearInterval(t)
  }, [])

  return (
    <button
      type="button"
      className="side-tip"
      title="Tip — click for another"
      onClick={() => setI((n) => (n + 1) % TIPS.length)}
    >
      <span className="side-tip-icon" aria-hidden="true">
        💡
      </span>
      <span className="side-tip-text" key={i}>
        {TIPS[i]}
      </span>
    </button>
  )
}
