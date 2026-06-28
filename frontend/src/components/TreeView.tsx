import { useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import { generateDialogueNode, type PathStep } from '../generators'
import { download, cx, uid } from '../util'
import type { DialogueNode, DialogueOption } from '../types'

function slug(s: string): string {
  return s.replace(/[^\w-]+/g, '_').slice(0, 60) || 'dialogue'
}

function estimateNodes(depth: number, breadth: number): number {
  let total = 0
  for (let d = 0; d <= depth; d++) total += Math.pow(breadth, d)
  return total
}

function NodeView({
  nodes,
  id,
  color,
}: {
  nodes: Record<string, DialogueNode>
  id: string
  color: string
}) {
  const node = nodes[id]
  if (!node) return null
  return (
    <div className="tnode">
      <div className="tnode-line">
        <span className="tnode-npc" style={{ color }}>
          {node.speaker}:
        </span>{' '}
        {node.line}
      </div>
      {node.options.length > 0 && (
        <ul className="topts">
          {node.options.map((o: DialogueOption, i: number) => (
            <li key={i}>
              <div className="topt">▸ {o.text}</div>
              {o.next ? <NodeView nodes={nodes} id={o.next} color={color} /> : <div className="tend">— ends —</div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

const CAP = 80

export function TreeView() {
  const trees = useStore((s) => s.trees)
  const characters = useStore((s) => s.characters)
  const activeTreeId = useStore((s) => s.activeTreeId)
  const settings = useStore((s) => s.settings)
  const createTree = useStore((s) => s.createTree)
  const updateTree = useStore((s) => s.updateTree)
  const deleteTree = useStore((s) => s.deleteTree)
  const resetTree = useStore((s) => s.resetTree)
  const setTreeRoot = useStore((s) => s.setTreeRoot)
  const upsertNode = useStore((s) => s.upsertNode)

  const [busy, setBusy] = useState(false)
  const [count, setCount] = useState(0)
  const [error, setError] = useState('')
  const abortRef = useRef<AbortController | null>(null)

  const tree = useMemo(() => trees.find((t) => t.id === activeTreeId) ?? null, [trees, activeTreeId])

  if (!tree) {
    return (
      <div className="chat empty-state">
        <div>
          <h1>🌳 Dialogue Tree</h1>
          <p className="muted">Generate a branching NPC conversation that branches on the player's choices — exportable for a game.</p>
          <button
            className="btn"
            onClick={() => createTree({ title: 'Untitled dialogue', premise: '', characterId: null, npcName: 'NPC', maxDepth: 2, maxBreadth: 3 })}
          >
            + New dialogue tree
          </button>
        </div>
      </div>
    )
  }

  const npc = tree.characterId ? (characters.find((c) => c.id === tree.characterId) ?? null) : null
  const npcColor = npc?.color ?? '#7c5cff'
  const nodeCount = Object.keys(tree.nodes).length

  const run = async () => {
    setError('')
    if (!tree.premise.trim()) return setError('Describe the situation first.')
    const name = npc?.name || tree.npcName || 'NPC'

    resetTree(tree.id)
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setBusy(true)
    setCount(0)
    try {
      const rootId = uid()
      setTreeRoot(tree.id, rootId)
      const queue: { id: string; depth: number; path: PathStep[] }[] = [{ id: rootId, depth: 0, path: [] }]
      let made = 0
      while (queue.length && made < CAP) {
        if (ctrl.signal.aborted) break
        const { id, depth, path } = queue.shift()!
        const isLeaf = depth >= tree.maxDepth
        const { line, options } = await generateDialogueNode(
          npc,
          name,
          tree.premise,
          path,
          { isLeaf, maxBreadth: tree.maxBreadth },
          settings,
          ctrl.signal,
        )
        const nodeOptions: DialogueOption[] = []
        if (!isLeaf) {
          for (const opt of options) {
            if (made + queue.length >= CAP) break
            const childId = uid()
            nodeOptions.push({ text: opt, next: childId })
            queue.push({ id: childId, depth: depth + 1, path: [...path, { line, choice: opt }] })
          }
        }
        upsertNode(tree.id, { id, speaker: name, line, options: nodeOptions, depth })
        made++
        setCount(made)
      }
    } catch (e) {
      const err = e as { name?: string; message?: string }
      if (err?.name !== 'AbortError') setError(err?.message ?? 'Generation failed.')
    } finally {
      setBusy(false)
      abortRef.current = null
    }
  }

  const exportJSON = () => {
    const nodes: Record<string, unknown> = {}
    for (const n of Object.values(tree.nodes)) {
      nodes[n.id] = { id: n.id, speaker: n.speaker, line: n.line, options: n.options.map((o) => ({ text: o.text, next: o.next })) }
    }
    const data = {
      format: 'localllm-dialogue-tree@1',
      title: tree.title,
      premise: tree.premise,
      npc: npc?.name || tree.npcName,
      root: tree.rootId,
      nodes,
    }
    download(`${slug(tree.title)}.dialogue.json`, JSON.stringify(data, null, 2), 'application/json')
  }

  return (
    <div className="chat">
      <header className="chat-head">
        <input className="title-input" value={tree.title} onChange={(e) => updateTree(tree.id, { title: e.target.value })} />
        <div className="row gap">
          <button className="btn sm ghost" onClick={exportJSON} disabled={!tree.rootId}>
            Export JSON
          </button>
          <button className="btn sm ghost danger" onClick={() => confirm('Delete this dialogue tree?') && deleteTree(tree.id)}>
            Delete
          </button>
        </div>
      </header>

      <div className="messages">
        <div className="setup-card">
          <div className="row gap wrap">
            <label className="field grow">
              <span>NPC name</span>
              <input value={tree.npcName} onChange={(e) => updateTree(tree.id, { npcName: e.target.value })} />
            </label>
            <label className="field grow">
              <span>Base on character (optional, for personality)</span>
              <select
                value={tree.characterId ?? ''}
                onChange={(e) => {
                  const id = e.target.value || null
                  const ch = id ? characters.find((c) => c.id === id) : null
                  updateTree(tree.id, { characterId: id, npcName: ch ? ch.name : tree.npcName })
                }}
              >
                <option value="">— none —</option>
                {characters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="field">
            <span>Situation</span>
            <textarea
              value={tree.premise}
              rows={2}
              placeholder="e.g. The player approaches the gate guard who is hiding that he let an assassin through."
              onChange={(e) => updateTree(tree.id, { premise: e.target.value })}
            />
          </label>

          <div className="row gap wrap">
            <label className="field">
              <span>Depth (NPC lines deep)</span>
              <input
                type="number"
                min={1}
                max={4}
                value={tree.maxDepth}
                onChange={(e) => updateTree(tree.id, { maxDepth: Math.max(1, Math.min(4, Number(e.target.value))) })}
                className="num-input"
              />
            </label>
            <label className="field">
              <span>Branches per node</span>
              <input
                type="number"
                min={2}
                max={4}
                value={tree.maxBreadth}
                onChange={(e) => updateTree(tree.id, { maxBreadth: Math.max(2, Math.min(4, Number(e.target.value))) })}
                className="num-input"
              />
            </label>
            <div className="field">
              <span>Est. nodes (= calls)</span>
              <div className="estimate">~{Math.min(CAP, estimateNodes(tree.maxDepth, tree.maxBreadth))}</div>
            </div>
          </div>

          <div className="row gap">
            {busy ? (
              <button className="btn stop" onClick={() => abortRef.current?.abort()}>
                ■ Stop ({count} nodes)
              </button>
            ) : (
              <button className="btn" onClick={run}>
                {tree.rootId ? '↻ Regenerate tree' : '▶ Generate tree'}
              </button>
            )}
            {busy && <span className="muted sm">generating node {count}…</span>}
            {!busy && nodeCount > 0 && <span className="muted sm">{nodeCount} nodes</span>}
          </div>
          {error && <div className="error-line">{error}</div>}
        </div>

        <div className="tree-wrap">
          {tree.rootId && tree.nodes[tree.rootId] ? (
            <NodeView nodes={tree.nodes} id={tree.rootId} color={npcColor} />
          ) : (
            !busy && <div className="muted pad">No tree yet — set the situation and click Generate.</div>
          )}
        </div>
      </div>
    </div>
  )
}
