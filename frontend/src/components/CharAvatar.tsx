// One avatar tile, used everywhere a character appears. Renders the portrait image when the
// character has one; otherwise the emoji glyph on the character's accent color (the original look).
import { portraitSrc } from '../portraits'

export function CharAvatar({
  avatar,
  color,
  portrait,
  name,
  small,
}: {
  avatar: string
  color: string
  portrait?: string
  name?: string
  small?: boolean
}) {
  const cls = 'msg-avatar' + (small ? ' sm' : '')
  if (portrait) {
    return (
      <div className={cls + ' has-portrait'}>
        <img src={portraitSrc(portrait)} alt={name ?? ''} draggable={false} />
      </div>
    )
  }
  return (
    <div className={cls} style={{ background: color }}>
      {avatar}
    </div>
  )
}
