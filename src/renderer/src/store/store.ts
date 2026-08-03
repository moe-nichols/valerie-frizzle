import { configureStore } from '@reduxjs/toolkit'
import { connectionsReducer } from './connectionsSlice'
import { settingsReducer } from './settingsSlice'

export const store = configureStore({
  reducer: {
    connections: connectionsReducer,
    settings: settingsReducer
  }
})

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch
