import { useEffect, useMemo, useRef } from 'react'
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, type ViewUpdate } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { search, searchKeymap, openSearchPanel } from '@codemirror/search'
import { bracketMatching, foldGutter, indentOnInput, syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language'
import { oneDark } from '@codemirror/theme-one-dark'
import { ySync, ySyncFacet, yCollab, YSyncConfig } from 'y-codemirror.next'
import * as Y from 'yjs'
import type { Awareness } from 'y-protocols/awareness'

interface MarkdownEditorProps {
  ytext: Y.Text
  awareness: Awareness
  readOnly: boolean
  onReady?: (view: EditorView) => void
  /** Called whenever the local cursor/selection changes (for code block detection) */
  onCursorChange?: (pos: number) => void
}

/**
 * CodeMirror 6 markdown editor bound to a Yjs document via y-codemirror.next.
 * Supports live remote cursors, collaborative undo/redo, search (Ctrl-F),
 * bracket matching, code folding, and line numbers.
 */
export function MarkdownEditor({ ytext, awareness, readOnly, onReady, onCursorChange }: MarkdownEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const undoManager = useMemo(() => new Y.UndoManager(ytext), [ytext])

  // Keep latest callback in a ref so extension identity stays stable
  const cursorCbRef = useRef(onCursorChange)
  cursorCbRef.current = onCursorChange

  const extensions = useMemo(() => {
    // Track local cursor position and broadcast it via awareness so
    // collaborators see where you are working.
    const trackCursor = (update: ViewUpdate) => {
      if (update.selectionSet || update.docChanged) {
        const { head, anchor } = update.state.selection.main
        if (head === anchor) {
          awareness.setLocalStateField('cursor', null)
        } else {
          awareness.setLocalStateField('cursor', {
            anchor: Y.createRelativePositionFromTypeIndex(ytext, anchor),
            head: Y.createRelativePositionFromTypeIndex(ytext, head),
          })
        }
        cursorCbRef.current?.(head)
      }
    }

    return [
      lineNumbers(),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      history(),
      indentOnInput(),
      bracketMatching(),
      foldGutter(),
      search({ top: true }),
      keymap.of([
        ...defaultKeymap,
        ...searchKeymap,
        ...historyKeymap,
        indentWithTab,
        {
          key: 'Ctrl-f',
          mac: 'Cmd-f',
          run: (view) => {
            openSearchPanel(view)
            return true
          },
        },
        {
          key: 'Ctrl-Enter',
          mac: 'Cmd-Enter',
          run: () => {
            // Dispatch a custom event for "run code" — the Room page listens for this
            window.dispatchEvent(new CustomEvent('collabmd:run-code'))
            return true
          },
        },
      ]),
      markdown(),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      oneDark,
      // Yjs collaborative binding (sync + remote cursors + undo)
      ySyncFacet.of(new YSyncConfig(ytext, awareness)),
      ySync,
      yCollab(ytext, awareness, { undoManager }),
      EditorView.lineWrapping,
      EditorState.readOnly.of(readOnly),
      EditorView.editable.of(!readOnly),
      EditorView.updateListener.of(trackCursor),
      EditorView.theme({
        '&': { height: '100%', backgroundColor: 'transparent' },
        '.cm-scroller': { overflow: 'auto' },
        '.cm-content': { padding: '12px 0', caretColor: '#60a5fa' },
        // Remote cursor styles
        '.cm-ySelection': {
          backgroundColor: 'rgba(255, 255, 255, 0.06) !important',
        },
        '.cm-ySelectionCaret': {
          borderLeftWidth: '2px !important',
        },
        '.cm-ySelectionInfo': {
          fontSize: '10px !important',
          padding: '1px 5px !important',
          borderRadius: '3px !important',
          color: '#fff !important',
          fontFamily: "'Inter', system-ui, sans-serif !important",
          top: '-1.5em !important',
          opacity: '0.95',
        },
      }),
    ]
  }, [ytext, awareness, readOnly, undoManager])

  useEffect(() => {
    if (!containerRef.current) return

    const state = EditorState.create({
      doc: ytext.toString(),
      extensions,
    })

    const view = new EditorView({
      state,
      parent: containerRef.current,
    })
    viewRef.current = view
    onReady?.(view)

    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, [ytext, extensions])

  return <div ref={containerRef} className="h-full w-full overflow-hidden" />
}
