// AI assistance: drafted with Claude (Opus 5.5) via claude.ai; reviewed and tested by the project team.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import StatOverrideControl from './StatOverrideControl'

const mocks = vi.hoisted(() => ({ apiRequest: vi.fn() }))
vi.mock('../lib/api', () => ({ apiRequest: mocks.apiRequest }))

const getToken = vi.fn()
let onChange

function renderControl(override = null) {
  onChange = vi.fn()
  return render(
    <StatOverrideControl athleteId={4} statKey="goals" override={override} getToken={getToken} onChange={onChange} />
  )
}

beforeEach(() => {
  mocks.apiRequest.mockReset()
  mocks.apiRequest.mockResolvedValue({})
})

describe('StatOverrideControl', () => {
  it('lets a coach correct a computed stat', async () => {
    renderControl()
    expect(screen.queryByText('corrected')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /correct/ }))
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '7' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(mocks.apiRequest).toHaveBeenCalledWith('/api/athletes/4/stats/override', {
      method: 'PATCH', body: { stat_key: 'goals', value: 7 }, getToken,
    })
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
  })

  it.each(['-1', '2.5', 'abc', ''])('rejects %s as a value', async (value) => {
    renderControl()
    fireEvent.click(screen.getByRole('button', { name: /correct/ }))
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByText('Enter a whole number, 0 or more')).toBeInTheDocument()
    expect(mocks.apiRequest).not.toHaveBeenCalled()
  })

  it('shows the server error and stays in edit mode when saving fails', async () => {
    mocks.apiRequest.mockRejectedValue(new Error('Only coaches can correct stats'))
    renderControl()
    fireEvent.click(screen.getByRole('button', { name: /correct/ }))
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Only coaches can correct stats')).toBeInTheDocument()
    expect(screen.getByRole('spinbutton')).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('cancels an edit without saving', () => {
    renderControl()
    fireEvent.click(screen.getByRole('button', { name: /correct/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
    expect(mocks.apiRequest).not.toHaveBeenCalled()
  })

  it('marks a corrected stat, pre-fills its value and can revert it', async () => {
    renderControl({ value: 5, note: 'Fixed own goal' })
    expect(screen.getByText('corrected')).toHaveAttribute('title', 'Fixed own goal')

    fireEvent.click(screen.getByRole('button', { name: /correct/ }))
    expect(screen.getByRole('spinbutton')).toHaveValue(5)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    fireEvent.click(screen.getByRole('button', { name: 'revert' }))
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(mocks.apiRequest).toHaveBeenCalledWith('/api/athletes/4/stats/override/goals', { method: 'DELETE', getToken })
  })

  it('shows the error when reverting fails', async () => {
    mocks.apiRequest.mockRejectedValue(new Error('Network down'))
    renderControl({ value: 5 })
    fireEvent.click(screen.getByRole('button', { name: 'revert' }))
    await waitFor(() => expect(mocks.apiRequest).toHaveBeenCalled())
    expect(onChange).not.toHaveBeenCalled()
  })
})
