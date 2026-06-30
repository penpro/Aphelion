import { getCurrentWindow } from '@tauri-apps/api/window'

// Edge/corner grips for the frameless window — decorations:false drops native edge-resize on
// Windows, so we re-add it with startResizeDragging on thin invisible strips at the window edges.
const DIRS = [
  ['n', 'North'],
  ['s', 'South'],
  ['e', 'East'],
  ['w', 'West'],
  ['ne', 'NorthEast'],
  ['nw', 'NorthWest'],
  ['se', 'SouthEast'],
  ['sw', 'SouthWest'],
] as const

export function ResizeHandles() {
  return (
    <>
      {DIRS.map(([cls, dir]) => (
        <div
          key={cls}
          className={`resize-h resize-${cls}`}
          onMouseDown={(e) => {
            if (e.button !== 0) return
            getCurrentWindow().startResizeDragging(dir)
          }}
        />
      ))}
    </>
  )
}
