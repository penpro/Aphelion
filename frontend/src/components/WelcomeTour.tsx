import { useState } from 'react'
import type { ReactNode } from 'react'
import { CoronaMark } from './CoronaMark'
import { cx } from '../util'

// First-run welcome tour: a stepped, on-brand overlay that introduces what Aphelion can do.
// Feature-oriented (vs. the "How it works" architecture modal, which it links to on the last step).
// Auto-shows once; the "Don't show this again" checkbox controls whether it returns next launch.
export function WelcomeTour({
  onClose,
  onOpenArchitecture,
}: {
  onClose: (dontShowAgain: boolean) => void
  onOpenArchitecture: () => void
}) {
  const [i, setI] = useState(0)
  const [dontShow, setDontShow] = useState(true)

  const steps: { icon: ReactNode; title: string; body: ReactNode }[] = [
    {
      icon: <CoronaMark size={76} />,
      title: 'Welcome to Aphelion',
      body: 'A private AI studio that runs entirely on your own machine — roleplay characters, an expert assistant, and story tools, all powered by a model on your GPU. Nothing you type ever leaves this PC.',
    },
    {
      icon: '🎛️',
      title: 'Pick a mode up top',
      body: 'The bar along the top switches between Chat (roleplay with your characters), Ask (a routed expert assistant), Story, and Tree. Your engine status, loaded model, and VRAM sit on the right, so you always know what’s running.',
    },
    {
      icon: '🎭',
      title: 'Characters that come alive',
      body: 'Build a character from scratch or generate one from a single line. Give them portrait sets — named looks like “Hair up” or “Nightfall,” each with eight emotions — and switch on the live portrait so their expression follows the mood of the scene.',
    },
    {
      icon: '🧭',
      title: 'Ask the right expert',
      body: 'In Ask mode your question is quietly routed to a tuned expert — Code, Photography, Writing, and more — or you can choose one yourself. It’s the same local model, wearing the right hat.',
    },
    {
      icon: '🔒',
      title: 'Yours, and private',
      body: (
        <>
          Models, samplers, and updates all live in <b>Settings</b>. Everything runs offline through the bundled
          engine — once a model is downloaded you can unplug the network and it keeps working.{' '}
          <button
            type="button"
            className="welcome-arch"
            onClick={() => {
              onClose(dontShow)
              onOpenArchitecture()
            }}
          >
            See how Aphelion works ↗
          </button>
        </>
      ),
    },
  ]

  const last = i === steps.length - 1
  const step = steps[i]

  return (
    <div className="welcome-overlay" role="dialog" aria-modal="true" aria-label="Welcome to Aphelion">
      <div className="welcome-card">
        <div className="welcome-hero">
          {typeof step.icon === 'string' ? (
            <span className="welcome-step-icon" aria-hidden="true">
              {step.icon}
            </span>
          ) : (
            step.icon
          )}
        </div>

        <h2 className="welcome-title">{step.title}</h2>
        <div className="welcome-body">{step.body}</div>

        <div className="welcome-dots" role="tablist" aria-label="Tour steps">
          {steps.map((s, n) => (
            <button
              key={n}
              type="button"
              className={cx('welcome-dot', n === i && 'sel')}
              aria-label={`Step ${n + 1} of ${steps.length}`}
              aria-selected={n === i}
              onClick={() => setI(n)}
            />
          ))}
        </div>

        <label className="welcome-dsa">
          <input type="checkbox" checked={dontShow} onChange={(e) => setDontShow(e.target.checked)} />
          Don’t show this again
        </label>

        <div className="welcome-actions">
          <button className="btn ghost sm" onClick={() => onClose(dontShow)}>
            Skip
          </button>
          <div className="grow" />
          {i > 0 && (
            <button className="btn ghost sm" onClick={() => setI((n) => n - 1)}>
              Back
            </button>
          )}
          {last ? (
            <button className="btn sm" onClick={() => onClose(dontShow)}>
              Get started
            </button>
          ) : (
            <button className="btn sm" onClick={() => setI((n) => n + 1)}>
              Next
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
