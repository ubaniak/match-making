import { Alert } from 'antd'
import { accountAs, siteUrl } from './welcome'

// The result of a welcome email, with a filled-in email to send by hand when it couldn't be sent.
export default function WelcomeNotice({ welcome, onDismiss }) {
  if (!welcome) return null
  const who = welcome.name || welcome.email
  if (welcome.sent) {
    return <Alert className="gap" type="info" showIcon closable={{ onClose: onDismiss }} title={`We emailed ${who} how to sign in.`} />
  }
  const body = [
    `Hi ${welcome.name || ''},`.trim(),
    '',
    `You've been added to Match Making as ${accountAs[welcome.roleId] ?? 'a User'}.`,
    '',
    `To sign in, open ${siteUrl()} and enter this email address (${welcome.email}). You'll get a 6-digit code by email to type in. There's no password.`,
  ].join('\n')
  const mailto = `mailto:${encodeURIComponent(welcome.email)}?subject=${encodeURIComponent('You\'ve been added to Match Making')}&body=${encodeURIComponent(body)}`
  return (
    <Alert
      className="gap"
      type="warning"
      showIcon
      closable={{ onClose: onDismiss }}
      title={<>The email to {who} wasn't sent automatically ({welcome.reason}). <a href={mailto}>Send it from your email app</a></>}
    />
  )
}
