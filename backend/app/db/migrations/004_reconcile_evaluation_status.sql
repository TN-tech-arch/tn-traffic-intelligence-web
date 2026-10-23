-- Reconcile historical aggregate statuses with their member outcomes.
-- This changes status labels only; saved predictions and experiment records stay
-- untouched.
UPDATE evaluations
SET status = CASE
    WHEN EXISTS (
        SELECT 1
        FROM evaluation_experiments AS member
        WHERE member.evaluation_id = evaluations.evaluation_id
          AND member.status IN ('Completed', 'Partial')
    )
    AND EXISTS (
        SELECT 1
        FROM evaluation_experiments AS member
        WHERE member.evaluation_id = evaluations.evaluation_id
          AND member.status NOT IN ('Completed', 'Partial')
    ) THEN 'Partial'
    WHEN NOT EXISTS (
        SELECT 1
        FROM evaluation_experiments AS member
        WHERE member.evaluation_id = evaluations.evaluation_id
          AND member.status IN ('Completed', 'Partial')
    )
    AND EXISTS (
        SELECT 1
        FROM evaluation_experiments AS member
        WHERE member.evaluation_id = evaluations.evaluation_id
    ) THEN 'Failed'
    ELSE status
END
WHERE status = 'Completed';
