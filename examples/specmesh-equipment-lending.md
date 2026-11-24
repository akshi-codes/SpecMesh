# Equipment Lending

An internal service for reserving, collecting, and returning shared equipment. Employees request equipment, and desk staff record checkouts and returns. The first release tracks each physical item by its inventory ID and supports one pickup desk.

## EL-US-01 — Browse available equipment

As an employee, I want to see which items are currently lendable so I can choose equipment for my work.

### Shared interface

This story provides `InventoryAPI` for reading and updating item state. `GET /items` returns each item's ID, category, condition, and current lending state. Reservation windows are checked when an employee submits a reservation.

### Acceptance criteria

- An employee can filter items by category and current lending state.
- Checked-out and out-of-service items are marked unavailable.
- Each result includes a unique inventory ID and its recorded condition.

## EL-US-02 — Reserve an item

As an employee, I want to reserve an available item so it is held for me during my chosen window.

### Dependencies and shared interface

This story consumes item IDs and current inventory state from `InventoryAPI`, provided by EL-US-01. The reservation service owns the final conflict check and provides `ReservationAPI` for creating and reading reservations.

### Acceptance criteria

- Creating a reservation for an available item returns a reservation ID and the confirmed time window.
- If two requests overlap for the same item, at most one succeeds. The other receives an availability conflict.
- A request with an end time at or before its start time is rejected with a validation error.
- Retrying a request with the same request ID and payload returns the original reservation.

## EL-US-03 — Check out reserved equipment

As a desk staff member, I want to check equipment out against a confirmed reservation so I can record who collected it.

### Dependencies and shared interface

This story consumes `ReservationAPI` from EL-US-02 and inventory state from `InventoryAPI` in EL-US-01. It provides `LoanAPI` for opening a loan and reading its status. A loan links the reservation, item, borrower, staff member, pickup time, and due time.

### Acceptance criteria

- Desk staff can open a loan for a confirmed reservation when it is eligible for pickup.
- An expired or cancelled reservation, or a reservation that already has a loan, cannot open another loan.
- An open loan makes the item unavailable for new overlapping reservations until it is checked in.

## EL-US-04 — Return an item and record its condition

As a desk staff member, I want to close a loan and capture the returned item's condition so the inventory shows whether it can be lent again.

### Dependencies and shared interface

This story consumes the open loan from `LoanAPI` in EL-US-03. It records the return through `LoanAPI` and updates the item's condition and availability through `InventoryAPI` in EL-US-01.

### Acceptance criteria

- Desk staff can close an open loan with a return timestamp and a condition of usable, damaged, or missing parts.
- An item returned in usable condition becomes available subject to later reservations. A damaged item or an item with missing parts is marked out of service.
- A repeated return request preserves the original timestamp and condition.

## EL-US-05 — Notify borrowers of overdue equipment

As a borrower, I want a reminder when an item is overdue so I can return it promptly.

### Dependencies and open decision

This story consumes loan status and due time from `LoanAPI` in EL-US-03. It uses the closed status recorded by EL-US-04 to suppress reminders after return. The team must decide whether reminders are triggered by a scheduled scan or a delayed event before finalizing the notification interface.

### Acceptance criteria

- An open loan is eligible for a reminder 24 hours after its due time.
- A closed loan does not receive overdue reminders.
- A successful reminder is recorded per loan so retries do not send duplicates.
