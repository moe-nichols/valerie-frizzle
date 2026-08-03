import { describe, expect, test } from 'vitest'
import {
  connectionsReducer,
  entitiesRefreshed,
  profileSelected,
  queueDeleted,
  queueSelected,
  topicDeleted,
  topicSelected
} from '../../src/renderer/src/store/connectionsSlice'

type ConnectionsState = ReturnType<typeof connectionsReducer>

function stateWith(overrides: Partial<ConnectionsState>): ConnectionsState {
  return { ...connectionsReducer(undefined, { type: '@@INIT' }), ...overrides }
}

describe('selection reducers', () => {
  test('selecting a queue clears the active topic and vice versa', () => {
    let state = stateWith({ selectedProfileId: 'p1' })
    state = connectionsReducer(state, topicSelected('t1'))
    state = connectionsReducer(state, queueSelected('q1'))
    expect(state.activeQueueName).toBe('q1')
    expect(state.activeTopicName).toBeNull()

    state = connectionsReducer(state, topicSelected('t1'))
    expect(state.activeTopicName).toBe('t1')
    expect(state.activeQueueName).toBeNull()
  })

  test('selecting a profile clears any entity selection', () => {
    let state = stateWith({ selectedProfileId: 'p1', activeQueueName: 'q1' })
    state = connectionsReducer(state, profileSelected('p2'))
    expect(state.selectedProfileId).toBe('p2')
    expect(state.activeQueueName).toBeNull()
  })
})

describe('queueDeleted / topicDeleted', () => {
  test('clears the active queue when it is deleted on the selected profile', () => {
    const state = connectionsReducer(
      stateWith({ selectedProfileId: 'p1', activeQueueName: 'q1' }),
      queueDeleted({ profileId: 'p1', name: 'q1' })
    )
    expect(state.activeQueueName).toBeNull()
  })

  test("a same-named queue deleted on a different profile leaves the selection alone", () => {
    const state = connectionsReducer(
      stateWith({ selectedProfileId: 'p1', activeQueueName: 'q1' }),
      queueDeleted({ profileId: 'p2', name: 'q1' })
    )
    expect(state.activeQueueName).toBe('q1')
  })

  test('clears the active topic only for a matching profile and name', () => {
    const base = stateWith({ selectedProfileId: 'p1', activeTopicName: 't1' })
    expect(
      connectionsReducer(base, topicDeleted({ profileId: 'p1', name: 't1' })).activeTopicName
    ).toBeNull()
    expect(
      connectionsReducer(base, topicDeleted({ profileId: 'p1', name: 'other' })).activeTopicName
    ).toBe('t1')
  })
})

describe('entitiesRefreshed', () => {
  test('clears an active queue the fresh listing no longer contains', () => {
    const state = connectionsReducer(
      stateWith({ selectedProfileId: 'p1', activeQueueName: 'q-gone' }),
      entitiesRefreshed({ profileId: 'p1', queueNames: ['q-a', 'q-b'], topicNames: [] })
    )
    expect(state.activeQueueName).toBeNull()
  })

  test('keeps an active queue that is still listed', () => {
    const state = connectionsReducer(
      stateWith({ selectedProfileId: 'p1', activeQueueName: 'q-a' }),
      entitiesRefreshed({ profileId: 'p1', queueNames: ['q-a'], topicNames: [] })
    )
    expect(state.activeQueueName).toBe('q-a')
  })

  test('a listing whose fetch failed (undefined names) never clears the selection', () => {
    const state = connectionsReducer(
      stateWith({ selectedProfileId: 'p1', activeQueueName: 'q-a', activeTopicName: null }),
      entitiesRefreshed({ profileId: 'p1', topicNames: ['t1'] })
    )
    expect(state.activeQueueName).toBe('q-a')
  })

  test("another profile's listing never clears the selected profile's selection", () => {
    const state = connectionsReducer(
      stateWith({ selectedProfileId: 'p1', activeQueueName: 'q-a' }),
      entitiesRefreshed({ profileId: 'p2', queueNames: [], topicNames: [] })
    )
    expect(state.activeQueueName).toBe('q-a')
  })
})
