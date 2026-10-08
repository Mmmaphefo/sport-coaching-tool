// AI assistance: drafted with Claude (Sonnet 5) via claude.ai; reviewed and tested by the project team.
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import ConfirmProvider from './ConfirmProvider'
import { useConfirm } from '../lib/confirm'

// Small harness: renders a button that asks for confirmation and records the
// answer, so the dialog's promise contract can be asserted directly.
function Harness({ options, onAnswer }) {
  const confirm = useConfirm()
  return (
    <button type="button" onClick={() => confirm(options).then(onAnswer)}>
      Ask
    </button>
  )
}

function renderHarness(options, onAnswer = vi.fn()) {
  render(
    <ConfirmProvider>
      <Harness options={options} onAnswer={onAnswer} />
    </ConfirmProvider>
  )
  return onAnswer
}

describe('ConfirmProvider', () => {
  it('renders the supplied copy and resolves true on confirm', async () => {
    const onAnswer = renderHarness({
      title: 'Remove athlete',
      message: 'Remove this athlete from the roster?',
      confirmLabel: 'Remove',
      tone: 'danger',
    })

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))

    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('Remove athlete')).toBeInTheDocument()
    expect(within(dialog).getByText('Remove this athlete from the roster?')).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }))

    await waitFor(() => expect(onAnswer).toHaveBeenCalledWith(true))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('resolves false when the cancel button is used', async () => {
    const onAnswer = renderHarness({ message: 'End this event?' })

    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))

    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('Are you sure?')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Confirm' })).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(onAnswer).toHaveBeenCalledWith(false))
  })

  it('treats the Escape key and a backdrop click as cancelling', async () => {
    const onAnswer = renderHarness({ message: 'Undo this log entry?' })

    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
    fireEvent.keyDown(window, { key: 'Escape' })

    await waitFor(() => expect(onAnswer).toHaveBeenCalledWith(false))

    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
    fireEvent.click(await screen.findByTestId('confirm-backdrop'))

    await waitFor(() => expect(onAnswer).toHaveBeenCalledTimes(2))
    expect(onAnswer).toHaveBeenLastCalledWith(false)
  })

  it('answers an open dialog false when a second confirm replaces it', async () => {
    const first = vi.fn()
    const second = vi.fn()

    render(
      <ConfirmProvider>
        <Harness options={{ message: 'First question?' }} onAnswer={first} />
        <Harness options={{ message: 'Second question?' }} onAnswer={second} />
      </ConfirmProvider>
    )

    const [firstAsk, secondAsk] = screen.getAllByRole('button', { name: 'Ask' })

    fireEvent.click(firstAsk)
    await screen.findByRole('alertdialog')

    fireEvent.click(secondAsk)

    await waitFor(() => expect(first).toHaveBeenCalledWith(false))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('Second question?')).toBeInTheDocument()
    expect(second).not.toHaveBeenCalled()
  })

  it('falls back to window.confirm when no provider is mounted', async () => {
    const stub = vi.fn(() => true)
    vi.stubGlobal('confirm', stub)
    const onAnswer = vi.fn()

    render(<Harness options={{ message: 'Remove this athlete from the roster?' }} onAnswer={onAnswer} />)

    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))

    await waitFor(() => expect(stub).toHaveBeenCalledWith('Remove this athlete from the roster?'))
    await waitFor(() => expect(onAnswer).toHaveBeenCalledWith(true))
    vi.unstubAllGlobals()
  })
})
