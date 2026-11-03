// The welcome email for someone just added (Admin > Users, or an official adding a new official
// to an event), and the notice that offers a ready-made email when it can't be sent.
import { api } from './api'

export const accountAs = { admin: 'an Admin', user: 'a User', official: 'an Official', public: 'a Public account' }

export const siteUrl = () => window.location.origin + import.meta.env.BASE_URL

// Emails someone how to sign in. Never throws: returns { sent } or { sent: false, reason } so the
// page can offer a "send it from your email app" link instead.
export async function sendWelcome(user) {
  try {
    await api.emailNewUser(user.email)
    return { ...user, sent: true }
  } catch (err) {
    return { ...user, sent: false, reason: err.message }
  }
}
