import { ask } from './ask.js'

export function buildToolbar(root, editor, upload) {
  const run = () => editor.chain().focus()
  // [label, tooltip, action, isActive?, isEnabled?]
  const heading = (level) => [`H${level}`, `Heading ${level}`,
    () => run().toggleHeading({ level }).run(), () => editor.isActive('heading', { level })]
  const mark = (label, tip, name, command) => [label, tip, () => run()[command]().run(), () => editor.isActive(name)]
  const align = (label, value) => [label, `Align ${value}`,
    () => run().setTextAlign(value).run(), () => editor.isActive({ textAlign: value })]
  const inTable = () => editor.isActive('table')

  const items = [
    ['↶', 'Undo', () => run().undo().run()],
    ['↷', 'Redo', () => run().redo().run()],
    mark('B', 'Bold', 'bold', 'toggleBold'),
    mark('I', 'Italic', 'italic', 'toggleItalic'),
    mark('U', 'Underline', 'underline', 'toggleUnderline'),
    mark('S', 'Strikethrough', 'strike', 'toggleStrike'),
    mark('Mark', 'Highlight', 'highlight', 'toggleHighlight'),
    heading(1), heading(2), heading(3),
    mark('• List', 'Bulleted list', 'bulletList', 'toggleBulletList'),
    mark('1. List', 'Numbered list', 'orderedList', 'toggleOrderedList'),
    mark('☑ Tasks', 'Checklist', 'taskList', 'toggleTaskList'),
    ['⇥', 'Indent list item', () => run().sinkListItem(editor.isActive('taskItem') ? 'taskItem' : 'listItem').run()],
    ['⇤', 'Outdent list item', () => run().liftListItem(editor.isActive('taskItem') ? 'taskItem' : 'listItem').run()],
    mark('❝ Quote', 'Quote', 'blockquote', 'toggleBlockquote'),
    mark('</>', 'Inline code', 'code', 'toggleCode'),
    mark('Code block', 'Code block', 'codeBlock', 'toggleCodeBlock'),
    align('Left', 'left'), align('Center', 'center'), align('Right', 'right'),
    ['Link', 'Add or remove a link', async () => {
      const old = editor.getAttributes('link').href ?? ''
      const input = await ask('Link address (leave empty to remove)', old)
      if (input === null) return
      const text = input.trim()
      if (!text) return run().extendMarkRange('link').unsetLink().run()
      const href = /^([a-z][a-z0-9+.-]*:|\/)/i.test(text) ? text : `https://${text}`
      if (editor.state.selection.empty && !old) {
        run().insertContent({ type: 'text', text, marks: [{ type: 'link', attrs: { href } }] }).run()
      } else {
        run().extendMarkRange('link').setLink({ href }).run()
      }
    }, () => editor.isActive('link')],
    ['🖼 Photo', 'Upload a photo from this device or camera', upload.image],
    ['📎 File', 'Attach a file from this device', upload.file],
    ['▦ Table', 'Insert table', () => run().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()],
    ['+ Row', 'Add row', () => run().addRowAfter().run(), null, inTable],
    ['+ Col', 'Add column', () => run().addColumnAfter().run(), null, inTable],
    ['− Row', 'Delete row', () => run().deleteRow().run(), null, inTable],
    ['− Col', 'Delete column', () => run().deleteColumn().run(), null, inTable],
    ['✕ Table', 'Delete table', () => run().deleteTable().run(), null, inTable],
    ['― Line', 'Divider', () => run().setHorizontalRule().run()],
    ['Clear', 'Clear formatting', () => run().unsetAllMarks().clearNodes().run()],
  ]

  const buttons = items.map(([label, tip, action, active, enabled]) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = label
    b.title = tip
    b.setAttribute('aria-label', tip)
    // Keep the text selection (and the phone keyboard) when tapping a tool.
    b.addEventListener('mousedown', (e) => e.preventDefault())
    b.addEventListener('click', action)
    root.append(b)
    return { b, active, enabled }
  })

  const color = document.createElement('input')
  color.type = 'color'
  color.title = 'Text color'
  color.setAttribute('aria-label', 'Text color')
  color.addEventListener('input', () => run().setColor(color.value).run())
  root.insertBefore(color, buttons[7].b)

  return () => {
    for (const { b, active, enabled } of buttons) {
      if (active) b.setAttribute('aria-pressed', String(active()))
      if (enabled) b.hidden = !enabled()
    }
  }
}
