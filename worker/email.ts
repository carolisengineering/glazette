import type { Env } from './env'

// Delivers a sign-in code. Throws if the code could not be sent.
export type SendCode = (to: string, code: string) => Promise<void>

export function resendSender(env: Env): SendCode {
  return async (to, code) => {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Glazette <onboarding@resend.dev>',
        to: [to],
        subject: 'Your Glazette code',
        text: `Your Glazette sign-in code is ${code}. It expires in 5 minutes.`,
      }),
    })
    if (!res.ok) {
      throw new Error(
        `Resend refused the email: ${res.status} ${await res.text()}`,
      )
    }
  }
}
