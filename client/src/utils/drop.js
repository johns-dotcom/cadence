// Spread onto any element to make it a drag-and-drop file target. Calls
// onFile(file) with the first dropped file. Pairs with an existing click-to-pick
// input so every upload point supports both.
//   <label {...dropTarget(uploadFn)}> … <input type="file" … /></label>
export const dropTarget = (onFile) => ({
  onDragOver: (e) => { e.preventDefault() },
  onDrop: (e) => {
    e.preventDefault()
    const f = e.dataTransfer?.files?.[0]
    if (f) onFile(f)
  },
})
