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

export function showError(text) {
  messageApi.error(text)
}

export const dash = (v) => v || '—'
