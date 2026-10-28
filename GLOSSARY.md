# SB Emulator Manager

A desktop tool for inspecting and managing queues, topics, and subscriptions in a
local Azure Service Bus emulator.

## Language

**Count observation**:
A non-destructive measurement of active or dead-letter messages held by a queue
or subscription at a particular time. A successful observation below the
observation cap is a point-in-time count; reaching the cap gives only a lower bound.
_Avoid_: Queue size, exact total

**Forwarding**:
Automatic transfer of arriving messages to another entity. Active-message
forwarding and dead-letter forwarding are independent settings; each prevents
count observation of the messages it forwards.

**Dead-letter queue (DLQ)**:
The messages held separately from an entity's active messages after dead-lettering.
An active count does not include its DLQ count.
