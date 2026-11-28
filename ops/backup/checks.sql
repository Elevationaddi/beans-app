-- Integrity checks run on the source and on every restored copy. Counts and sums only: no
-- personal or financial detail is printed.
SELECT 'audit_events', count(*) FROM audit_events
UNION ALL SELECT 'journal_debit_minus_credit', COALESCE(sum(debit_fils - credit_fils), 0) FROM journal_lines
UNION ALL SELECT 'journal_lines', count(*) FROM journal_lines
UNION ALL SELECT 'merchants', count(*) FROM merchants
UNION ALL SELECT 'orders', count(*) FROM orders
UNION ALL SELECT 'payments', count(*) FROM payments
UNION ALL SELECT 'refunds', count(*) FROM refunds
UNION ALL SELECT 'users', count(*) FROM users
ORDER BY 1;
