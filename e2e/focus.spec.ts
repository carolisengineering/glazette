import { expect, test } from './helpers'

// Safari's built-in focus ring ignores rounded corners, so fields draw their own solid outline.
test('a focused text field gets a solid accent outline all the way around', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Account, signed out' }).click()
  const email = page.getByRole('textbox', { name: 'Email' })
  await email.click()
  await expect(email).toBeFocused()
  const outline = await email.evaluate((el) => {
    const s = getComputedStyle(el)
    return {
      style: s.outlineStyle,
      width: s.outlineWidth,
      color: s.outlineColor,
    }
  })
  expect(outline).toEqual({
    style: 'solid',
    width: '2px',
    color: 'rgb(23, 84, 116)',
  })
})
