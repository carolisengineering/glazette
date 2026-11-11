import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { db } from '../db/db'
import { ensureDefaults } from '../db/ops'
import { setSinkForTests } from '../telemetry/telemetry'
import { renderRoute } from '../test/renderRoute'
import { BackupSheet } from './BackupSheet'
import { exportZip } from './export'
import { importZip, NewerBackupError, NotABackupError } from './import'
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

test('a download also records the backup date', async () => {
  vi.mocked(saveFile).mockResolvedValue('downloaded')
  const user = userEvent.setup()
  render(<BackupSheet onClose={() => {}} />)
  await user.click(screen.getByRole('button', { name: 'Save a backup' }))
  await waitFor(async () => expect(await lastBackup()).toBeDefined())
})

test('a blocked share offers Save backup file, which shares the same zip', async () => {
  const zip = new Blob(['x'])
  vi.mocked(exportZip).mockResolvedValue(zip)
  vi.mocked(saveFile).mockResolvedValueOnce('blocked')
  const user = userEvent.setup()
  render(<BackupSheet onClose={() => {}} />)
  await user.click(screen.getByRole('button', { name: 'Save a backup' }))
  const again = await screen.findByRole('button', { name: 'Save backup file' })
  expect(await lastBackup()).toBeUndefined()
  expect(screen.queryByText(/Couldn't save/)).not.toBeInTheDocument()
  expect(
    screen.getByText('Your backup is ready. Tap Save backup file to save it.'),
  ).toBeVisible()

  vi.mocked(saveFile).mockResolvedValueOnce('shared')
  await user.click(again)
  await waitFor(async () => expect(await lastBackup()).toBeDefined())
  expect(exportZip).toHaveBeenCalledTimes(1)
  expect(vi.mocked(saveFile).mock.calls[1][0]).toBe(zip)
  expect(
    await screen.findByRole('button', { name: 'Save a backup' }),
  ).toBeVisible()
})

test('a canceled share from the ready button keeps it', async () => {
  vi.mocked(saveFile)
    .mockResolvedValueOnce('blocked')
    .mockResolvedValueOnce('canceled')
  const user = userEvent.setup()
  render(<BackupSheet onClose={() => {}} />)
  await user.click(screen.getByRole('button', { name: 'Save a backup' }))
  await user.click(
    await screen.findByRole('button', { name: 'Save backup file' }),
  )
  await waitFor(() => expect(saveFile).toHaveBeenCalledTimes(2))
  expect(
    await screen.findByRole('button', { name: 'Save backup file' }),
  ).toBeEnabled()
  expect(await lastBackup()).toBeUndefined()
})

test('Escape does not close the sheet while an action runs', async () => {
  vi.mocked(saveFile).mockReturnValue(new Promise(() => {}))
  const onClose = vi.fn()
  const user = userEvent.setup()
  render(<BackupSheet onClose={onClose} />)
  await user.click(screen.getByRole('button', { name: 'Save a backup' }))
  await user.keyboard('{Escape}')
  expect(onClose).not.toHaveBeenCalled()
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

test('Restore shows "Restored 3 pieces"', async () => {
  vi.mocked(importZip).mockResolvedValue({ added: 9, updated: 1, pieces: 3 })
  const user = userEvent.setup()
  render(<BackupSheet onClose={() => {}} />)
  await pick(user)
  expect(await screen.findByText('Restored 3 pieces')).toBeVisible()
})

test('Restore says "Restored 1 piece" for one', async () => {
  vi.mocked(importZip).mockResolvedValue({ added: 5, updated: 0, pieces: 1 })
  const user = userEvent.setup()
  render(<BackupSheet onClose={() => {}} />)
  await pick(user)
  expect(await screen.findByText('Restored 1 piece')).toBeVisible()
})

test('Restore with nothing new shows "Already up to date"', async () => {
  vi.mocked(importZip).mockResolvedValue({ added: 4, updated: 0, pieces: 0 })
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

test('Restore of a newer backup says it is from a newer version', async () => {
  vi.mocked(importZip).mockRejectedValue(new NewerBackupError())
  const user = userEvent.setup()
  render(<BackupSheet onClose={() => {}} />)
  await pick(user)
  expect(
    await screen.findByText('This backup is from a newer version of Glazette'),
  ).toBeVisible()
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

test('a successful restore clears a kept backup file', async () => {
  vi.mocked(saveFile).mockResolvedValue('blocked')
  vi.mocked(importZip).mockResolvedValue({ added: 5, updated: 0, pieces: 1 })
  const user = userEvent.setup()
  render(<BackupSheet onClose={() => {}} />)
  await user.click(screen.getByRole('button', { name: 'Save a backup' }))
  expect(
    await screen.findByRole('button', { name: 'Save backup file' }),
  ).toBeVisible()
  await pick(user)
  await screen.findByText('Restored 1 piece')
  expect(screen.getByRole('button', { name: 'Save a backup' })).toBeVisible()
})

function captureNames() {
  const names: string[] = []
  setSinkForTests({
    capture: (n) => names.push(n),
    identify: () => {},
    reset: () => {},
    captureException: () => {},
  })
  return names
}

afterEach(() => setSinkForTests(undefined))

test('a canceled save reports nothing', async () => {
  vi.mocked(saveFile).mockResolvedValue('canceled')
  const names = captureNames()
  const user = userEvent.setup()
  render(<BackupSheet onClose={() => {}} />)
  await user.click(screen.getByRole('button', { name: 'Save a backup' }))
  await waitFor(() => expect(saveFile).toHaveBeenCalled())
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Save a backup' })).toBeEnabled(),
  )
  expect(names).toEqual([])
})

test('a finished save and a restore report their events', async () => {
  vi.mocked(saveFile).mockResolvedValue('shared')
  vi.mocked(importZip).mockResolvedValue({ pieces: 1 } as never)
  const names = captureNames()
  const user = userEvent.setup()
  const { container } = render(<BackupSheet onClose={() => {}} />)
  await user.click(screen.getByRole('button', { name: 'Save a backup' }))
  await waitFor(() => expect(names).toEqual(['backup_saved']))
  const input = container.querySelector('input[type=file]') as HTMLInputElement
  await user.upload(
    input,
    new File(['z'], 'b.zip', { type: 'application/zip' }),
  )
  await waitFor(() =>
    expect(names).toEqual(['backup_saved', 'backup_restored']),
  )
})
