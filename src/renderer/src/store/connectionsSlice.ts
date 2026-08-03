import { createAsyncThunk, createSlice, type PayloadAction } from '@reduxjs/toolkit'
import type { ConnectionProfile } from '@shared/domain'

interface ConnectionsState {
  profiles: ConnectionProfile[]
  connectedIds: string[]
  connectingIds: string[]
  selectedProfileId: string | null
  activeQueueName: string | null
}

const initialState: ConnectionsState = {
  profiles: [],
  connectedIds: [],
  connectingIds: [],
  selectedProfileId: null,
  activeQueueName: null
}

function without(ids: string[], id: string): string[] {
  return ids.filter((existing) => existing !== id)
}

export const fetchProfiles = createAsyncThunk<ConnectionProfile[], void, { rejectValue: string }>(
  'connections/fetchProfiles',
  async (_, { rejectWithValue }) => {
    const response = await window.sbAdmin.connections.list()
    if (!response.ok) return rejectWithValue(response.error.message)
    return response.data
  }
)

export const createProfile = createAsyncThunk<
  ConnectionProfile,
  { name: string; connectionString: string; managementPort: number },
  { rejectValue: string }
>('connections/createProfile', async (input, { rejectWithValue }) => {
  const response = await window.sbAdmin.connections.create(input)
  if (!response.ok) return rejectWithValue(response.error.message)
  return response.data
})

// Selecting a profile that's already connected is instant (no IPC) — that path is handled by
// the plain `profileSelected` reducer below. This thunk only covers the "not yet connected"
// path: connect, then select on success.
export const selectProfile = createAsyncThunk<string, string, { rejectValue: string }>(
  'connections/selectProfile',
  async (id, { rejectWithValue }) => {
    const response = await window.sbAdmin.connections.connect(id)
    if (!response.ok) return rejectWithValue(response.error.message)
    return id
  }
)

export const disconnectProfile = createAsyncThunk<string, string, { rejectValue: string }>(
  'connections/disconnectProfile',
  async (id, { rejectWithValue }) => {
    const response = await window.sbAdmin.connections.disconnect(id)
    if (!response.ok) return rejectWithValue(response.error.message)
    return id
  }
)

export const deleteProfile = createAsyncThunk<string, string, { rejectValue: string }>(
  'connections/deleteProfile',
  async (id, { rejectWithValue, getState }) => {
    const state = getState() as { connections: ConnectionsState }
    if (state.connections.connectedIds.includes(id)) {
      const disconnectResponse = await window.sbAdmin.connections.disconnect(id)
      if (!disconnectResponse.ok) return rejectWithValue(disconnectResponse.error.message)
    }
    const response = await window.sbAdmin.connections.delete(id)
    if (!response.ok) return rejectWithValue(response.error.message)
    return id
  }
)

const connectionsSlice = createSlice({
  name: 'connections',
  initialState,
  reducers: {
    // Select an already-connected profile — instant, no IPC round trip.
    profileSelected(state, action: PayloadAction<string>) {
      state.selectedProfileId = action.payload
      state.activeQueueName = null
    },
    queueSelected(state, action: PayloadAction<string>) {
      state.activeQueueName = action.payload
    },
    queueDeleted(state, action: PayloadAction<string>) {
      if (state.activeQueueName === action.payload) {
        state.activeQueueName = null
      }
    }
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchProfiles.fulfilled, (state, action) => {
        state.profiles = action.payload
      })
      .addCase(createProfile.fulfilled, (state, action) => {
        state.profiles.push(action.payload)
      })
      .addCase(selectProfile.pending, (state, action) => {
        state.connectingIds.push(action.meta.arg)
      })
      .addCase(selectProfile.fulfilled, (state, action) => {
        state.connectingIds = without(state.connectingIds, action.payload)
        state.connectedIds.push(action.payload)
        state.selectedProfileId = action.payload
        state.activeQueueName = null
      })
      .addCase(selectProfile.rejected, (state, action) => {
        state.connectingIds = without(state.connectingIds, action.meta.arg)
      })
      .addCase(disconnectProfile.fulfilled, (state, action) => {
        state.connectedIds = without(state.connectedIds, action.payload)
        if (state.selectedProfileId === action.payload) {
          state.selectedProfileId = null
          state.activeQueueName = null
        }
      })
      .addCase(deleteProfile.fulfilled, (state, action) => {
        state.connectedIds = without(state.connectedIds, action.payload)
        state.profiles = state.profiles.filter((profile) => profile.id !== action.payload)
        if (state.selectedProfileId === action.payload) {
          state.selectedProfileId = null
          state.activeQueueName = null
        }
      })
  }
})

export const { profileSelected, queueSelected, queueDeleted } = connectionsSlice.actions
export const connectionsReducer = connectionsSlice.reducer
