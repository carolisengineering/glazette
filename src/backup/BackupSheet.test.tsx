import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { db } from '../db/db'
import { ensureDefaults } from '../db/ops'
import { renderRoute } from '../test/renderRoute'
import { BackupSheet } from './BackupSheet'
import { exportZip } from './export'
import { importZip, NotABackupError } from './import'
import { saveFile } from './saveFile'

vi.mock('./export', async (orig) => ({
  ...(await orig<typeof import('./export')>()),
  exportZip: vi.fn(),
}))
vi.mock('./import', async (orig) => ({
  ...(await orig<typeof import('./import')>()),
  importZip: vi.fn(),
}))
vi.mock('./saveFile', () => ({ saveFile: vi.fn() }))

beforeEach(async () => {
  vi.mocked(exportZip)
    .mockReset()
    .mockResolvedValue(new Blob(['x']))
  vi.mocked(importZip).mockReset()
  vi.mocked(saveFile).mockReset()
  await db.delete()
  await db.open()
  await ensureDefaults()
})

const lastBackup = async () => (await db.settings.get('app'))?.lastBackupAt

test('the gear opens the Backup sheet and Escape closes it', async () => {
  const user = userEvent.setup()
  renderRoute('/')
  await user.click(await screen.findByRole('button', { name: 'Backup' }))
  expect(screen.getByRole('dialog', { name: 'Backup' })).toBeVisible()
  expect(screen.getByText('No backup yet')).toBeVisible()
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

test('Save a backup shares the zip and records the backup date', async () => {
  vi.mocked(saveFile).mockResolvedValue('shared')
  const user = userEvent.setup()
  render(<BackupSheet onClose={() => {}} />)
  await user.click(screen.getByRole('button', { name: 'Save a backup' }))
  await waitFor(async () => expect(await lastBackup()).toBeDefined())
  expect(saveFile).toHaveBeenCalledWith(
    expect.any(Blob),
    expect.stringMatching(/^glazette-\d{4}-\d{2}-\d{2}\.zip$/),
  )
  expect(await screen.findByText(/^Last backup: /)).toBeVisible()
})

test('a canceled share does not record a backup date', async () => {
  vi.mocked(saveFile).mockResolvedValue('canceled')
  const user = userEvent.setup()
  render(<BackupSheet onClose={() => {}} />)
  await user.click(screen.getByRole('button', { name: 'Save a backup' }))
  await waitFor(() => expect(saveFile).toHaveBeenCalled())
  expect(await lastBackup()).toBeUndefined()
  expect(screen.getByText('No backup yet')).toBeVisible()
})

test('a failed save shows the save error', async () => {
  vi.mocked(saveFile).mockRejectedValue(new Error('boom'))
  const user = userEvent.setup()
  render(<BackupSheet onClose={() => {}} />)
  await user.click(screen.getByRole('button', { name: 'Save a backup' }))
  expect(await screen.findByText(/Couldn't save/)).toBeVisible()
})

const pick = async (user: ReturnType<typeof userEvent.setup>) => {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement
  await user.upload(
    input,
    new File(['z'], 'b.zip', { type: 'application/zip' }),
  )
}

test('Restore shows "Restored 3 items"', async () => {
  vi.mocked(importZip).mockResolvedValue({ added: 2, updated: 1 })
  const user = userEvent.setup()
  render(<BackupSheet onClose={() => {}} />)
  await pick(user)
  expect(await screen.findByText('Restored 3 items')).toBeVisible()
})

test('Restore says "Restored 1 item" for one', async () => {
  vi.mocked(importZip).mockResolvedValue({ added: 1, updated: 0 })
  const user = userEvent.setup()
  render(<BackupSheet onClose={() => {}} />)
  await pick(user)
  expect(await screen.findByText('Restored 1 item')).toBeVisible()
})

test('Restore with nothing new shows "Already up to date"', async () => {
  vi.mocked(importZip).mockResolvedValue({ added: 0, updated: 0 })
  const user = userEvent.setup()
  render(<BackupSheet onClose={() => {}} />)
  await pick(user)
  expect(await screen.findByText('Already up to date')).toBeVisible()
})

test('Restore of a non-backup shows "This isn\'t a Glazette backup"', async () => {
  vi.mocked(importZip).mockRejectedValue(new NotABackupError())
  const user = userEvent.setup()
  render(<BackupSheet onClose={() => {}} />)
  await pick(user)
  expect(await screen.findByText("This isn't a Glazette backup")).toBeVisible()
})

test('Restore failing otherwise shows the save error', async () => {
  vi.mocked(importZip).mockRejectedValue(new Error('boom'))
  const user = userEvent.setup()
  render(<BackupSheet onClose={() => {}} />)
  await pick(user)
  expect(await screen.findByText(/Couldn't save/)).toBeVisible()
})

test('both buttons are disabled while an action runs', async () => {
  let release: (v: 'shared') => void = () => {}
  vi.mocked(saveFile).mockReturnValue(new Promise((r) => (release = r)))
  const user = userEvent.setup()
  render(<BackupSheet onClose={() => {}} />)
  await user.click(screen.getByRole('button', { name: 'Save a backup' }))
  expect(screen.getByRole('button', { name: 'Save a backup' })).toBeDisabled()
  expect(
    screen.getByRole('button', { name: 'Restore from a backup' }),
  ).toBeDisabled()
  release('shared')
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Save a backup' })).toBeEnabled(),
  )
})
