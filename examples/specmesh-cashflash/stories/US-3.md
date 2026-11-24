# US-3 — Fund transfer

TransferAPI accepts POST /transfers with accountId (string) and amount (positive number); returns transferId (string).
Needs US-1 identity validation and US-2 account verification. Account verification is not an atomic balance reservation.

## Acceptance Criteria
- TransferAPI accepts POST /transfers with accountId (string) and amount (positive number); returns transferId (string).
- Record explicit success and failure outcomes.
