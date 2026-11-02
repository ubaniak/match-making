// Questions in themed antd dialogs, callable from plain event handlers.
// <DialogBridge> (in ui.jsx) hands over the App's modal and message APIs.
import { createElement } from 'react'
import { Input } from 'antd'

let modalApi = null
let messageApi = null

export function connectDialogs(modal, message) {
  modalApi = modal
  messageApi = message
}

// Yes/no question. Resolves true on OK.
export function askConfirm(question, { okText = 'OK', danger = false } = {}) {
  return new Promise((resolve) => {
    modalApi.confirm({
      title: question,
      okText,
      okButtonProps: { danger },
      cancelText: 'Cancel',
      onOk: () => resolve(true),
      onCancel: () => resolve(false),
    })
  })
}

// Question with an optional text answer. Resolves the text (maybe '') on OK, null on Cancel.
export function askText(question, { okText = 'OK', placeholder = 'Optional' } = {}) {
  let text = ''
  return new Promise((resolve) => {
    modalApi.confirm({
      title: question,
      icon: null,
      content: createElement(Input, { autoFocus: true, placeholder, maxLength: 500, onChange: (e) => { text = e.target.value } }),
      okText,
      cancelText: 'Cancel',
      onOk: () => resolve(text),
      onCancel: () => resolve(null),
    })
  })
}

// For steps that can't be undone: OK stays disabled until the exact phrase is typed.
// Resolves true on OK, false on Cancel.
export function askTypedConfirm(question, { phrase, details, okText = 'Delete' } = {}) {
  return new Promise((resolve) => {
    let instance = null
    const matches = (text) => text.trim().toLowerCase() === phrase.trim().toLowerCase()
    const content = createElement('div', null,
      details && createElement('div', { style: { marginBottom: 12 } }, details),
      createElement('p', { style: { marginBottom: 8 } }, 'To confirm, type ', createElement('strong', null, phrase), ' below.'),
      createElement(Input, {
        autoFocus: true,
        'aria-label': `Type ${phrase} to confirm`,
        autoComplete: 'off',
        onChange: (e) => instance?.update({ okButtonProps: { danger: true, disabled: !matches(e.target.value) } }),
      }),
    )
    instance = modalApi.confirm({
      title: question,
      content,
      okText,
      okButtonProps: { danger: true, disabled: true },
      cancelText: 'Cancel',
      onOk: () => resolve(true),
      onCancel: () => resolve(false),
    })
  })
}

export function showError(text) {
  messageApi.error(text)
}

export const dash = (v) => v || '—'
