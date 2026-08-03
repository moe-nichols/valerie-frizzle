import { createAsyncThunk, createSlice } from '@reduxjs/toolkit'
import { DEFAULT_POLL_INTERVAL_MS } from '@shared/pollInterval'

interface SettingsState {
  // null until the initial load resolves, so usePolling correctly waits rather than
  // polling at a guessed default that might not match what's actually persisted.
  pollIntervalMs: number | null
}

const initialState: SettingsState = {
  pollIntervalMs: null
}

export const fetchPollInterval = createAsyncThunk<number, void, { rejectValue: string }>(
  'settings/fetchPollInterval',
  async (_, { rejectWithValue }) => {
    const response = await window.sbAdmin.preferences.getPollInterval()
    if (!response.ok) return rejectWithValue(response.error.message)
    return response.data
  }
)

export const updatePollInterval = createAsyncThunk<number, number, { rejectValue: string }>(
  'settings/updatePollInterval',
  async (pollIntervalMs, { rejectWithValue }) => {
    const response = await window.sbAdmin.preferences.setPollInterval(pollIntervalMs)
    if (!response.ok) return rejectWithValue(response.error.message)
    return response.data
  }
)

const settingsSlice = createSlice({
  name: 'settings',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchPollInterval.fulfilled, (state, action) => {
        state.pollIntervalMs = action.payload
      })
      .addCase(fetchPollInterval.rejected, (state) => {
        // null is the "still loading" sentinel that keeps usePolling idle; a failed load
        // must not leave it there or the app silently never polls at all.
        state.pollIntervalMs = DEFAULT_POLL_INTERVAL_MS
      })
      .addCase(updatePollInterval.fulfilled, (state, action) => {
        state.pollIntervalMs = action.payload
      })
  }
})

export const settingsReducer = settingsSlice.reducer
