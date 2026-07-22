-- Tighten feedback INSERT: the original policy only checked user_id, so a
-- logged-in user could attach feedback to ANY order id. Require the order to
-- be the reviewer's own and already delivered (reviews open after delivery).

DROP POLICY "Users can submit feedback" ON feedback;

CREATE POLICY "Users can review own delivered orders" ON feedback
FOR INSERT WITH CHECK (
  auth.uid() = user_id
  AND EXISTS (
    SELECT 1 FROM orders
    WHERE orders.id = feedback.order_id
      AND orders.user_id = auth.uid()
      AND orders.status = 'delivered'
  )
);
